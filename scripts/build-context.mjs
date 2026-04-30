/**
 * scripts/build-context.mjs
 *
 * For every row in general_messages_raw, materialize the last 3 messages
 * (oldest-first) into general_messages_ctx as a JSON array.
 *
 * Schema:
 *   ctx_json = '[{"ts":int,"author_id":str,"content":str}, ...]'
 *   First 3 messages of the channel get a shorter array; first row gets [].
 */

import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
const WINDOW = 3;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_ctx (
    id       TEXT PRIMARY KEY,
    ctx_json TEXT NOT NULL
  );
`);

console.log('[load] reading rows ordered by time...');
const rows = db.prepare(`
  SELECT id, created_at_s, author_id, content
  FROM general_messages_raw
  ORDER BY created_at_s ASC, id ASC
`).all();
console.log(`[load] ${rows.length} rows`);

const insert = db.prepare(`INSERT OR REPLACE INTO general_messages_ctx (id, ctx_json) VALUES (?, ?)`);
const insertMany = db.transaction((batch) => {
  for (const r of batch) insert.run(r.id, r.ctx);
});

const window = []; // sliding window of last WINDOW msgs (oldest first)
let buf = [];
let total = 0;
const BATCH = 5000;

for (const row of rows) {
  const ctx = window.map((m) => ({ ts: m.created_at_s, author_id: m.author_id, content: m.content }));
  buf.push({ id: row.id, ctx: JSON.stringify(ctx) });

  window.push(row);
  if (window.length > WINDOW) window.shift();

  if (buf.length >= BATCH) {
    insertMany(buf);
    total += buf.length;
    buf = [];
    process.stdout.write(`\r[ctx] ${total}`);
  }
}
if (buf.length) {
  insertMany(buf);
  total += buf.length;
}
process.stdout.write(`\r[ctx] ${total}\n`);

const stats = db.prepare(`SELECT COUNT(*) c FROM general_messages_ctx`).get();
console.log(`[done] ctx rows: ${stats.c}`);

db.close();
