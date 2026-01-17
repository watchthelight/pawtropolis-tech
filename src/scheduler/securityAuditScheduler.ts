/**
 * Pawtropolis Tech — src/scheduler/securityAuditScheduler.ts
 * WHAT: Periodic scheduler for automated security audits
 * WHY: Continuously monitor server permissions and alert staff to critical issues
 * FLOWS:
 *  - Every 30 minutes → runSecurityAudit(guildId) → post results to logging channel
 *  - Pings leadership roles for unacknowledged critical issues
 * DOCS:
 *  - setInterval: https://nodejs.org/api/timers.html#setinterval
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type Client, type TextChannel, EmbedBuilder, roleMention } from "discord.js";
import {
  generateAuditDocs,
  type AuditResult,
  type SecurityIssue,
} from "../features/serverAuditDocs.js";
import {
  getDangerousChanges,
  hasMeaningfulChanges,
  type SnapshotDiff,
  type DangerousChange,
} from "../features/securityDiff.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";

// 30 minutes - frequent enough to catch issues quickly, infrequent enough to not spam
const AUDIT_INTERVAL_MS = 30 * 60 * 1000;

// Logging channel for security audit results
const LOGGING_CHANNEL_ID = "1430015254053654599";

// Leadership role IDs to ping for critical unacknowledged issues
const LEADERSHIP_ROLE_IDS = {
  serverDev: "1120074045883420753",
  communityManager: "1190093021170114680",
  seniorAdmin: "1420440472169746623",
};

// Link to CONFLICTS.md for role hierarchy documentation
const CONFLICTS_DOC_URL = "https://github.com/watchthelight/pawtropolis-tech/blob/main/docs/internal-info/CONFLICTS.md";

let _activeInterval: NodeJS.Timeout | null = null;

/**
 * Build an embed for dangerous permission changes detected via diff.
 */
function buildDiffAlertEmbed(diff: SnapshotDiff, dangerousChanges: DangerousChange[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Permission Changes Detected")
    .setColor(0xff4500) // Orange-red for attention
    .setTimestamp()
    .setFooter({ text: "Changes since last audit" });

  // Summary
  const summaryLines: string[] = [];
  if (diff.rolesAdded.length > 0) summaryLines.push(`${diff.rolesAdded.length} role(s) added`);
  if (diff.rolesRemoved.length > 0) summaryLines.push(`${diff.rolesRemoved.length} role(s) removed`);
  if (diff.rolesChanged.length > 0) summaryLines.push(`${diff.rolesChanged.length} role(s) modified`);
  if (diff.channelsAdded.length > 0) summaryLines.push(`${diff.channelsAdded.length} channel(s) added`);
  if (diff.channelsRemoved.length > 0) summaryLines.push(`${diff.channelsRemoved.length} channel(s) removed`);
  if (diff.channelsChanged.length > 0) summaryLines.push(`${diff.channelsChanged.length} channel(s) modified`);
  if (diff.issuesNew.length > 0) summaryLines.push(`${diff.issuesNew.length} new issue(s)`);
  if (diff.issuesResolved.length > 0) summaryLines.push(`${diff.issuesResolved.length} issue(s) resolved`);

  embed.setDescription(summaryLines.join("\n") || "No significant changes detected.");

  // Add dangerous changes
  for (const change of dangerousChanges.slice(0, 5)) {
    const severityEmoji =
      change.severity === "critical" ? "🔴" :
      change.severity === "high" ? "🟠" : "🟡";

    embed.addFields({
      name: `${severityEmoji} ${change.severity.toUpperCase()}: ${change.description}`,
      value: `**Target:** ${change.targetName}\n**Permissions:** ${change.permissions.join(", ")}`,
      inline: false,
    });
  }

  // Note remaining dangerous changes
  if (dangerousChanges.length > 5) {
    embed.addFields({
      name: "Additional Dangerous Changes",
      value: `+${dangerousChanges.length - 5} more dangerous change(s). Run \`/audit diff\` for full details.`,
      inline: false,
    });
  }

  // Add new issues section
  if (diff.issuesNew.length > 0) {
    const newIssuesSummary = diff.issuesNew
      .slice(0, 3)
      .map((i) => `• **${i.severity.toUpperCase()}**: ${i.title}`)
      .join("\n");

    embed.addFields({
      name: `New Security Issues (${diff.issuesNew.length})`,
      value: newIssuesSummary + (diff.issuesNew.length > 3 ? `\n...and ${diff.issuesNew.length - 3} more` : ""),
      inline: false,
    });
  }

  // Add resolved issues section
  if (diff.issuesResolved.length > 0) {
    embed.addFields({
      name: `Resolved Issues (${diff.issuesResolved.length})`,
      value: diff.issuesResolved
        .slice(0, 3)
        .map((i) => `• ~~${i.title}~~`)
        .join("\n") + (diff.issuesResolved.length > 3 ? `\n...and ${diff.issuesResolved.length - 3} more` : ""),
      inline: false,
    });
  }

  return embed;
}

/**
 * Run security audit for a guild and post results.
 * Now includes diff tracking and dangerous change alerts.
 */
async function runSecurityAudit(client: Client): Promise<void> {
  const guildId = env.GUILD_ID;
  if (!guildId) {
    logger.warn("[security-audit:scheduler] GUILD_ID not configured, skipping");
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    logger.warn({ guildId }, "[security-audit:scheduler] Guild not found in cache");
    return;
  }

  const channel = client.channels.cache.get(LOGGING_CHANNEL_ID) as TextChannel | undefined;
  if (!channel || !channel.isTextBased()) {
    logger.warn(
      { channelId: LOGGING_CHANNEL_ID },
      "[security-audit:scheduler] Logging channel not found or not text-based"
    );
    return;
  }

  try {
    // Run full security analysis with snapshot storage
    const result = await generateAuditDocs(guild);

    // Get critical issues from the same data source used for counts (ensures consistency)
    const criticalIssues = (result.activeIssues ?? []).filter((i) => i.severity === "critical");

    // Build the regular audit embed with critical issue details
    const embed = buildAuditSummaryEmbed(result, criticalIssues);

    // Check for dangerous permission changes
    const dangerousChanges = result.diff ? getDangerousChanges(result.diff) : [];
    const hasDiff = result.diff && hasMeaningfulChanges(result.diff);

    // Build message content (pings for critical issues or dangerous changes)
    // Use criticalIssues.length instead of result.criticalCount to ensure we only ping
    // when there are actually critical issues to display
    let content = "";
    const hasCriticalIssues = criticalIssues.length > 0;
    const hasDangerousChanges = dangerousChanges.some((c) => c.severity === "critical" || c.severity === "high");
    const needsPing = hasCriticalIssues || hasDangerousChanges;

    if (needsPing) {
      const pings = [
        roleMention(LEADERSHIP_ROLE_IDS.serverDev),
        roleMention(LEADERSHIP_ROLE_IDS.communityManager),
        roleMention(LEADERSHIP_ROLE_IDS.seniorAdmin),
      ].join(" ");

      if (hasCriticalIssues && dangerousChanges.length > 0) {
        content = `${pings} **Critical security issue(s) and dangerous permission changes detected!**`;
      } else if (hasCriticalIssues) {
        content = `${pings} **Critical security issue(s) detected!**`;
      } else {
        content = `${pings} **Dangerous permission changes detected!**`;
      }
    }

    // Build embeds list
    const embeds: EmbedBuilder[] = [embed];

    // Add diff alert embed if there are meaningful changes
    if (hasDiff && result.diff) {
      const diffEmbed = buildDiffAlertEmbed(result.diff, dangerousChanges);
      embeds.push(diffEmbed);
    }

    // Post to channel
    await channel.send({
      content: content || undefined,
      embeds,
    });

    logger.info(
      {
        guildId,
        totalIssues: result.issueCount + result.acknowledgedCount,
        unacknowledged: result.issueCount,
        critical: result.criticalCount,
        dangerousChanges: dangerousChanges.length,
        hasDiff,
        snapshotId: result.snapshotId,
      },
      "[security-audit:scheduler] Audit completed and posted"
    );
  } catch (err: any) {
    logger.error(
      { err: err.message, guildId },
      "[security-audit:scheduler] Failed to run security audit"
    );
    throw err;
  }
}

/**
 * Build a summary embed from AuditResult with critical issue details.
 */
function buildAuditSummaryEmbed(result: AuditResult, criticalIssues: SecurityIssue[] = []): EmbedBuilder {
  // Consistency check: criticalIssues should match result.criticalCount
  if (criticalIssues.length !== result.criticalCount) {
    logger.warn(
      { criticalIssuesLength: criticalIssues.length, resultCriticalCount: result.criticalCount },
      "[security-audit:scheduler] Critical issue count mismatch detected"
    );
  }

  // Consistency check: severity breakdown should sum to issueCount
  const severitySum = result.criticalCount + result.highCount + result.mediumCount + result.lowCount;
  if (severitySum !== result.issueCount) {
    logger.warn(
      { severitySum, issueCount: result.issueCount },
      "[security-audit:scheduler] Severity breakdown does not match total issue count"
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("Security Audit Results")
    .setTimestamp()
    .setFooter({ text: "Automated security scan • Runs every 30 minutes" });

  const totalActive = result.issueCount;

  if (totalActive === 0) {
    embed
      .setColor(0x00ff00)
      .setDescription(
        result.acknowledgedCount > 0
          ? `No unacknowledged security issues. ${result.acknowledgedCount} issue(s) acknowledged.`
          : "No security issues detected."
      );
    return embed;
  }

  // Color based on highest severity
  if (result.criticalCount > 0) {
    embed.setColor(0xff0000); // Red
  } else if (result.highCount > 0) {
    embed.setColor(0xff8c00); // Orange
  } else if (result.mediumCount > 0) {
    embed.setColor(0xffff00); // Yellow
  } else {
    embed.setColor(0x00ff00); // Green
  }

  // Summary line
  const summaryParts: string[] = [];
  if (result.criticalCount > 0) summaryParts.push(`${result.criticalCount} critical`);
  if (result.highCount > 0) summaryParts.push(`${result.highCount} high`);
  if (result.mediumCount > 0) summaryParts.push(`${result.mediumCount} medium`);
  if (result.lowCount > 0) summaryParts.push(`${result.lowCount} low`);

  embed.setDescription(
    `**${totalActive} unacknowledged issue(s)** (${summaryParts.join(", ")})\n` +
    (result.acknowledgedCount > 0 ? `${result.acknowledgedCount} issue(s) acknowledged and hidden.\n` : "") +
    `Use \`/audit security\` for full details.\n` +
    `Use \`/audit acknowledge <ID>\` to acknowledge intentional configurations.`
  );

  // Add stats field
  embed.addFields({
    name: "Server Stats",
    value: `**Roles:** ${result.roleCount}\n**Channels:** ${result.channelCount}`,
    inline: true,
  });

  // Add critical issues details if any
  if (criticalIssues.length > 0) {
    const criticalList = criticalIssues
      .slice(0, 5) // Limit to 5 to avoid embed size limits
      .map((issue) => `🔴 **[${issue.id}]** ${issue.title}\n   └ ${issue.affected}`)
      .join("\n");

    embed.addFields({
      name: `Critical Issues (${criticalIssues.length})`,
      value: criticalList + (criticalIssues.length > 5 ? `\n...and ${criticalIssues.length - 5} more` : ""),
      inline: false,
    });

    // Add link to documentation
    embed.addFields({
      name: "📚 Documentation",
      value: `[View CONFLICTS.md](${CONFLICTS_DOC_URL}) for role hierarchy and permission documentation.`,
      inline: false,
    });
  }

  return embed;
}

/**
 * Start the security audit scheduler.
 *
 * @param client - Discord.js client instance
 *
 * @example
 * import { startSecurityAuditScheduler } from './scheduler/securityAuditScheduler.js';
 * startSecurityAuditScheduler(client);
 */
export function startSecurityAuditScheduler(client: Client): void {
  // Opt-out for tests
  if (process.env.SECURITY_AUDIT_SCHEDULER_DISABLED === "1") {
    logger.debug("[security-audit:scheduler] Scheduler disabled via env flag");
    return;
  }

  logger.info(
    { intervalMinutes: AUDIT_INTERVAL_MS / 60000 },
    "[security-audit:scheduler] Starting security audit scheduler"
  );

  // Initial run after 30 seconds (give caches time to populate)
  setTimeout(async () => {
    try {
      await runSecurityAudit(client);
      recordSchedulerRun("securityAudit", true);
    } catch (err: any) {
      recordSchedulerRun("securityAudit", false);
      logger.error({ err: err.message }, "[security-audit:scheduler] Initial audit failed");
    }
  }, 30000);

  // Set up periodic runs
  const interval = setInterval(async () => {
    try {
      await runSecurityAudit(client);
      recordSchedulerRun("securityAudit", true);
    } catch (err: any) {
      recordSchedulerRun("securityAudit", false);
      logger.error({ err: err.message }, "[security-audit:scheduler] Scheduled audit failed");
    }
  }, AUDIT_INTERVAL_MS);

  // Prevent interval from keeping process alive during shutdown
  interval.unref();

  _activeInterval = interval;
}

/**
 * Stop the security audit scheduler.
 *
 * @example
 * import { stopSecurityAuditScheduler } from './scheduler/securityAuditScheduler.js';
 * process.on('SIGTERM', () => {
 *   stopSecurityAuditScheduler();
 * });
 */
export function stopSecurityAuditScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[security-audit:scheduler] Scheduler stopped");
  }
}
