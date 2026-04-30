/**
 * scripts/score-effort-v1.mjs
 *
 * Apply the trained v1 effort model (models/effort_v1.json) to every
 * embedded human message. Writes general_messages_effort.
 *
 * Resumable: skips ids already scored.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const MODEL_PATH = 'models/effort_v1.json';
const BATCH = 5000;

const lowlist = new Set(JSON.parse(readFileSync('scripts/lowlist.json', 'utf8')).tokens.map((t) => t.toLowerCase()));
const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
const { means, stds, weights, hand_features: HAND_FEATURES } = model;

console.log(`[model] ${model.version} trained ${model.trained_at}`);
console.log(`[model] features=${HAND_FEATURES.length} hand + 1 cosine + 384 target + 384 diff = ${HAND_FEATURES.length + 1 + 384 + 384}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_effort (
    id           TEXT PRIMARY KEY,
    created_at_s INTEGER NOT NULL,
    score        REAL NOT NULL,
    model        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gme_time ON general_messages_effort(created_at_s);
`);

// ---- features (mirror train-effort-v1.mjs exactly) ----

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
function tokens(s) { return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean); }
function shannon(counts) { const total = counts.reduce((s, c) => s + c, 0); if (!total) return 0; let h = 0; for (const c of counts) { if (!c) continue; const p = c / total; h -= p * Math.log2(p); } return h; }
function maxCharRun(s) { let m = 1, c = 1; for (let i = 1; i < s.length; i++) { if (s[i] === s[i - 1] && /\S/.test(s[i])) { c++; if (c > m) m = c; } else c = 1; } return m; }
function maxWordRun(toks) { let m = 1, c = 1; for (let i = 1; i < toks.length; i++) { if (toks[i] === toks[i - 1]) { c++; if (c > m) m = c; } else c = 1; } return m; }
function jaccard(a, b) { const A = new Set(a), B = new Set(b); if (A.size === 0 && B.size === 0) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }

function handFeatures(row) {
  const content = row.content || '';
  const toks = tokens(content);
  const wc = toks.length, cc = content.length;
  let letters = 0, digits = 0, punct = 0, nonascii = 0, caps = 0;
  for (const ch of content) {
    if (/[a-zA-Z]/.test(ch)) { letters++; if (ch >= 'A' && ch <= 'Z') caps++; }
    else if (/[0-9]/.test(ch)) digits++;
    else if (/[^\s]/.test(ch)) { if (ch.charCodeAt(0) > 127) nonascii++; else punct++; }
  }
  const total = letters + digits + punct + nonascii;
  const freq = new Map();
  for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1);
  const wordEntropy = shannon([...freq.values()]);
  const cFreq = new Map();
  for (const ch of content) cFreq.set(ch, (cFreq.get(ch) ?? 0) + 1);
  const charEntropy = shannon([...cFreq.values()]);
  const charRun = maxCharRun(content);
  const wordRun = maxWordRun(toks);
  const ctx = JSON.parse(row.ctx_json || '[]');
  const ctxTokens = ctx.flatMap((m) => tokens(m.content || ''));
  const ctxChars = ctx.reduce((s, m) => s + (m.content || '').length, 0);
  const lowHits = toks.filter((t) => lowlist.has(t)).length;
  return [
    Math.log1p(cc), Math.log1p(wc), wc ? freq.size / wc : 0, wc ? cc / wc : 0,
    total ? letters / total : 0, total ? digits / total : 0, total ? nonascii / total : 0, total ? punct / total : 0, letters ? caps / letters : 0,
    Math.min(1, charRun / 10), Math.min(1, wordRun / 10),
    URL_RE.test(content) ? 1 : 0, MENTION_RE.test(content) ? 1 : 0, content.includes('?') ? 1 : 0,
    row.attachments > 0 ? 1 : 0, row.embeds > 0 ? 1 : 0, row.reply_to ? 1 : 0,
    wc ? lowHits / wc : 0, wc > 0 && wc <= 3 && lowHits === wc ? 1 : 0,
    wordEntropy, charEntropy,
    ctx.length, jaccard(toks, ctxTokens), Math.log1p(ctxChars),
  ];
}

function bufToFloat32(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function predict(row) {
  const t = bufToFloat32(row.target_vec);
  const c = bufToFloat32(row.ctx_vec);
  let cosine = 0;
  for (let i = 0; i < t.length; i++) cosine += t[i] * c[i];

  const hand = handFeatures(row);
  const D = t.length;
  const x = new Array(hand.length + 1 + D + D);
  for (let i = 0; i < hand.length; i++) x[i] = hand[i];
  x[hand.length] = cosine;
  for (let i = 0; i < D; i++) x[hand.length + 1 + i] = t[i];
  for (let i = 0; i < D; i++) x[hand.length + 1 + D + i] = t[i] - c[i];

  // standardize + apply weights
  let yh = weights[0]; // bias
  for (let j = 0; j < x.length; j++) {
    const xs = (x[j] - means[j]) / stds[j];
    yh += weights[j + 1] * xs;
  }
  return Math.max(0, Math.min(1, yh));
}

console.log('[query] selecting unscored embedded rows...');
const todo = db.prepare(`
  SELECT
    r.id, r.created_at_s, r.content, r.attachments, r.embeds, r.reply_to,
    c.ctx_json,
    e.target_vec, e.ctx_vec
  FROM general_messages_raw r
  JOIN general_messages_ctx c ON c.id = r.id
  JOIN general_messages_embed e ON e.id = r.id
  LEFT JOIN general_messages_effort eff ON eff.id = r.id
  WHERE eff.id IS NULL
    AND r.is_bot = 0
  ORDER BY r.created_at_s
`).all();

console.log(`[todo] ${todo.length} rows to score`);
if (todo.length === 0) { console.log('[done] all rows already scored'); process.exit(0); }

const insert = db.prepare(`INSERT OR REPLACE INTO general_messages_effort (id, created_at_s, score, model) VALUES (?, ?, ?, ?)`);
const insertMany = db.transaction((batch) => {
  for (const r of batch) insert.run(r.id, r.created_at_s, r.score, model.version);
});

const t0 = Date.now();
let buf = [], total = 0;
for (const row of todo) {
  buf.push({ id: row.id, created_at_s: row.created_at_s, score: predict(row) });
  if (buf.length >= BATCH) {
    insertMany(buf);
    total += buf.length;
    buf = [];
    const elapsed = (Date.now() - t0) / 1000;
    const rate = total / elapsed;
    process.stdout.write(`\r[score] ${total}/${todo.length}  ${rate.toFixed(0)}/s    `);
  }
}
if (buf.length) { insertMany(buf); total += buf.length; }
process.stdout.write(`\r[score] ${total}/${todo.length}\n`);

const stats = db.prepare(`SELECT COUNT(*) c, AVG(score) a, MIN(score) mn, MAX(score) mx FROM general_messages_effort`).get();
console.log(`[stats] count=${stats.c}  mean=${stats.a?.toFixed(3)}  min=${stats.mn?.toFixed(3)}  max=${stats.mx?.toFixed(3)}`);

db.close();
