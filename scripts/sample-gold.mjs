/**
 * scripts/sample-gold.mjs
 *
 * Stratified sample for the v0 distillation gold set.
 * 5 length buckets × 4 heuristic-score bands = 20 strata, ~50 msgs each ≈ 1000.
 *
 * Stratification ensures we cover edge cases (short-but-clever, long-but-spammy,
 * etc.) instead of a uniform draw that gets crushed by the low-effort majority.
 */

import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
const PER_STRATUM = 50;
const SEED = 42; // determinism: re-runs pick the same sample

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_gold (
    id            TEXT PRIMARY KEY,
    stratum_len   INTEGER NOT NULL,
    stratum_score INTEGER NOT NULL,
    selected_at_s INTEGER NOT NULL
  );
`);

const existing = db.prepare(`SELECT COUNT(*) c FROM general_messages_gold`).get().c;
if (existing > 0) {
  console.log(`[skip] gold set already populated (${existing} rows). Delete first to resample.`);
  process.exit(0);
}

console.log('[query] computing strata + sampling...');

// SQLite RANDOM() is deterministic given a seed, but better-sqlite3 doesn't
// expose seeding directly. Workaround: select a deterministic order via abs(id-seed)
// hashing won't be perfectly uniform but is reproducible across runs.
const sql = `
  WITH eligible AS (
    SELECT
      r.id,
      r.content,
      s.score,
      CASE
        WHEN (length(r.content) - length(replace(r.content,' ','')) + 1) <= 3  THEN 0
        WHEN (length(r.content) - length(replace(r.content,' ','')) + 1) <= 10 THEN 1
        WHEN (length(r.content) - length(replace(r.content,' ','')) + 1) <= 25 THEN 2
        WHEN (length(r.content) - length(replace(r.content,' ','')) + 1) <= 60 THEN 3
        ELSE 4
      END AS lb,
      CASE
        WHEN s.score < 0.25 THEN 0
        WHEN s.score < 0.40 THEN 1
        WHEN s.score < 0.55 THEN 2
        ELSE 3
      END AS sb
    FROM general_messages_raw r
    JOIN general_messages_score s ON s.id = r.id
    WHERE r.is_bot = 0
      AND length(r.content) > 0
  ),
  ranked AS (
    SELECT id, lb, sb,
           ROW_NUMBER() OVER (
             PARTITION BY lb, sb
             ORDER BY (CAST(substr(id,-6) AS INTEGER) + ${SEED}) % 999983
           ) AS rn
    FROM eligible
  )
  SELECT id, lb, sb FROM ranked WHERE rn <= ${PER_STRATUM}
`;

const picks = db.prepare(sql).all();
console.log(`[picked] ${picks.length} rows across ${new Set(picks.map(p => p.lb*10+p.sb)).size} strata`);

const insert = db.prepare(`INSERT INTO general_messages_gold (id, stratum_len, stratum_score, selected_at_s) VALUES (?, ?, ?, ?)`);
const now = Math.floor(Date.now() / 1000);
const insertMany = db.transaction((rows) => {
  for (const r of rows) insert.run(r.id, r.lb, r.sb, now);
});
insertMany(picks);

// Stratum coverage report
const cov = db.prepare(`
  SELECT stratum_len lb, stratum_score sb, COUNT(*) c
  FROM general_messages_gold
  GROUP BY stratum_len, stratum_score
  ORDER BY stratum_len, stratum_score
`).all();

console.log('\nstratum coverage (lb=length-bucket 0..4, sb=score-band 0..3):');
console.log('lb\\sb |   0   1   2   3');
for (let lb = 0; lb <= 4; lb++) {
  const row = [`  ${lb}  |`];
  for (let sb = 0; sb <= 3; sb++) {
    const cell = cov.find((x) => x.lb === lb && x.sb === sb);
    row.push((cell?.c ?? 0).toString().padStart(4));
  }
  console.log(row.join(' '));
}

const total = db.prepare(`SELECT COUNT(*) c FROM general_messages_gold`).get().c;
console.log(`\n[done] gold set: ${total} rows`);

db.close();
