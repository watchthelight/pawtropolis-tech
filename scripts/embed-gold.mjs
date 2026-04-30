/**
 * scripts/embed-gold.mjs
 *
 * Embeds every gold-set message + its 3-msg context (concatenated)
 * via Xenova/all-MiniLM-L6-v2. Stores 384-d float32 vectors as BLOBs.
 *
 * Schema:
 *   general_messages_embed (id PK, target_vec BLOB, ctx_vec BLOB, embedded_at_s)
 */

import { pipeline, env } from '@xenova/transformers';
import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
env.allowLocalModels = false;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_embed (
    id            TEXT PRIMARY KEY,
    target_vec    BLOB NOT NULL,
    ctx_vec       BLOB NOT NULL,
    embedded_at_s INTEGER NOT NULL
  );
`);

const todo = db.prepare(`
  SELECT g.id, r.content AS target, c.ctx_json
  FROM general_messages_gold g
  JOIN general_messages_raw r ON r.id = g.id
  JOIN general_messages_ctx c ON c.id = g.id
  LEFT JOIN general_messages_embed e ON e.id = g.id
  WHERE e.id IS NULL
  ORDER BY g.id
`).all();

console.log(`[todo] ${todo.length} rows to embed`);
if (todo.length === 0) { console.log('[done] all gold rows already embedded'); process.exit(0); }

console.log('[load] Xenova/all-MiniLM-L6-v2 ...');
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
console.log('[ready]');

function ctxText(json) {
  const ctx = JSON.parse(json || '[]');
  if (ctx.length === 0) return '';
  return ctx.map((m) => m.content || '').filter(Boolean).join(' ');
}

const insert = db.prepare(`INSERT OR REPLACE INTO general_messages_embed (id, target_vec, ctx_vec, embedded_at_s) VALUES (?, ?, ?, ?)`);

const t0 = Date.now();
const BATCH = 16;
let done = 0;

for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  const targets = slice.map((r) => r.target || ' ');
  const ctxs = slice.map((r) => ctxText(r.ctx_json) || ' ');

  const tEmb = await extractor(targets, { pooling: 'mean', normalize: true });
  const cEmb = await extractor(ctxs, { pooling: 'mean', normalize: true });

  // tEmb / cEmb are Tensors of shape [BATCH, 384]
  const td = tEmb.data, cd = cEmb.data;
  const D = 384;
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
  const elapsed = (Date.now() - t0) / 1000;
  const rate = done / elapsed;
  const eta = (todo.length - done) / rate;
  process.stdout.write(`\r[embed] ${done}/${todo.length}  ${rate.toFixed(1)}/s  ETA ${Math.round(eta)}s    `);
}
process.stdout.write('\n');

const stats = db.prepare(`SELECT COUNT(*) c FROM general_messages_embed`).get();
console.log(`[done] embeddings: ${stats.c}`);

db.close();
