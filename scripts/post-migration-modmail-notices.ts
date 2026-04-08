// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * scripts/post-migration-modmail-notices.ts
 *
 * WHAT: One-shot courtesy script for the bot identity swap (new Discord application).
 *       For every OPEN modmail ticket, posts a single notice in the user's DM AND in
 *       the staff thread saying "the bot was updated, your conversation continues."
 *
 * WHY:  Modmail technically auto-recovers (new bot keeps routing user DMs to the staff
 *       thread, and staff replies still DM the user). But the previous bot's "ticket
 *       opened" message and any in-thread bot UI buttons stop being clickable after the
 *       application swap, which can confuse users mid-conversation. A one-line "we're
 *       still here" message resolves the confusion.
 *
 * IDEMPOTENT: adds a `bot_migration_notified_at` column to modmail_ticket on first run;
 *             only notifies tickets where it's NULL; sets it on success. Re-running is
 *             a no-op once every open ticket has been notified.
 *
 * REST-ONLY: uses discord.js REST client (no gateway connection). Safe to run while the
 *            production bot is online — there's no shard conflict because we never open
 *            a gateway session.
 *
 * USAGE (local):  npx tsx scripts/post-migration-modmail-notices.ts [--dry-run]
 * USAGE (remote): cd ~/pawtropolis-tech && npx tsx scripts/post-migration-modmail-notices.ts
 *
 * REQUIRES env: DISCORD_TOKEN, DB_PATH (defaults to ./data/data.db)
 */
import "dotenv/config";
import { REST, Routes } from "discord.js";
import Database from "better-sqlite3";
import path from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");

interface OpenTicket {
  id: number;
  guild_id: string;
  user_id: string;
  thread_id: string | null;
  thread_channel_id: string | null;
}

const USER_DM_NOTICE =
  "Hey — heads up: Pawtropolis staff just updated their bot. Your modmail conversation here is still open and active. " +
  "You can keep replying in this DM as normal — staff will see everything you send. Thanks for your patience.";

const THREAD_NOTICE =
  "**Bot updated** — this modmail ticket continues normally. Old buttons in the thread or in the user's DM may have stopped working, " +
  "but new replies in either direction are routed by the new bot exactly as before.";

async function createDMChannel(rest: REST, recipientId: string): Promise<string> {
  // POST /users/@me/channels — creates or returns the existing DM channel for a recipient
  // https://discord.com/developers/docs/resources/user#create-dm
  const result = (await rest.post(Routes.userChannels(), {
    body: { recipient_id: recipientId },
  })) as { id: string };
  return result.id;
}

async function sendMessage(rest: REST, channelId: string, content: string): Promise<void> {
  // POST /channels/{channel.id}/messages — works for DM channels and guild channels (incl. threads)
  // https://discord.com/developers/docs/resources/channel#create-message
  await rest.post(Routes.channelMessages(channelId), {
    body: { content },
  });
}

async function main() {
  const dbPath = path.resolve(process.env.DB_PATH ?? "./data/data.db");
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("[modmail-notice] DISCORD_TOKEN is required");
    process.exit(1);
  }

  console.info(`[modmail-notice] using DB: ${dbPath}`);
  console.info(`[modmail-notice] dry run: ${DRY_RUN}`);

  const db = new Database(dbPath);

  // Ensure idempotency column exists (matches the addColumnIfMissing pattern in src/db/db.ts)
  const cols = db.pragma("table_info(modmail_ticket)") as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "bot_migration_notified_at")) {
    db.prepare("ALTER TABLE modmail_ticket ADD COLUMN bot_migration_notified_at TEXT").run();
    console.info("[modmail-notice] added bot_migration_notified_at column");
  }

  const tickets = db
    .prepare(
      `SELECT id, guild_id, user_id, thread_id, thread_channel_id
         FROM modmail_ticket
        WHERE status = 'open'
          AND bot_migration_notified_at IS NULL`
    )
    .all() as OpenTicket[];

  console.info(`[modmail-notice] found ${tickets.length} open ticket(s) needing notice`);

  if (tickets.length === 0) {
    console.info("[modmail-notice] nothing to do, exiting");
    process.exit(0);
  }

  if (DRY_RUN) {
    for (const t of tickets) {
      console.info(
        `[modmail-notice] DRY-RUN ticket id=${t.id} guild=${t.guild_id} user=${t.user_id} thread=${t.thread_id ?? "(none)"}`
      );
    }
    process.exit(0);
  }

  // REST-only client: no gateway connection, no conflict with the running production bot
  const rest = new REST({ version: "10" }).setToken(token);

  const markNotified = db.prepare(
    "UPDATE modmail_ticket SET bot_migration_notified_at = datetime('now') WHERE id = ?"
  );

  let dmOk = 0;
  let dmFail = 0;
  let threadOk = 0;
  let threadFail = 0;

  for (const ticket of tickets) {
    let userResult = "skipped";
    let threadResult = "skipped";

    // 1) DM the user via REST: create-or-get DM channel, then post message
    try {
      const dmChannelId = await createDMChannel(rest, ticket.user_id);
      await sendMessage(rest, dmChannelId, USER_DM_NOTICE);
      userResult = "ok";
      dmOk++;
    } catch (err: unknown) {
      const code = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      userResult = `fail(${code ?? "unknown"})`;
      dmFail++;
    }

    // 2) Post in staff thread
    if (ticket.thread_id) {
      try {
        await sendMessage(rest, ticket.thread_id, THREAD_NOTICE);
        threadResult = "ok";
        threadOk++;
      } catch (err: unknown) {
        const code = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
        threadResult = `fail(${code ?? "unknown"})`;
        threadFail++;
      }
    }

    // Mark notified even on partial failure — the column tracks "we tried", not "succeeded"
    markNotified.run(ticket.id);

    console.info(
      `[modmail-notice] ticket id=${ticket.id} user=${ticket.user_id} dm=${userResult} thread=${threadResult}`
    );

    // Pacing: respect Discord's per-route rate limits (DM creates are quite restrictive)
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.info(
    `[modmail-notice] done. dm: ${dmOk} ok / ${dmFail} fail. thread: ${threadOk} ok / ${threadFail} fail.`
  );

  process.exit(0);
}

const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMainModule) {
  main().catch((err) => {
    console.error("[modmail-notice] fatal", err);
    process.exit(1);
  });
}
