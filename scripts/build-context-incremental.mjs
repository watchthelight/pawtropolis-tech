/**
 * scripts/build-context-incremental.mjs
 *
 * Materializes general_messages_ctx for any general_messages_raw row that
 * doesn't yet have one. Designed to run from cron under concurrent live
 * writes (the bot's messageActivityLogger inserts new raw rows continuously
 * for #general).
 *
 * Strategy: per missing row, look up the 3 most-recent rows whose
 * created_at_s < target.created_at_s. Builds an array of {ts, author_id,
 * content} and writes to general_messages_ctx. Capped at MAX_BATCH per run
 * so each cron invocation finishes promptly and releases memory.
 *
 * Usage:
 *   node scripts/build-context-incremental.mjs            # process up to 5000 rows
 *   node scripts/build-context-incremental.mjs --batch N  # custom batch
 */

import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
const args = process.argv.slice(2);
const batchArg = args.indexOf('--batch');
const MAX_BATCH = batchArg >= 0 ? parseInt(args[batchArg + 1], 10) : 5000;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const todo = db.prepare(`
  SELECT r.id, r.created_at_s
  FROM general_messages_raw r
  LEFT JOIN general_messages_ctx c ON c.id = r.id
  WHERE c.id IS NULL
  ORDER BY r.created_at_s ASC
  LIMIT ?
`).all(MAX_BATCH);

if (todo.length === 0) {
  console.log('[ctx-inc] nothing to do');
  process.exit(0);
}

console.log(`[ctx-inc] ${todo.length} rows to materialize`);

const ctxStmt = db.prepare(`
  SELECT created_at_s AS ts, author_id, content
  FROM general_messages_raw
  WHERE created_at_s < ?
  ORDER BY created_at_s DESC
  LIMIT 3
`);

const insert = db.prepare(`INSERT OR REPLACE INTO general_messages_ctx (id, ctx_json) VALUES (?, ?)`);
const insertMany = db.transaction((rows) => {
  for (const r of rows) insert.run(r.id, r.ctx_json);
});

let buf = [];
let total = 0;
const FLUSH = 500;

for (const row of todo) {
  // Last 3 rows before this one, newest-first → reverse to oldest-first for stable JSON shape.
  const recent = ctxStmt.all(row.created_at_s).reverse();
  buf.push({ id: row.id, ctx_json: JSON.stringify(recent) });
  if (buf.length >= FLUSH) {
    insertMany(buf);
    total += buf.length;
    buf = [];
    process.stdout.write(`\r[ctx-inc] ${total}/${todo.length}`);
  }
}
if (buf.length) {
  insertMany(buf);
  total += buf.length;
}
process.stdout.write(`\r[ctx-inc] ${total}/${todo.length}\n`);

db.close();
