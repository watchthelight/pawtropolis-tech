#!/usr/bin/env tsx
/**
 * Pawtropolis Tech — scripts/batch-acknowledge-security.ts
 * WHAT: Batch acknowledge all open security audit issues
 * WHY: Allows staff to mark all current issues as reviewed/intentional in one operation
 * USAGE: npx tsx scripts/batch-acknowledge-security.ts [--dry-run] [--reason "your reason"]
 *
 * This script connects to Discord, runs a fresh security analysis to get
 * current issues with their permission hashes, and acknowledges them all.
 *
 * NOTE: Must be run from the project root with access to .env credentials.
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { analyzeSecurityOnly } from "../src/features/serverAuditDocs.js";
import {
  acknowledgeIssue,
  getAcknowledgedIssues,
} from "../src/store/acknowledgedSecurityStore.js";
import { logger } from "../src/lib/logger.js";

// The guild to acknowledge issues for
const PAWTROPOLIS_GUILD_ID = "896070888594759740";

// Default acknowledger (Server Dev bot account or your user ID)
const DEFAULT_ACKNOWLEDGER_ID = process.env.BOT_OWNER_ID ?? "600968933293424640";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx !== -1 && args[reasonIdx + 1]
    ? args[reasonIdx + 1]
    : "Batch acknowledged via script";

  console.log("=".repeat(60));
  console.log("Pawtropolis Tech - Batch Security Acknowledgment");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`Reason: ${reason}`);
  console.log(`Acknowledger ID: ${DEFAULT_ACKNOWLEDGER_ID}`);
  console.log("");

  // Create Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  try {
    // Login
    console.log("Connecting to Discord...");
    await client.login(process.env.DISCORD_TOKEN);
    console.log(`Logged in as ${client.user?.tag}`);

    // Wait for ready
    await new Promise<void>((resolve) => {
      if (client.isReady()) {
        resolve();
      } else {
        client.once("ready", () => resolve());
      }
    });

    // Fetch the guild
    console.log(`\nFetching guild ${PAWTROPOLIS_GUILD_ID}...`);
    const guild = await client.guilds.fetch(PAWTROPOLIS_GUILD_ID);
    console.log(`Guild: ${guild.name}`);

    // Run security analysis to get current issues with fresh hashes
    console.log("\nRunning security analysis...");
    const issues = await analyzeSecurityOnly(guild);
    console.log(`Total issues detected: ${issues.length}`);

    // Get already acknowledged issues
    const acknowledged = getAcknowledgedIssues(PAWTROPOLIS_GUILD_ID);
    console.log(`Already acknowledged: ${acknowledged.size}`);

    // Find issues that need acknowledgment
    const toAcknowledge = issues.filter((issue) => {
      const ack = acknowledged.get(issue.issueKey);
      // Not acknowledged OR permissions changed (hash mismatch)
      return !ack || ack.permissionHash !== issue.permissionHash;
    });

    console.log(`\nIssues to acknowledge: ${toAcknowledge.length}`);
    console.log("");

    if (toAcknowledge.length === 0) {
      console.log("✅ All issues are already acknowledged!");
      await client.destroy();
      process.exit(0);
    }

    // Display issues that will be acknowledged
    console.log("Issues to be acknowledged:");
    console.log("-".repeat(60));
    for (const issue of toAcknowledge) {
      const emoji =
        issue.severity === "critical" ? "🔴" :
        issue.severity === "high" ? "🟠" :
        issue.severity === "medium" ? "🟡" : "🟢";
      console.log(`  ${emoji} [${issue.id}] ${issue.title}`);
      console.log(`     Key: ${issue.issueKey}`);
      console.log(`     Affected: ${issue.affected}`);
      console.log("");
    }

    if (dryRun) {
      console.log("-".repeat(60));
      console.log("DRY RUN - No changes made.");
      console.log("Remove --dry-run flag to actually acknowledge these issues.");
      await client.destroy();
      process.exit(0);
    }

    // Acknowledge all issues
    console.log("Acknowledging issues...");
    let successCount = 0;
    let errorCount = 0;

    for (const issue of toAcknowledge) {
      try {
        acknowledgeIssue({
          guildId: PAWTROPOLIS_GUILD_ID,
          issueKey: issue.issueKey,
          severity: issue.severity,
          title: issue.title,
          permissionHash: issue.permissionHash,
          acknowledgedBy: DEFAULT_ACKNOWLEDGER_ID,
          reason,
        });
        successCount++;
        console.log(`  ✅ Acknowledged: ${issue.id}`);
      } catch (err) {
        errorCount++;
        console.error(`  ❌ Failed: ${issue.id} - ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    console.log("");
    console.log("=".repeat(60));
    console.log(`Done! Acknowledged: ${successCount}, Failed: ${errorCount}`);
    console.log("=".repeat(60));

    // Cleanup
    await client.destroy();
    process.exit(errorCount > 0 ? 1 : 0);

  } catch (err) {
    console.error("Fatal error:", err);
    logger.error({ err }, "[batch-acknowledge] Script failed");
    await client.destroy().catch(() => {});
    process.exit(1);
  }
}

main();
