/**
 * scripts/train-effort.mjs
 *
 * v0 distillation: ridge regression on hand-engineered features against
 * the LLM effort label.
 *
 * Goal of the spike: measure R² on a 100-msg holdout. Decide whether
 * the v1 production model needs sentence-transformer embeddings or
 * if features alone carry enough signal.
 *
 *   R² > 0.60  → keep features-only, scale gold to 5k, ship.
 *   R² 0.40-0.60 → add embeddings, retrain.
 *   R² < 0.40  → rethink rubric or features.
 *
 * Output:
 *   models/effort_v0.json   — weights + feature names + scaling
 *   _recon/effort_v0_eval.json — holdout predictions + worst disagreements
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const MODELS_DIR = 'models';
const OUT_DIR = '_recon';
const SEED = 42;
const HOLDOUT = 100;
const RIDGE_LAMBDA = 1.0;

const lowlist = new Set(JSON.parse(readFileSync('scripts/lowlist.json', 'utf8')).tokens.map((t) => t.toLowerCase()));

const db = new Database(DB_PATH, { readonly: true });
db.pragma('journal_mode = WAL');

const rows = db.prepare(`
  SELECT
    l.id, l.effort,
    r.content, r.author_id, r.attachments, r.embeds, r.reply_to,
    c.ctx_json
  FROM general_messages_label l
  JOIN general_messages_raw r ON r.id = l.id
  JOIN general_messages_ctx c ON c.id = l.id
`).all();
console.log(`[load] ${rows.length} labeled rows`);

// -------------------- feature extraction --------------------

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;

function tokens(s) {
  return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean);
}

function shannon(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function maxCharRun(s) {
  let m = 1, c = 1;
  for (let i = 1; i < s.length; i++) { if (s[i] === s[i - 1] && /\S/.test(s[i])) { c++; if (c > m) m = c; } else c = 1; }
  return m;
}

function maxWordRun(toks) {
  let m = 1, c = 1;
  for (let i = 1; i < toks.length; i++) { if (toks[i] === toks[i - 1]) { c++; if (c > m) m = c; } else c = 1; }
  return m;
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const FEATURES = [
  'char_len_log', 'word_count_log', 'uniq_word_ratio', 'avg_word_len',
  'alpha_ratio', 'digit_ratio', 'nonascii_ratio', 'punct_ratio', 'caps_ratio',
  'max_char_run_norm', 'max_word_run_norm',
  'has_url', 'has_mention', 'has_question', 'has_attachment', 'has_embed', 'is_reply',
  'lowlist_ratio', 'all_lowlist',
  'word_entropy', 'char_entropy',
  'ctx_msg_count', 'ctx_jaccard', 'ctx_total_chars_log',
];

function extractFeatures(row) {
  const content = row.content || '';
  const toks = tokens(content);
  const wc = toks.length;
  const cc = content.length;

  let letters = 0, digits = 0, punct = 0, nonascii = 0, caps = 0;
  for (const ch of content) {
    if (/[a-zA-Z]/.test(ch)) { letters++; if (ch >= 'A' && ch <= 'Z') caps++; }
    else if (/[0-9]/.test(ch)) digits++;
    else if (/[^\s]/.test(ch)) {
      if (ch.charCodeAt(0) > 127) nonascii++;
      else punct++;
    }
  }
  const total = letters + digits + punct + nonascii;

  // word-frequency entropy
  const freq = new Map();
  for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1);
  const wordEntropy = shannon([...freq.values()]);
  // char entropy
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
    Math.log1p(cc),
    Math.log1p(wc),
    wc ? freq.size / wc : 0,
    wc ? cc / wc : 0,
    total ? letters / total : 0,
    total ? digits / total : 0,
    total ? nonascii / total : 0,
    total ? punct / total : 0,
    letters ? caps / letters : 0,
    Math.min(1, charRun / 10),
    Math.min(1, wordRun / 10),
    URL_RE.test(content) ? 1 : 0,
    MENTION_RE.test(content) ? 1 : 0,
    content.includes('?') ? 1 : 0,
    row.attachments > 0 ? 1 : 0,
    row.embeds > 0 ? 1 : 0,
    row.reply_to ? 1 : 0,
    wc ? lowHits / wc : 0,
    wc > 0 && wc <= 3 && lowHits === wc ? 1 : 0,
    wordEntropy,
    charEntropy,
    ctx.length,
    jaccard(toks, ctxTokens),
    Math.log1p(ctxChars),
  ];
}

// -------------------- prepare X, y --------------------

const examples = rows.map((r) => ({ id: r.id, x: extractFeatures(r), y: r.effort, content: r.content }));

// deterministic shuffle
let seed = SEED;
function rand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
for (let i = examples.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [examples[i], examples[j]] = [examples[j], examples[i]];
}

const test = examples.slice(0, HOLDOUT);
const train = examples.slice(HOLDOUT);
console.log(`[split] train=${train.length}  test=${test.length}  features=${FEATURES.length}`);

// -------------------- standardize features --------------------

const F = FEATURES.length;
const means = new Array(F).fill(0), stds = new Array(F).fill(0);
for (const e of train) for (let j = 0; j < F; j++) means[j] += e.x[j];
for (let j = 0; j < F; j++) means[j] /= train.length;
for (const e of train) for (let j = 0; j < F; j++) stds[j] += (e.x[j] - means[j]) ** 2;
for (let j = 0; j < F; j++) stds[j] = Math.sqrt(stds[j] / train.length) || 1;

function standardize(x) { return x.map((v, j) => (v - means[j]) / stds[j]); }

// -------------------- ridge regression: w = (X^T X + λI)^-1 X^T y --------------------

function buildXy(set) {
  const X = set.map((e) => [1, ...standardize(e.x)]); // bias term
  const y = set.map((e) => e.y);
  return { X, y };
}

// matrix ops
function transpose(M) { const r = M.length, c = M[0].length; const T = Array.from({ length: c }, () => new Array(r)); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = M[i][j]; return T; }
function matmul(A, B) { const r = A.length, k = A[0].length, c = B[0].length; const C = Array.from({ length: r }, () => new Array(c).fill(0)); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { let s = 0; for (let m = 0; m < k; m++) s += A[i][m] * B[m][j]; C[i][j] = s; } return C; }
function matvec(A, v) { return A.map((row) => row.reduce((s, x, j) => s + x * v[j], 0)); }
function eye(n) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))); }
function addMat(A, B) { return A.map((row, i) => row.map((v, j) => v + B[i][j])); }
function solve(A, b) {
  // Gaussian elimination with partial pivoting
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error('singular matrix');
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

const { X: Xtr, y: ytr } = buildXy(train);
const Xt = transpose(Xtr);
const XtX = matmul(Xt, Xtr);
const I = eye(XtX.length);
I[0][0] = 0; // don't regularize bias
const reg = I.map((row) => row.map((v) => v * RIDGE_LAMBDA));
const A = addMat(XtX, reg);
const b = matvec(Xt, ytr);
const w = solve(A, b);

console.log(`[train] solved ridge with λ=${RIDGE_LAMBDA}`);

// -------------------- evaluate --------------------

function predict(x) {
  const xs = [1, ...standardize(x)];
  let yhat = 0;
  for (let j = 0; j < xs.length; j++) yhat += xs[j] * w[j];
  return Math.max(0, Math.min(1, yhat));
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

const trainMetrics = metrics(train);
const testMetrics = metrics(test);

console.log(`[train] R²=${trainMetrics.r2.toFixed(3)}  MAE=${trainMetrics.mae.toFixed(3)}`);
console.log(`[test ] R²=${testMetrics.r2.toFixed(3)}  MAE=${testMetrics.mae.toFixed(3)}`);

// Pearson on test
{
  const xs = test.map((e) => e.y), ys = testMetrics.yhats;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let n = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx2 += (xs[i] - mx) ** 2; dy2 += (ys[i] - my) ** 2; }
  console.log(`[test ] Pearson r=${(n / Math.sqrt(dx2 * dy2)).toFixed(3)}`);
}

// feature importance (|standardized coefficient|)
const importance = FEATURES.map((name, j) => ({ name, w: w[j + 1] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
console.log('\n[importance] top 10');
for (const f of importance.slice(0, 10)) console.log(`  ${f.w >= 0 ? '+' : ''}${f.w.toFixed(3)}  ${f.name}`);

// worst disagreements on holdout
const disagreements = test.map((e, i) => ({ id: e.id, y: e.y, yhat: testMetrics.yhats[i], err: testMetrics.yhats[i] - e.y, content: e.content }))
  .sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 30);

console.log('\n[disagreements] top 10 on holdout (yhat - y)');
for (const d of disagreements.slice(0, 10)) {
  const c = d.content.replace(/\n/g, ' ').slice(0, 80);
  const sign = d.err >= 0 ? '+' : '';
  console.log(`  ${sign}${d.err.toFixed(2)}  llm=${d.y.toFixed(2)}  pred=${d.yhat.toFixed(2)}  | ${c}`);
}

// -------------------- persist --------------------

if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const model = {
  version: 'effort_v0',
  trained_at: new Date().toISOString(),
  features: FEATURES,
  means, stds, weights: w, ridge_lambda: RIDGE_LAMBDA,
  train_size: train.length,
  test_size: test.length,
  metrics: { train: { r2: trainMetrics.r2, mae: trainMetrics.mae }, test: { r2: testMetrics.r2, mae: testMetrics.mae } },
  importance,
};
writeFileSync(`${MODELS_DIR}/effort_v0.json`, JSON.stringify(model, null, 2));

const evalReport = {
  generated_at: new Date().toISOString(),
  test_set: test.map((e, i) => ({ id: e.id, llm: e.y, pred: testMetrics.yhats[i] })),
  disagreements,
};
writeFileSync(`${OUT_DIR}/effort_v0_eval.json`, JSON.stringify(evalReport, null, 2));

console.log(`\n[wrote] ${MODELS_DIR}/effort_v0.json`);
console.log(`[wrote] ${OUT_DIR}/effort_v0_eval.json`);

db.close();
