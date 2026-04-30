/**
 * scripts/quality-snapshot.mjs (LOCAL ONLY)
 *
 * Builds a portable SQLite snapshot containing only the chat-quality tables
 * for shipment to EC2. The snapshot file is written to data/quality-snapshot.db
 * and can be SCP'd onto the bot host, then attached via scripts/quality-sync.sql
 * to merge into the live data.db.
 *
 * Steps:
 *   1. Backup the entire live local data.db to a working copy.
 *   2. Drop every table that ISN'T in the chat-quality whitelist.
 *   3. VACUUM to reclaim space.
 *
 * This avoids dump/restore round-trips and preserves indexes + page
 * structure exactly. ~3.5 GB output for the current corpus.
 */

import Database from 'better-sqlite3';
import { copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs';

const SRC = 'data/data.db';
const DST = 'data/quality-snapshot.db';

const KEEP_TABLES = new Set([
  'general_messages_raw',
  'general_messages_ctx',
  'general_messages_embed',
  'general_messages_effort',
  'general_messages_resonance',
  'general_messages_score',
  'general_messages_label',
  'general_messages_gold',
  'user_names',
]);

if (!existsSync(SRC)) {
  console.error(`[fatal] source db not found: ${SRC}`);
  process.exit(1);
}
if (existsSync(DST)) {
  console.log(`[reset] removing existing ${DST}`);
  unlinkSync(DST);
}

console.log(`[copy] ${SRC} → ${DST}  (${(statSync(SRC).size / 1024 / 1024).toFixed(0)} MB)`);
copyFileSync(SRC, DST);

const db = new Database(DST);
db.pragma('journal_mode = DELETE'); // simpler for one-shot work
db.pragma('foreign_keys = OFF');

const allTables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
const drop = allTables.filter((n) => !KEEP_TABLES.has(n) && !n.startsWith('sqlite_'));
console.log(`[plan] drop ${drop.length} of ${allTables.length} tables (keep ${KEEP_TABLES.size}).`);

const dropTx = db.transaction((names) => {
  for (const n of names) db.exec(`DROP TABLE IF EXISTS "${n}"`);
});
dropTx(drop);

// Drop orphan indexes that reference missing tables
const idx = db.prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type='index'`).all();
for (const r of idx) {
  if (!KEEP_TABLES.has(r.tbl_name)) {
    try { db.exec(`DROP INDEX IF EXISTS "${r.name}"`); } catch { /* best-effort */ }
  }
}

console.log('[vacuum] reclaiming pages...');
db.exec('VACUUM');

const finalSize = statSync(DST).size / 1024 / 1024;
console.log(`[done] snapshot ready: ${DST}  (${finalSize.toFixed(0)} MB)`);

const counts = db.prepare(`
  SELECT 'raw' AS t, COUNT(*) AS n FROM general_messages_raw UNION ALL
  SELECT 'ctx', COUNT(*) FROM general_messages_ctx UNION ALL
  SELECT 'embed', COUNT(*) FROM general_messages_embed UNION ALL
  SELECT 'effort', COUNT(*) FROM general_messages_effort UNION ALL
  SELECT 'resonance', COUNT(*) FROM general_messages_resonance UNION ALL
  SELECT 'score', COUNT(*) FROM general_messages_score UNION ALL
  SELECT 'label', COUNT(*) FROM general_messages_label UNION ALL
  SELECT 'gold', COUNT(*) FROM general_messages_gold UNION ALL
  SELECT 'user_names', COUNT(*) FROM user_names
`).all();
for (const c of counts) console.log(`  ${c.t.padEnd(12)} ${c.n.toLocaleString()}`);

db.close();
