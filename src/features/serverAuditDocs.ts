/**
 * Pawtropolis Tech — src/features/serverAuditDocs.ts
 * WHAT: Orchestrates server audit documentation generation + GitHub push.
 * WHY: Public entrypoint. Data/analysis live in serverAudit/analyze.ts,
 *      markdown generators in serverAudit/docs.ts, shared types + helpers in
 *      serverAudit/types.ts (#00010).
 * USAGE: Called by /audit security and scripts/audit-server-full.ts.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type Guild } from "discord.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { notifyDashboard } from "../web/notifyDashboard.js";
import { getAcknowledgedIssues, clearStaleAcknowledgments } from "../store/acknowledgedSecurityStore.js";
import {
  saveSnapshot,
  getLatestSnapshot,
  recordIssueHistory,
  pruneOldSnapshots,
} from "../store/securitySnapshotStore.js";
import {
  computeSnapshotDiff,
  generateDiffMarkdown,
  hasMeaningfulChanges,
  getDangerousChanges,
  type SnapshotDiff,
} from "./securityDiff.js";
import {
  roleToSnapshot,
  channelToSnapshot,
  issueToSnapshot,
  type SecurityIssue,
  type AuditResult,
  type GitPushResult,
} from "./serverAudit/types.js";
import {
  fetchRoles,
  fetchChannels,
  fetchServerInfo,
  analyzeSecurityIssues,
} from "./serverAudit/analyze.js";
import {
  partitionIssues,
  generateRolesDoc,
  generateChannelsDoc,
  generateConflictsDoc,
  generateServerInfoDoc,
  generateHierarchyDoc,
} from "./serverAudit/docs.js";

export type { SecurityIssue, AuditResult, GitPushResult };

export async function generateAuditDocs(guild: Guild, outputDir?: string): Promise<AuditResult> {
  const OUTPUT_DIR = outputDir || join(process.cwd(), "docs/internal-info");

  // Fetch all data
  const roles = await fetchRoles(guild);
  const channels = await fetchChannels(guild, roles);
  const serverInfo = await fetchServerInfo(guild);
  const issues = analyzeSecurityIssues(roles, channels);

  // Populate cache so /audit acknowledge can find these exact issues with matching IDs
  // This ensures IDs like MED-010 stay consistent between the audit display and acknowledge
  securityAnalysisCache.set(guild.id, {
    issues,
    expiresAt: Date.now() + SECURITY_CACHE_TTL_MS,
  });

  // Fetch acknowledged issues and partition
  const acknowledged = getAcknowledgedIssues(guild.id);
  const partitioned = partitionIssues(issues, acknowledged);

  // Clean up stale acknowledgments (for deleted roles/channels)
  const validKeys = new Set(issues.map((i) => i.issueKey));
  clearStaleAcknowledgments(guild.id, validKeys);

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate and write docs
  writeFileSync(join(OUTPUT_DIR, "ROLES.md"), generateRolesDoc(roles, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "CHANNELS.md"), generateChannelsDoc(channels, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "CONFLICTS.md"), generateConflictsDoc(partitioned, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "SERVER-INFO.md"), generateServerInfoDoc(serverInfo, roles, channels));
  writeFileSync(join(OUTPUT_DIR, "HIERARCHY.md"), generateHierarchyDoc(roles, serverInfo));

  // Count active issues only (not acknowledged ones)
  const active = partitioned.active;
  const critical = active.filter((i) => i.severity === "critical").length;
  const high = active.filter((i) => i.severity === "high").length;
  const medium = active.filter((i) => i.severity === "medium").length;
  const low = active.filter((i) => i.severity === "low").length;

  // --- Snapshot and Diff Tracking ---

  // Convert data to snapshot format
  const rolesSnapshot = roles.map(roleToSnapshot);
  const channelsSnapshot = channels.map(channelToSnapshot);
  const issuesSnapshot = issues.map(issueToSnapshot);

  // Get previous snapshot for diff computation
  const previousSnapshot = getLatestSnapshot(guild.id);

  // Save new snapshot
  let snapshotId: number | undefined;
  let diff: SnapshotDiff | undefined;
  let dangerousChangeCount = 0;

  try {
    snapshotId = saveSnapshot({
      guildId: guild.id,
      roleCount: roles.length,
      channelCount: channels.length,
      issueCount: active.length,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      rolesSnapshot,
      channelsSnapshot,
      issuesSnapshot,
    });

    // Compute diff if we have a previous snapshot
    if (previousSnapshot) {
      const newSnapshot = getLatestSnapshot(guild.id);
      if (newSnapshot) {
        diff = computeSnapshotDiff(previousSnapshot, newSnapshot);
        dangerousChangeCount = getDangerousChanges(diff).length;

        // Generate DIFF.md if there are meaningful changes
        if (hasMeaningfulChanges(diff)) {
          const diffMarkdown = generateDiffMarkdown(diff, serverInfo.name);
          writeFileSync(join(OUTPUT_DIR, "DIFF.md"), diffMarkdown);
        }
      }
    }

    // Record issue history for trend tracking
    // Count issues by category
    const roleIssues = issues.filter((i) => i.issueKey.startsWith("role:")).length;
    const channelIssues = issues.filter((i) => i.issueKey.startsWith("channel:")).length;
    const hierarchyIssues = issues.filter((i) => i.issueKey.includes("hierarchy")).length;
    const verificationIssues = issues.filter((i) => i.issueKey.includes("verification")).length;

    recordIssueHistory({
      guildId: guild.id,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      acknowledgedCount: partitioned.acknowledged.length,
      roleIssues,
      channelIssues,
      hierarchyIssues,
      verificationIssues,
    });

    // Prune old snapshots to prevent unbounded growth (keep last 30)
    pruneOldSnapshots(guild.id, 30);

    // Notify dashboard so Security tab auto-refreshes
    if (snapshotId) {
      notifyDashboard("audit:security_snapshot", {
        snapshotId,
        issueCount: active.length,
        criticalCount: critical,
      });
    }
  } catch {
    // Snapshot storage is non-critical, don't fail the audit
  }

  return {
    roleCount: roles.length,
    channelCount: channels.length,
    issueCount: active.length,
    criticalCount: critical,
    highCount: high,
    mediumCount: medium,
    lowCount: low,
    acknowledgedCount: partitioned.acknowledged.length,
    outputDir: OUTPUT_DIR,
    diff,
    dangerousChangeCount,
    snapshotId,
    activeIssues: active,
  };
}

/**
 * Cache for security analysis results (5 minute TTL).
 * Allows acknowledge commands to find the same issues displayed by /audit security.
 * Extended from 60s to 5 minutes to give users time to review and acknowledge issues.
 */
const securityAnalysisCache = new Map<string, { issues: SecurityIssue[]; expiresAt: number }>();
const SECURITY_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Run a fresh security analysis and return issues (for acknowledge command).
 * Does NOT write files or update docs.
 * Results are cached for 60 seconds to allow multiple acknowledges.
 */
export async function analyzeSecurityOnly(guild: Guild): Promise<SecurityIssue[]> {
  const cached = securityAnalysisCache.get(guild.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.issues;
  }

  const roles = await fetchRoles(guild);
  const channels = await fetchChannels(guild, roles);
  const issues = analyzeSecurityIssues(roles, channels);

  securityAnalysisCache.set(guild.id, {
    issues,
    expiresAt: Date.now() + SECURITY_CACHE_TTL_MS,
  });

  return issues;
}

/**
 * Progress callback for verbose status updates during git operations
 */
export type GitProgressCallback = (step: string, detail?: string) => Promise<void>;

/**
 * Commit and push audit docs to GitHub
 * Requires GITHUB_BOT_TOKEN, GITHUB_BOT_USERNAME, GITHUB_BOT_EMAIL, GITHUB_REPO env vars
 *
 * Auto-syncs with remote before pushing to avoid conflicts (pulls + rebases if needed)
 */
export async function commitAndPushDocs(
  result: AuditResult,
  onProgress?: GitProgressCallback
): Promise<GitPushResult> {
  const token = process.env.GITHUB_BOT_TOKEN;
  const username = process.env.GITHUB_BOT_USERNAME;
  const email = process.env.GITHUB_BOT_EMAIL;
  const repo = process.env.GITHUB_REPO;

  const progress = onProgress ?? (async () => {});

  if (!token || !username || !email || !repo) {
    return {
      success: false,
      error: "Missing GitHub configuration (GITHUB_BOT_TOKEN, GITHUB_BOT_USERNAME, GITHUB_BOT_EMAIL, GITHUB_REPO)",
    };
  }

  const cwd = process.cwd();
  const remoteUrl = `https://${username}:${token}@github.com/${repo}.git`;

  try {
    // Step 1: Check if there are changes to commit
    await progress("Checking for changes", "git status");
    const status = execSync("git status --porcelain docs/internal-info/", { cwd, encoding: "utf-8" });
    if (!status.trim()) {
      return {
        success: true,
        error: "No changes to commit",
      };
    }

    // Step 2: Configure git for this commit
    await progress("Configuring git", `user: ${username}`);
    execSync(`git config user.name "${username}"`, { cwd });
    execSync(`git config user.email "${email}"`, { cwd });

    // Step 3: Fetch latest from remote (to detect conflicts)
    await progress("Fetching remote", "git fetch origin main");
    try {
      execSync(`git fetch ${remoteUrl} main`, { cwd, encoding: "utf-8", stdio: "pipe" });
    } catch {
      // Fetch failed - might be network issue, continue anyway
    }

    // Step 4: Stash our changes temporarily
    await progress("Stashing changes", "git stash");
    execSync("git stash push -m 'audit-temp' -- docs/internal-info/", { cwd, stdio: "pipe" });

    // Step 5: Pull and rebase to sync with remote
    await progress("Syncing with remote", "git pull --rebase");
    try {
      execSync(`git pull ${remoteUrl} main --rebase`, { cwd, encoding: "utf-8", stdio: "pipe" });
    } catch (pullErr) {
      // Pull failed - try to recover by resetting to remote
      await progress("Recovering from conflict", "git reset --hard origin/main");
      try {
        execSync("git fetch origin main && git reset --hard origin/main", { cwd, stdio: "pipe" });
      } catch {
        // If reset also fails, pop stash and continue - we'll report the error
      }
    }

    // Step 6: Pop our stashed changes
    await progress("Restoring changes", "git stash pop");
    try {
      execSync("git stash pop", { cwd, stdio: "pipe" });
    } catch {
      // Stash pop failed - changes might conflict, try to get them back
      try {
        execSync("git checkout stash -- docs/internal-info/", { cwd, stdio: "pipe" });
        execSync("git stash drop", { cwd, stdio: "pipe" });
      } catch {
        // Give up on stash recovery, the files should still be there from generateAuditDocs
      }
    }

    // Step 7: Stage the docs
    await progress("Staging files", "git add docs/internal-info/");
    execSync("git add docs/internal-info/", { cwd });

    // Step 8: Create commit
    const timestamp = new Date().toISOString().split("T")[0];
    const commitMsg = `docs: update internal-info audit (${timestamp})

Roles: ${result.roleCount}
Channels: ${result.channelCount}
Issues: ${result.issueCount} (${result.criticalCount} critical, ${result.highCount} high, ${result.mediumCount} medium, ${result.lowCount} low)

[automated by /audit security]`;

    await progress("Creating commit", "git commit");
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd });

    // Step 9: Get the commit hash
    const commitHash = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();

    // Step 10: Push to remote
    await progress("Pushing to GitHub", `${repo}`);
    execSync(`git push ${remoteUrl} HEAD:main`, { cwd, encoding: "utf-8", stdio: "pipe" });

    // Reset remote to not expose token
    execSync(`git remote set-url origin https://github.com/${repo}.git`, { cwd });

    const commitUrl = `https://github.com/${repo}/commit/${commitHash}`;
    const docsUrl = `https://github.com/${repo}/blob/main/docs/internal-info/CONFLICTS.md`;

    await progress("Complete", commitHash.slice(0, 7));

    return {
      success: true,
      commitHash,
      commitUrl,
      docsUrl,
    };
  } catch (err) {
    // Reset git config to original user if push failed
    try {
      execSync('git config user.name "watchthelight"', { cwd });
      execSync('git config user.email "admin@watchthelight.org"', { cwd });
    } catch {
      // Ignore reset errors
    }

    // Try to clean up any leftover stash
    try {
      execSync("git stash drop", { cwd, stdio: "pipe" });
    } catch {
      // Ignore - no stash to drop
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error during git push",
    };
  }
}
