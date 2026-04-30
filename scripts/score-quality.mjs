/**
 * scripts/score-quality.mjs
 *
 * Reads general_messages_raw, computes a 0..1 quality score per human message,
 * writes general_messages_score.
 *
 * Heuristic composite (see scripts/lowlist.json for the editable wordlist):
 *   length        +0.30 — log1p(words)/log1p(40)
 *   unique-token  +0.20 — uniqueTokens / totalTokens
 *   alpha density +0.10 — letters / (letters + non-alpha-non-space)
 *   repeat penalty -0.20 — runs of same char ≥4 (looool, sameeeee)
 *   low-effort    -0.40 — all tokens ∈ lowlist AND words ≤ 3
 *   attachment-only → score = 0.5 (neutral; image speaks for itself)
 *
 * Usage:
 *   node scripts/score-quality.mjs                # score everything not yet scored
 *   node scripts/score-quality.mjs --rescore      # blow away scores and redo
 *   node scripts/score-quality.mjs --sample 20    # print 20 random examples after scoring
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const LOWLIST_PATH = 'scripts/lowlist.json';

const args = process.argv.slice(2);
const RESCORE = args.includes('--rescore');
const sampleArg = args.indexOf('--sample');
const SAMPLE = sampleArg >= 0 ? parseInt(args[sampleArg + 1], 10) : 0;

const lowlist = new Set(JSON.parse(readFileSync(LOWLIST_PATH, 'utf8')).tokens.map((t) => t.toLowerCase()));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_score (
    id           TEXT PRIMARY KEY,
    created_at_s INTEGER NOT NULL,
    score        REAL NOT NULL,
    features     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gms_time ON general_messages_score(created_at_s);
`);

if (RESCORE) {
  db.exec(`DELETE FROM general_messages_score`);
  console.log('[rescore] cleared general_messages_score');
}

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function countLetters(s) {
  let letters = 0, nonAlpha = 0;
  for (const ch of s) {
    if (/[a-zA-Z]/.test(ch)) letters++;
    else if (!/\s/.test(ch)) nonAlpha++;
  }
  return { letters, nonAlpha };
}

function maxRepeatRun(s) {
  let max = 1, cur = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1] && /[a-zA-Z]/.test(s[i])) {
      cur++;
      if (cur > max) max = cur;
    } else cur = 1;
  }
  return max;
}

function score(content, attachments, embeds) {
  const trimmed = content.trim();

  if (!trimmed && (attachments > 0 || embeds > 0)) {
    return { score: 0.5, features: { reason: 'attachment-only' } };
  }
  if (!trimmed) {
    return { score: 0.0, features: { reason: 'empty' } };
  }

  const tokens = tokenize(trimmed);
  const words = tokens.length;
  const uniq = new Set(tokens).size;
  const { letters, nonAlpha } = countLetters(trimmed);
  const repeatRun = maxRepeatRun(trimmed);

  const f_len = Math.min(1, Math.log1p(words) / Math.log1p(40));
  const f_uniq = words ? uniq / words : 0;
  const f_alpha = letters + nonAlpha > 0 ? letters / (letters + nonAlpha) : 0;
  const f_repeat = repeatRun >= 4 ? Math.min(1, (repeatRun - 3) / 5) : 0;

  const allLow = words > 0 && words <= 3 && tokens.every((t) => lowlist.has(t));
  const f_low = allLow ? 1 : 0;

  let s = 0.30 * f_len + 0.20 * f_uniq + 0.10 * f_alpha
        - 0.20 * f_repeat - 0.40 * f_low;

  // base offset so a "normal" 10-word message lands around 0.55
  s += 0.10;

  s = Math.max(0, Math.min(1, s));

  return {
    score: s,
    features: { words, uniq, letters, nonAlpha, repeatRun, lowHit: allLow },
  };
}

const selectStmt = RESCORE
  ? db.prepare(`SELECT id, created_at_s, content, attachments, embeds, is_bot FROM general_messages_raw WHERE is_bot = 0`)
  : db.prepare(`
      SELECT r.id, r.created_at_s, r.content, r.attachments, r.embeds, r.is_bot
      FROM general_messages_raw r
      LEFT JOIN general_messages_score s ON s.id = r.id
      WHERE s.id IS NULL AND r.is_bot = 0
    `);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO general_messages_score (id, created_at_s, score, features)
  VALUES (?, ?, ?, ?)
`);

const insertMany = db.transaction((rows) => {
  for (const r of rows) insertStmt.run(r.id, r.created_at_s, r.score, JSON.stringify(r.features));
});

const BATCH = 5000;
let buf = [];
let total = 0;

for (const row of selectStmt.iterate()) {
  const out = score(row.content, row.attachments, row.embeds);
  buf.push({ id: row.id, created_at_s: row.created_at_s, score: out.score, features: out.features });
  if (buf.length >= BATCH) {
    insertMany(buf);
    total += buf.length;
    buf = [];
    process.stdout.write(`\r[scored] ${total}`);
  }
}
if (buf.length) {
  insertMany(buf);
  total += buf.length;
}
process.stdout.write(`\r[scored] ${total}\n`);

const stats = db.prepare(`SELECT COUNT(*) AS c, AVG(score) AS avg, MIN(score) AS mn, MAX(score) AS mx FROM general_messages_score`).get();
console.log(`[stats] count=${stats.c}  mean=${stats.avg?.toFixed(3)}  min=${stats.mn?.toFixed(3)}  max=${stats.mx?.toFixed(3)}`);

if (SAMPLE > 0) {
  const rows = db.prepare(`
    SELECT s.score, s.features, r.content
    FROM general_messages_score s
    JOIN general_messages_raw r ON r.id = s.id
    ORDER BY RANDOM() LIMIT ?
  `).all(SAMPLE);
  console.log(`\n[sample ${SAMPLE}]`);
  for (const r of rows) {
    const c = r.content.replace(/\n/g, ' ').slice(0, 80);
    console.log(`${r.score.toFixed(2)}  ${c}`);
  }
}

db.close();
