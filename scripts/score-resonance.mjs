/**
 * scripts/score-resonance.mjs
 *
 * v1 resonance from reply graph only (reactions deferred to a future pass).
 *
 * For each msg id:
 *   reply_count = number of msgs whose reply_to == id
 *
 * Resonance score = log1p(reply_count) / log1p(P95(reply_count))
 * → most msgs land at 0; well-replied msgs ramp toward 1; viral threads cap at 1.
 */

import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_resonance (
    id           TEXT PRIMARY KEY,
    created_at_s INTEGER NOT NULL,
    reply_count  INTEGER NOT NULL,
    score        REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gmres_time ON general_messages_resonance(created_at_s);
`);

console.log('[query] counting direct replies per message...');
const replyCounts = db.prepare(`
  SELECT reply_to AS id, COUNT(*) AS n
  FROM general_messages_raw
  WHERE reply_to IS NOT NULL
  GROUP BY reply_to
`).all();
const replyMap = new Map(replyCounts.map((r) => [r.id, r.n]));
console.log(`[stats] ${replyCounts.length} messages received at least one reply`);

// determine P95 reply count for normalization
const counts = replyCounts.map((r) => r.n).sort((a, b) => a - b);
const p95 = counts[Math.floor(counts.length * 0.95)] || 5;
const norm = Math.log1p(p95) || 1;
console.log(`[norm] p95 reply count = ${p95}, normalizer = log1p(p95) = ${norm.toFixed(3)}`);

const all = db.prepare(`
  SELECT id, created_at_s
  FROM general_messages_raw
  WHERE is_bot = 0
`).all();

const insert = db.prepare(`INSERT OR REPLACE INTO general_messages_resonance (id, created_at_s, reply_count, score) VALUES (?, ?, ?, ?)`);
const insertMany = db.transaction((batch) => {
  for (const r of batch) insert.run(r.id, r.created_at_s, r.reply_count, r.score);
});

const BATCH = 5000;
let buf = [], total = 0;
for (const row of all) {
  const rc = replyMap.get(row.id) ?? 0;
  const score = Math.min(1, Math.log1p(rc) / norm);
  buf.push({ id: row.id, created_at_s: row.created_at_s, reply_count: rc, score });
  if (buf.length >= BATCH) {
    insertMany(buf);
    total += buf.length;
    buf = [];
    process.stdout.write(`\r[score] ${total}`);
  }
}
if (buf.length) { insertMany(buf); total += buf.length; }
process.stdout.write(`\r[score] ${total}\n`);

const stats = db.prepare(`
  SELECT COUNT(*) c, AVG(score) avg, AVG(reply_count) avg_rc, MAX(reply_count) max_rc
  FROM general_messages_resonance
`).get();
console.log(`[stats] count=${stats.c}  mean=${stats.avg?.toFixed(3)}  avg_replies=${stats.avg_rc?.toFixed(2)}  max_replies=${stats.max_rc}`);

db.close();
