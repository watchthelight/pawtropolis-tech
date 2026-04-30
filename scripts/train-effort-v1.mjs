/**
 * scripts/train-effort-v1.mjs
 *
 * v1 distillation: v0 features + sentence-transformer embeddings.
 * Adds:
 *   - cosine_sim(target, ctx) — single scalar relevance signal
 *   - all 384 target-embedding dims
 *   - 384 (target − ctx) difference dims
 * → 793 features total. Heavy ridge regularization (λ=200) handles small N.
 *
 * Compare test R² and Pearson against v0 (R²=0.32, r=0.58).
 *
 * Output:
 *   models/effort_v1.json
 *   _recon/effort_v1_eval.json
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const MODELS_DIR = 'models';
const OUT_DIR = '_recon';
const SEED = 42;
const HOLDOUT = 100;
const RIDGE_LAMBDA = 200;
const D = 384;

const lowlist = new Set(JSON.parse(readFileSync('scripts/lowlist.json', 'utf8')).tokens.map((t) => t.toLowerCase()));

const db = new Database(DB_PATH, { readonly: true });
db.pragma('journal_mode = WAL');

const rows = db.prepare(`
  SELECT
    l.id, l.effort,
    r.content, r.author_id, r.attachments, r.embeds, r.reply_to,
    c.ctx_json,
    e.target_vec, e.ctx_vec
  FROM general_messages_label l
  JOIN general_messages_raw r ON r.id = l.id
  JOIN general_messages_ctx c ON c.id = l.id
  JOIN general_messages_embed e ON e.id = l.id
`).all();
console.log(`[load] ${rows.length} labeled+embedded rows`);

// ---- v0 hand features (same as train-effort.mjs, kept inline for clarity) ----

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
function tokens(s) { return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean); }
function shannon(counts) { const total = counts.reduce((s, c) => s + c, 0); if (!total) return 0; let h = 0; for (const c of counts) { if (!c) continue; const p = c / total; h -= p * Math.log2(p); } return h; }
function maxCharRun(s) { let m = 1, c = 1; for (let i = 1; i < s.length; i++) { if (s[i] === s[i - 1] && /\S/.test(s[i])) { c++; if (c > m) m = c; } else c = 1; } return m; }
function maxWordRun(toks) { let m = 1, c = 1; for (let i = 1; i < toks.length; i++) { if (toks[i] === toks[i - 1]) { c++; if (c > m) m = c; } else c = 1; } return m; }
function jaccard(a, b) { const A = new Set(a), B = new Set(b); if (A.size === 0 && B.size === 0) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }

const HAND_FEATURES = [
  'char_len_log', 'word_count_log', 'uniq_word_ratio', 'avg_word_len',
  'alpha_ratio', 'digit_ratio', 'nonascii_ratio', 'punct_ratio', 'caps_ratio',
  'max_char_run_norm', 'max_word_run_norm',
  'has_url', 'has_mention', 'has_question', 'has_attachment', 'has_embed', 'is_reply',
  'lowlist_ratio', 'all_lowlist',
  'word_entropy', 'char_entropy',
  'ctx_msg_count', 'ctx_jaccard', 'ctx_total_chars_log',
];

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

// ---- embedding features ----

function bufToFloat32(buf) {
  // BLOBs stored as Buffer; reinterpret as Float32 view
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // normalized vectors → dot == cosine
}

function buildFeatures(row) {
  const t = bufToFloat32(row.target_vec);
  const c = bufToFloat32(row.ctx_vec);
  const sim = cosine(t, c);

  const hand = handFeatures(row);
  const diff = new Array(D);
  for (let i = 0; i < D; i++) diff[i] = t[i] - c[i];

  return { x: [...hand, sim, ...t, ...diff], target: t, ctx: c };
}

const examples = rows.map((r) => {
  const { x } = buildFeatures(r);
  return { id: r.id, x, y: r.effort, content: r.content };
});
const nFeatures = examples[0].x.length;
console.log(`[features] hand=${HAND_FEATURES.length} + cosine=1 + target=${D} + diff=${D} = ${nFeatures}`);

// deterministic shuffle
let seed = SEED;
function rand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
for (let i = examples.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [examples[i], examples[j]] = [examples[j], examples[i]]; }

const test = examples.slice(0, HOLDOUT);
const train = examples.slice(HOLDOUT);
console.log(`[split] train=${train.length}  test=${test.length}`);

// standardize
const F = nFeatures;
const means = new Array(F).fill(0), stds = new Array(F).fill(0);
for (const e of train) for (let j = 0; j < F; j++) means[j] += e.x[j];
for (let j = 0; j < F; j++) means[j] /= train.length;
for (const e of train) for (let j = 0; j < F; j++) stds[j] += (e.x[j] - means[j]) ** 2;
for (let j = 0; j < F; j++) stds[j] = Math.sqrt(stds[j] / train.length) || 1;

function standardize(x) { const out = new Array(x.length); for (let j = 0; j < x.length; j++) out[j] = (x[j] - means[j]) / stds[j]; return out; }

// ---- ridge regression ----
// Solve (X^T X + λI) w = X^T y, with bias not regularized.
// Matrix size = (F+1)×(F+1). Here F ≈ 793 so the system is ~794×794, ~5MB float64. OK.

console.log('[train] building X^T X ...');
const Xtr = train.map((e) => [1, ...standardize(e.x)]); // bias
const ytr = train.map((e) => e.y);
const dim = Xtr[0].length;

// XtX = X^T X (symmetric); compute as upper triangle then mirror
const XtX = Array.from({ length: dim }, () => new Float64Array(dim));
for (let r = 0; r < Xtr.length; r++) {
  const xr = Xtr[r];
  for (let i = 0; i < dim; i++) {
    const xi = xr[i];
    if (xi === 0) continue;
    const row = XtX[i];
    for (let j = i; j < dim; j++) row[j] += xi * xr[j];
  }
}
for (let i = 0; i < dim; i++) for (let j = i + 1; j < dim; j++) XtX[j][i] = XtX[i][j];

// add λI (skip bias)
for (let i = 1; i < dim; i++) XtX[i][i] += RIDGE_LAMBDA;

// X^T y
const Xty = new Float64Array(dim);
for (let r = 0; r < Xtr.length; r++) { const xr = Xtr[r], yr = ytr[r]; for (let i = 0; i < dim; i++) Xty[i] += xr[i] * yr; }

console.log('[train] solving (Cholesky-style Gaussian elim) ...');

// Gaussian elimination with partial pivoting (in-place on augmented matrix)
const A = XtX.map((row, i) => Float64Array.from([...row, Xty[i]]));
for (let i = 0; i < dim; i++) {
  let p = i;
  for (let k = i + 1; k < dim; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
  if (p !== i) { const tmp = A[i]; A[i] = A[p]; A[p] = tmp; }
  if (Math.abs(A[i][i]) < 1e-12) throw new Error(`singular pivot at row ${i}`);
  for (let k = i + 1; k < dim; k++) {
    const f = A[k][i] / A[i][i];
    if (f === 0) continue;
    for (let j = i; j <= dim; j++) A[k][j] -= f * A[i][j];
  }
}
const w = new Float64Array(dim);
for (let i = dim - 1; i >= 0; i--) {
  let s = A[i][dim];
  for (let j = i + 1; j < dim; j++) s -= A[i][j] * w[j];
  w[i] = s / A[i][i];
}

console.log('[train] solved');

// evaluate
function predict(x) {
  const xs = standardize(x);
  let yh = w[0];
  for (let j = 0; j < xs.length; j++) yh += w[j + 1] * xs[j];
  return Math.max(0, Math.min(1, yh));
}

function metrics(set) {
  const yhats = set.map((e) => predict(e.x));
  const ymean = set.reduce((s, e) => s + e.y, 0) / set.length;
  let ssRes = 0, ssTot = 0, mae = 0;
  for (let i = 0; i < set.length; i++) {
    const d = set[i].y - yhats[i];
    ssRes += d * d;
    ssTot += (set[i].y - ymean) ** 2;
    mae += Math.abs(d);
  }
  return { r2: 1 - ssRes / ssTot, mae: mae / set.length, yhats };
}

const trainM = metrics(train), testM = metrics(test);
console.log(`[train] R²=${trainM.r2.toFixed(3)}  MAE=${trainM.mae.toFixed(3)}`);
console.log(`[test ] R²=${testM.r2.toFixed(3)}  MAE=${testM.mae.toFixed(3)}`);

{
  const xs = test.map((e) => e.y), ys = testM.yhats;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let n = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx2 += (xs[i] - mx) ** 2; dy2 += (ys[i] - my) ** 2; }
  console.log(`[test ] Pearson r=${(n / Math.sqrt(dx2 * dy2)).toFixed(3)}`);
}

// importance restricted to hand features + cosine (embedding dims are too many to interpret per-axis)
const importance = HAND_FEATURES.map((name, j) => ({ name, w: w[j + 1] }));
importance.push({ name: 'cosine_sim_target_ctx', w: w[1 + HAND_FEATURES.length] });
importance.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
console.log('\n[importance] top 10 (hand + cosine; embedding dims excluded for legibility)');
for (const f of importance.slice(0, 10)) console.log(`  ${f.w >= 0 ? '+' : ''}${f.w.toFixed(3)}  ${f.name}`);

const disagreements = test.map((e, i) => ({ id: e.id, y: e.y, yhat: testM.yhats[i], err: testM.yhats[i] - e.y, content: e.content }))
  .sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 30);

console.log('\n[disagreements] top 10 (yhat - y) on holdout');
for (const d of disagreements.slice(0, 10)) {
  const c = d.content.replace(/\n/g, ' ').slice(0, 80);
  console.log(`  ${d.err >= 0 ? '+' : ''}${d.err.toFixed(2)}  llm=${d.y.toFixed(2)}  pred=${d.yhat.toFixed(2)}  | ${c}`);
}

// persist
if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(`${MODELS_DIR}/effort_v1.json`, JSON.stringify({
  version: 'effort_v1',
  trained_at: new Date().toISOString(),
  hand_features: HAND_FEATURES,
  embedding_model: 'Xenova/all-MiniLM-L6-v2',
  feature_layout: 'hand(24) | cosine(1) | target(384) | diff(384) = 793',
  means: Array.from(means), stds: Array.from(stds), weights: Array.from(w),
  ridge_lambda: RIDGE_LAMBDA,
  train_size: train.length, test_size: test.length,
  metrics: { train: { r2: trainM.r2, mae: trainM.mae }, test: { r2: testM.r2, mae: testM.mae } },
  importance,
}, null, 2));

writeFileSync(`${OUT_DIR}/effort_v1_eval.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  test_set: test.map((e, i) => ({ id: e.id, llm: e.y, pred: testM.yhats[i] })),
  disagreements,
}, null, 2));

console.log(`\n[wrote] ${MODELS_DIR}/effort_v1.json`);
console.log(`[wrote] ${OUT_DIR}/effort_v1_eval.json`);

db.close();
