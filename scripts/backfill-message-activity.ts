/**
 * Pawtropolis Tech — scripts/backfill-message-activity.ts
 * WHAT: Backfill the message_activity heatmap table for one guild over the last
 *       N weeks. Invoked by the /backfill staff command (src/commands/backfill.ts),
 *       which spawns: `npx tsx scripts/backfill-message-activity.ts <guildId> <weeks> [--dry-run]`.
 * WHY:  message_activity is normally populated live by messageActivityLogger.ts on
 *       messageCreate. New installs / gaps need a one-shot historical backfill so the
 *       /activity heatmap is not empty.
 *
 * CLI (positional, to match what the command spawns):
 *   node/tsx scripts/backfill-message-activity.ts <guildId> <weeks> [--dry-run]
 *
 * OUTPUT: prints the progress lines the command parses for its completion embed:
 *   "Total messages found: N", "Channels processed: N", "Messages inserted: N"
 *
 * IDEMPOTENCY: message_activity has no message_id, so a naive re-run would double
 *   count. To stay idempotent we (in one transaction) DELETE the guild's rows inside
 *   the backfill window, then re-insert from Discord history. Live tracking continues
 *   after the run; a row logged live during the run is simply re-derived from history.
 *
 * RATE-LIMITED via the shared backfill RateLimiter to leave headroom for the live bot.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  Client,
  GatewayIntentBits,
  ChannelType,
  type TextBasedChannel,
  type Message,
} from "discord.js";
import Database from "better-sqlite3";
import { RateLimiter } from "./backfill/rateLimiter.js";

const FETCH_PAGE = 100; // Discord max per fetch

interface CliArgs {
  guildId: string;
  weeks: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith("--"));
  const dryRun = argv.includes("--dry-run");
  const guildId = positional[0];
  const weeks = Number.parseInt(positional[1] ?? "8", 10);
  if (!guildId) {
    console.error("Usage: backfill-message-activity.ts <guildId> <weeks> [--dry-run]");
    process.exit(1);
  }
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 8) {
    console.error(`Invalid weeks value: ${positional[1]} (must be 1-8)`);
    process.exit(1);
  }
  return { guildId, weeks, dryRun };
}

interface ActivityRow {
  channelId: string;
  userId: string;
  created_at_s: number;
  hour_bucket: number;
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("DISCORD_TOKEN missing");
    process.exit(1);
  }

  const { guildId, weeks, dryRun } = parseArgs();
  const cutoff = Math.floor(Date.now() / 1000) - weeks * 7 * 86400;
  const dbPath = process.env.DB_PATH || "./data/data.db";

  console.log(`[backfill] guild=${guildId} weeks=${weeks} dryRun=${dryRun} cutoff=${cutoff}`);

  const limiter = new RateLimiter({ globalRps: 40, perChannelRps: 4 });
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const rows: ActivityRow[] = [];
  let totalMessages = 0; // human messages seen within the window
  let channelsProcessed = 0;

  client.once("ready", async () => {
    try {
      console.log(`[backfill] connected as ${client.user!.tag}`);
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      // Collect text channels + their active threads (archived threads are old by
      // definition and rarely fall inside an 8-week window worth the extra paging).
      const targets: string[] = [];
      for (const ch of channels.values()) {
        if (!ch) continue;
        if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
          targets.push(ch.id);
        }
        if (
          ch.type === ChannelType.GuildText ||
          ch.type === ChannelType.GuildAnnouncement ||
          ch.type === ChannelType.GuildForum
        ) {
          try {
            await limiter.acquire(ch.id);
            const active = await ch.threads.fetchActive();
            for (const t of active.threads.values()) targets.push(t.id);
          } catch (err) {
            console.warn(`[backfill] thread enum failed for #${ch.name}: ${(err as Error).message}`);
          }
        }
      }

      for (const channelId of targets) {
        let before: string | undefined;
        let reachedCutoff = false;
        try {
          const channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
          if (!channel || !("messages" in channel)) continue;

          while (!reachedCutoff) {
            await limiter.acquire(channelId);
            const batch: import("discord.js").Collection<string, Message> =
              await channel.messages.fetch({ limit: FETCH_PAGE, before });
            if (batch.size === 0) break;

            let oldestId: string | null = null;
            for (const m of batch.values()) {
              oldestId = m.id;
              const created_at_s = Math.floor(m.createdTimestamp / 1000);
              if (created_at_s < cutoff) {
                reachedCutoff = true;
                continue;
              }
              // Mirror messageActivityLogger.ts: humans only, no bots, no webhooks.
              if (m.author.bot || m.webhookId) continue;
              totalMessages += 1;
              rows.push({
                channelId,
                userId: m.author.id,
                created_at_s,
                hour_bucket: Math.floor(created_at_s / 3600) * 3600,
              });
            }

            if (batch.size < FETCH_PAGE) break;
            before = oldestId ?? undefined;
          }
        } catch (err) {
          console.warn(`[backfill] channel ${channelId} failed: ${(err as Error).message}`);
        }
        channelsProcessed += 1;
      }

      let inserted = 0;
      if (!dryRun) {
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("busy_timeout = 10000");
        const insert = db.prepare(
          `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket)
           VALUES (?, ?, ?, ?, ?)`
        );
        const purge = db.prepare(
          `DELETE FROM message_activity WHERE guild_id = ? AND created_at_s >= ?`
        );
        db.transaction(() => {
          purge.run(guildId, cutoff);
          for (const r of rows) {
            insert.run(guildId, r.channelId, r.userId, r.created_at_s, r.hour_bucket);
            inserted += 1;
          }
        })();
        db.close();
      }

      // These three lines are parsed by src/commands/backfill.ts. Keep the exact format.
      console.log(`Total messages found: ${totalMessages.toLocaleString()}`);
      console.log(`Channels processed: ${channelsProcessed.toLocaleString()}`);
      console.log(`Messages inserted: ${inserted.toLocaleString()}`);

      await client.destroy();
      process.exit(0);
    } catch (err) {
      console.error("[backfill] FATAL:", err);
      await client.destroy();
      process.exit(1);
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
