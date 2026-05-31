/**
 * scripts/backfill-general.mjs
 *
 * Pages Discord history for the #general channel backwards as far as
 * Discord will return and stores raw message rows in data/data.db (table:
 * general_messages_raw). No date floor — stops only when Discord returns
 * an empty page (channel start) or --limit hits.
 *
 * Resumable: state lives in _recon/backfill-general.cursor.json. Re-running
 * picks up at the oldest fetched message.
 *
 * Usage:
 *   node scripts/backfill-general.mjs                  # full run
 *   node scripts/backfill-general.mjs --limit 500      # smoke test
 *   node scripts/backfill-general.mjs --reset          # delete cursor + start over
 */

import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

const GUILD_ID = '896070888594759740';
const CHANNEL_ID = '896070889462976608';
const DB_PATH = 'data/data.db';
const CURSOR_PATH = '_recon/backfill-general.cursor.json';

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const limitVal = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;
if (limitArg >= 0 && !(Number.isFinite(limitVal) && limitVal > 0)) {
  console.error(`[error] --limit requires a positive number, got: ${args[limitArg + 1]}`);
  process.exit(1);
}
const LIMIT = Number.isFinite(limitVal) && limitVal > 0 ? limitVal : Infinity;
const RESET = args.includes('--reset');

if (RESET && existsSync(CURSOR_PATH)) {
  unlinkSync(CURSOR_PATH);
  console.log('[reset] cursor cleared');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_raw (
    id            TEXT PRIMARY KEY,
    created_at_s  INTEGER NOT NULL,
    author_id     TEXT NOT NULL,
    is_bot        INTEGER NOT NULL,
    content       TEXT NOT NULL,
    attachments   INTEGER NOT NULL,
    embeds        INTEGER NOT NULL,
    reply_to      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gmr_time ON general_messages_raw(created_at_s);
`);

const insert = db.prepare(`
  INSERT OR IGNORE INTO general_messages_raw
    (id, created_at_s, author_id, is_bot, content, attachments, embeds, reply_to)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertMany = db.transaction((rows) => {
  for (const r of rows) {
    insert.run(r.id, r.created_at_s, r.author_id, r.is_bot, r.content, r.attachments, r.embeds, r.reply_to);
  }
});

function loadCursor() {
  if (!existsSync(CURSOR_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, 'utf8'));
  } catch {
    return null;
  }
}
function saveCursor(c) {
  if (!existsSync(dirname(CURSOR_PATH))) mkdirSync(dirname(CURSOR_PATH), { recursive: true });
  writeFileSync(CURSOR_PATH, JSON.stringify(c, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`[ready] logged in as ${client.user?.tag}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      console.error('[fatal] channel not text');
      process.exit(1);
    }
    console.log(`[channel] #${channel.name} guild=${channel.guildId}`);

    let cursor = loadCursor() || { oldestId: null, oldestTs: null, pages: 0, total: 0 };
    if (cursor.oldestId) {
      console.log(`[resume] from ${cursor.oldestId} (${new Date((cursor.oldestTs ?? 0) * 1000).toISOString()}) — pages=${cursor.pages} total=${cursor.total}`);
    }

    let stop = false;
    let runAdded = 0;

    while (!stop) {
      const fetchOpts = { limit: 100 };
      if (cursor.oldestId) fetchOpts.before = cursor.oldestId;

      let batch;
      try {
        batch = await channel.messages.fetch(fetchOpts);
      } catch (e) {
        console.error(`[fetch-error] ${e.message}. retrying in 5s.`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (batch.size === 0) {
        console.log('[done] empty batch — reached channel start');
        break;
      }

      const sorted = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const rows = sorted.map((m) => ({
        id: m.id,
        created_at_s: Math.floor(m.createdTimestamp / 1000),
        author_id: m.author?.id ?? '0',
        is_bot: m.author?.bot ? 1 : 0,
        content: m.content ?? '',
        attachments: m.attachments?.size ?? 0,
        embeds: m.embeds?.length ?? 0,
        reply_to: m.reference?.messageId ?? null,
      }));

      insertMany(rows);
      const oldest = sorted[sorted.length - 1];
      cursor = {
        oldestId: oldest.id,
        oldestTs: Math.floor(oldest.createdTimestamp / 1000),
        pages: cursor.pages + 1,
        total: cursor.total + rows.length,
      };
      saveCursor(cursor);
      runAdded += rows.length;

      const oldestIso = new Date(cursor.oldestTs * 1000).toISOString();
      // Throttle stdout chatter for multi-day pm2 runs: log every page for the
      // first 50, then every 50th. Cursor file is the authoritative progress.
      if (cursor.pages <= 50 || cursor.pages % 50 === 0) {
        console.log(`[page ${cursor.pages}] +${rows.length}  total=${cursor.total}  oldest=${oldestIso}`);
      }

      if (runAdded >= LIMIT) {
        console.log(`[done] hit --limit ${LIMIT} for this run`);
        stop = true;
      }
    }

    const stats = db.prepare(`SELECT COUNT(*) AS c, MIN(created_at_s) AS lo, MAX(created_at_s) AS hi FROM general_messages_raw`).get();
    console.log(`[db] rows=${stats.c}  range=${new Date((stats.lo ?? 0) * 1000).toISOString()} → ${new Date((stats.hi ?? 0) * 1000).toISOString()}`);
  } catch (e) {
    console.error('[fatal]', e);
    process.exitCode = 1;
  } finally {
    db.close();
    await client.destroy();
    process.exit(process.exitCode ?? 0);
  }
});

client.login(process.env.DISCORD_TOKEN);
