/**
 * scripts/quality-snapshot-stage1.mjs
 *
 * Build a small snapshot containing ONLY general_messages_raw +
 * general_messages_ctx for shipment to EC2. Use when the EC2 sync
 * already has effort/resonance/score/label/gold/user_names but is
 * missing raw/ctx (e.g. disk-full mid-import).
 */

import Database from 'better-sqlite3';
import { copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs';

const SRC = 'data/data.db';
const DST = 'data/quality-snapshot-stage1.db';

const KEEP = new Set(['general_messages_raw', 'general_messages_ctx']);

if (existsSync(DST)) unlinkSync(DST);
copyFileSync(SRC, DST);
console.log(`[copy] ${(statSync(DST).size / 1024 / 1024).toFixed(0)} MB`);

const db = new Database(DST);
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = OFF');

const all = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
const drop = all.filter((n) => !KEEP.has(n) && !n.startsWith('sqlite_'));
const tx = db.transaction((names) => { for (const n of names) db.exec(`DROP TABLE IF EXISTS "${n}"`); });
tx(drop);

// Drop orphan indexes
for (const r of db.prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type='index'`).all()) {
  if (!KEEP.has(r.tbl_name)) try { db.exec(`DROP INDEX IF EXISTS "${r.name}"`); } catch {}
}

console.log('[vacuum] reclaiming...');
db.exec('VACUUM');
console.log(`[done] ${DST}  ${(statSync(DST).size / 1024 / 1024).toFixed(0)} MB`);

for (const c of db.prepare(`
  SELECT 'raw' AS t, COUNT(*) AS n FROM general_messages_raw UNION ALL
  SELECT 'ctx', COUNT(*) FROM general_messages_ctx
`).all()) console.log(`  ${c.t}: ${c.n.toLocaleString()}`);

db.close();
