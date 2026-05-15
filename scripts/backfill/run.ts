/**
 * Pawtropolis Tech — scripts/backfill/run.ts
 * WHAT: One-shot backfill of every message (humans + bots) + reactor lists
 *       in the primary guild. Resumable per-channel via backfill_progress.
 * USAGE:
 *   npx dotenvx run -- tsx scripts/backfill/run.ts
 *   FLAGS: --channels=ID1,ID2  --skip-reactions  --resume-only
 *
 * RATE-LIMITED via RateLimiter (40 req/s global, 4 req/s per channel).
 * Live SSE dashboard at /dashboard/backfill reads backfill_stats.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { Client, GatewayIntentBits, ChannelType, type TextBasedChannel, type Message } from "discord.js";
import Database from "better-sqlite3";
import { RateLimiter } from "./rateLimiter.js";
import { StatsEmitter } from "./stats.js";

const FETCH_PAGE = 100; // Discord max

interface ChannelTarget {
  id: string;
  name: string;
  type: "channel" | "thread";
}

interface CliArgs {
  channels?: string[];
  skipReactions: boolean;
  resumeOnly: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = { skipReactions: false, resumeOnly: false };
  for (const a of argv) {
    if (a.startsWith("--channels=")) args.channels = a.slice(11).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--skip-reactions") args.skipReactions = true;
    else if (a === "--resume-only") args.resumeOnly = true;
  }
  return args;
}

function openDb(): Database.Database {
  const dbPath = process.env.DB_PATH || "./data/data.db";
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 10000");
  return db;
}

function dbPath(): string {
  return process.env.DB_PATH || "./data/data.db";
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("DISCORD_TOKEN missing");
    process.exit(1);
  }
  const guildId = process.env.GUILD_ID || "896070888594759740";
  const args = parseArgs();

  console.log(`[backfill] guild=${guildId} args=${JSON.stringify(args)}`);

  const stats = new StatsEmitter(dbPath());
  stats.setState("starting");
  stats.start(2000);

  const db = openDb();
  const limiter = new RateLimiter({ globalRps: 40, perChannelRps: 4 });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("ready", async () => {
    try {
      console.log(`[backfill] connected as ${client.user!.tag}`);
      const guild = await client.guilds.fetch(guildId);

      // Enumerate all text-based channels + active+archived threads
      const channels = await guild.channels.fetch();
      const targets: ChannelTarget[] = [];
      for (const ch of channels.values()) {
        if (!ch) continue;
        if (
          ch.type === ChannelType.GuildText ||
          ch.type === ChannelType.GuildAnnouncement ||
          ch.type === ChannelType.GuildForum
        ) {
          if (ch.type !== ChannelType.GuildForum) targets.push({ id: ch.id, name: ch.name, type: "channel" });
          // active threads
          try {
            await limiter.acquire(ch.id);
            const at = await ch.threads.fetchActive();
            for (const t of at.threads.values()) targets.push({ id: t.id, name: t.name, type: "thread" });
            await limiter.acquire(ch.id);
            const arch = await ch.threads.fetchArchived({ limit: 100 });
            for (const t of arch.threads.values()) targets.push({ id: t.id, name: t.name, type: "thread" });
          } catch (err) {
            console.warn(`[backfill] thread enum failed for #${ch.name}: ${(err as Error).message}`);
          }
        }
      }

      // Filter to requested channels if --channels was passed
      const finalTargets = args.channels
        ? targets.filter((t) => args.channels!.includes(t.id))
        : targets;

      // Init backfill_progress rows
      const upsertProgress = db.prepare(`
        INSERT INTO backfill_progress (channel_id, guild_id, channel_name, status, updated_at_s)
        VALUES (?, ?, ?, 'pending', strftime('%s','now'))
        ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name, updated_at_s = strftime('%s','now')
      `);
      for (const t of finalTargets) upsertProgress.run(t.id, guildId, t.name);

      // Skip channels already complete unless --resume-only forces re-run
      const completedSet = new Set(
        (db.prepare(`SELECT channel_id FROM backfill_progress WHERE status = 'complete'`).all() as Array<{ channel_id: string }>).map((r) => r.channel_id)
      );
      const workQueue = args.resumeOnly
        ? finalTargets.filter((t) => !completedSet.has(t.id))
        : finalTargets;

      stats.setChannelsTotal(finalTargets.length);
      stats.setState("running");
      console.log(`[backfill] targets=${finalTargets.length} pending=${workQueue.length}`);

      const insertMsg = db.prepare(`
        INSERT INTO messages_archive (
          message_id, guild_id, channel_id, thread_id, author_id, author_name,
          author_is_bot, content, attachments_json, embeds_json, reply_to_id,
          is_edited, created_at_s, edited_at_s, ingest_source
        ) VALUES (
          @message_id, @guild_id, @channel_id, @thread_id, @author_id, @author_name,
          @author_is_bot, @content, @attachments_json, @embeds_json, @reply_to_id,
          @is_edited, @created_at_s, @edited_at_s, 'backfill'
        )
        ON CONFLICT(message_id) DO NOTHING
      `);
      const insertReaction = db.prepare(`
        INSERT OR IGNORE INTO message_reactions_archive (message_id, emoji, user_id, ingest_source)
        VALUES (?, ?, ?, 'backfill')
      `);
      const updateProgress = db.prepare(`
        UPDATE backfill_progress SET
          oldest_seen_id = ?, oldest_seen_ts = ?,
          newest_seen_id = COALESCE(newest_seen_id, ?), newest_seen_ts = COALESCE(newest_seen_ts, ?),
          messages_fetched = messages_fetched + ?,
          reactions_fetched = reactions_fetched + ?,
          status = ?, last_error = ?,
          started_at_s = COALESCE(started_at_s, strftime('%s','now')),
          completed_at_s = CASE WHEN ? = 'complete' THEN strftime('%s','now') ELSE completed_at_s END,
          updated_at_s = strftime('%s','now')
        WHERE channel_id = ?
      `);

      for (const target of workQueue) {
        stats.setCurrentChannel(target.id, target.name);
        console.log(`[backfill] → #${target.name} (${target.id})`);

        // Resume cursor: oldest_seen_id → use as `before` for next page
        const cursor = db.prepare(`SELECT oldest_seen_id FROM backfill_progress WHERE channel_id = ?`).get(target.id) as
          | { oldest_seen_id: string | null }
          | undefined;
        let before: string | undefined = cursor?.oldest_seen_id ?? undefined;
        let pageMsgs = 0;
        let pageReacts = 0;
        let firstNewestId: string | null = null;
        let firstNewestTs: number | null = null;

        try {
          const channel = (await client.channels.fetch(target.id)) as TextBasedChannel | null;
          if (!channel || !("messages" in channel)) {
            updateProgress.run(null, null, null, null, 0, 0, "skipped", "channel-not-text", "skipped", target.id);
            stats.incChannelsCompleted();
            continue;
          }

          while (true) {
            await limiter.acquire(target.id);
            const batch: import("discord.js").Collection<string, Message> = await channel.messages.fetch({
              limit: FETCH_PAGE,
              before,
            });
            if (batch.size === 0) break;

            const rows: Array<Record<string, unknown>> = [];
            const reactRows: Array<[string, string, string]> = [];
            let oldestIdInPage: string | null = null;
            let oldestTsInPage: number | null = null;

            for (const m of batch.values()) {
              if (!firstNewestId) {
                firstNewestId = m.id;
                firstNewestTs = Math.floor(m.createdTimestamp / 1000);
              }
              oldestIdInPage = m.id;
              oldestTsInPage = Math.floor(m.createdTimestamp / 1000);

              rows.push({
                message_id: m.id,
                guild_id: guildId,
                channel_id: target.type === "channel" ? target.id : ("parentId" in m.channel ? (m.channel.parentId ?? target.id) : target.id),
                thread_id: target.type === "thread" ? target.id : null,
                author_id: m.author.id,
                author_name: m.author.globalName ?? m.author.username,
                author_is_bot: m.author.bot ? 1 : 0,
                content: m.content ?? "",
                attachments_json: m.attachments.size > 0 ? JSON.stringify([...m.attachments.values()].map((a) => a.url)) : null,
                embeds_json: m.embeds.length > 0 ? JSON.stringify(m.embeds.map((e) => ({ type: e.data.type, url: e.data.url, title: e.data.title }))) : null,
                reply_to_id: m.reference?.messageId ?? null,
                is_edited: m.editedTimestamp ? 1 : 0,
                created_at_s: Math.floor(m.createdTimestamp / 1000),
                edited_at_s: m.editedTimestamp ? Math.floor(m.editedTimestamp / 1000) : null,
              });

              if (!args.skipReactions && m.reactions.cache.size > 0) {
                for (const r of m.reactions.cache.values()) {
                  const emoji = r.emoji.id
                    ? `<${r.emoji.animated ? "a" : ""}:${r.emoji.name ?? "_"}:${r.emoji.id}>`
                    : r.emoji.name ?? "?";
                  let after: string | undefined;
                  while (true) {
                    await limiter.acquire(target.id);
                    const users: import("discord.js").Collection<string, import("discord.js").User> = await r.users.fetch({ limit: 100, after });
                    if (users.size === 0) break;
                    for (const u of users.values()) reactRows.push([m.id, emoji, u.id]);
                    if (users.size < 100) break;
                    after = users.lastKey();
                  }
                }
              }
            }

            db.transaction(() => {
              for (const row of rows) insertMsg.run(row);
              for (const [mid, emoji, uid] of reactRows) insertReaction.run(mid, emoji, uid);
            })();

            pageMsgs += rows.length;
            pageReacts += reactRows.length;
            stats.incMessages(rows.length);
            stats.incReactions(reactRows.length);

            updateProgress.run(
              oldestIdInPage,
              oldestTsInPage,
              firstNewestId,
              firstNewestTs,
              rows.length,
              reactRows.length,
              "running",
              null,
              "running",
              target.id
            );

            if (batch.size < FETCH_PAGE) break;
            before = oldestIdInPage ?? undefined;
          }

          updateProgress.run(before ?? null, null, firstNewestId, firstNewestTs, 0, 0, "complete", null, "complete", target.id);
          stats.incChannelsCompleted();
          console.log(`[backfill] ✓ #${target.name} msgs=${pageMsgs} reacts=${pageReacts}`);
        } catch (err) {
          const msg = (err as Error).message;
          console.error(`[backfill] ✗ #${target.name}: ${msg}`);
          updateProgress.run(before ?? null, null, firstNewestId, firstNewestTs, 0, 0, "error", msg, "error", target.id);
          stats.incChannelsCompleted();
        }
      }

      stats.setCurrentChannel(null, null);
      stats.setState("complete");
      stats.stop();
      console.log(`[backfill] DONE — channels=${stats["state"].channels_completed} msgs=${stats["state"].messages_total} reacts=${stats["state"].reactions_total}`);
      stats.close();
      db.close();
      await client.destroy();
      process.exit(0);
    } catch (err) {
      console.error("[backfill] FATAL:", err);
      stats.setState("error");
      stats.stop();
      stats.close();
      db.close();
      process.exit(1);
    }
  });

  await client.login(token);

  // Graceful shutdown on SIGTERM
  const shutdown = async () => {
    console.log("[backfill] SIGTERM — flushing");
    stats.setState("paused");
    stats.stop();
    stats.close();
    db.close();
    await client.destroy();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
