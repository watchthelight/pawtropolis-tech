/**
 * scripts/embed-incremental.mjs
 *
 * Embed up to MAX_BATCH unembedded general_messages_raw rows that have a
 * matching general_messages_ctx entry. Cron-friendly: each invocation
 * loads the model, processes a capped batch, and exits so memory is
 * released between runs (~200MB peak for transformers.js).
 *
 * Usage:
 *   node scripts/embed-incremental.mjs              # default 5000 rows
 *   node scripts/embed-incremental.mjs --batch 2000
 */

import { pipeline, env } from '@xenova/transformers';
import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
env.allowLocalModels = false;

const args = process.argv.slice(2);
const batchArg = args.indexOf('--batch');
const MAX_BATCH = batchArg >= 0 ? parseInt(args[batchArg + 1], 10) : 5000;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const todo = db.prepare(`
  SELECT r.id, r.content AS target, c.ctx_json
  FROM general_messages_raw r
  JOIN general_messages_ctx c ON c.id = r.id
  LEFT JOIN general_messages_embed e ON e.id = r.id
  WHERE e.id IS NULL
    AND r.is_bot = 0
    AND length(r.content) > 0
  ORDER BY r.created_at_s ASC
  LIMIT ?
`).all(MAX_BATCH);

if (todo.length === 0) {
  console.log('[embed-inc] nothing to do');
  process.exit(0);
}

console.log(`[embed-inc] ${todo.length} rows to embed`);
console.log('[embed-inc] loading Xenova/all-MiniLM-L6-v2 ...');
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

function ctxText(json) {
  const ctx = JSON.parse(json || '[]');
  if (ctx.length === 0) return ' ';
  const t = ctx.map((m) => m.content || '').filter(Boolean).join(' ');
  return t || ' ';
}

const insert = db.prepare(`
  INSERT OR REPLACE INTO general_messages_embed (id, target_vec, ctx_vec, embedded_at_s)
  VALUES (?, ?, ?, ?)
`);

const t0 = Date.now();
const BATCH = 32;
const D = 384;
let done = 0;

for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  const targets = slice.map((r) => r.target || ' ');
  const ctxs = slice.map((r) => ctxText(r.ctx_json));

  const tEmb = await extractor(targets, { pooling: 'mean', normalize: true });
  const cEmb = await extractor(ctxs,    { pooling: 'mean', normalize: true });

  const td = tEmb.data, cd = cEmb.data;
  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    for (let k = 0; k < slice.length; k++) {
      const tv = Buffer.from(new Float32Array(td.slice(k * D, (k + 1) * D)).buffer);
      const cv = Buffer.from(new Float32Array(cd.slice(k * D, (k + 1) * D)).buffer);
      insert.run(slice[k].id, tv, cv, now);
    }
  });
  tx();

  done += slice.length;
  if (done % (BATCH * 8) === 0 || done === todo.length) {
    const elapsed = (Date.now() - t0) / 1000;
    const rate = done / elapsed;
    process.stdout.write(`\r[embed-inc] ${done}/${todo.length}  ${rate.toFixed(1)}/s    `);
  }
}
process.stdout.write('\n');

db.close();
