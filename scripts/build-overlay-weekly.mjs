#!/usr/bin/env node
/**
 * scripts/build-overlay-weekly.mjs
 *
 * Materializes the 10-metric overlay into general_messages_overlay_weekly.
 * The dashboard read becomes a 250-row SELECT instead of iterating ~1.8M
 * raw messages every visit.
 *
 * Default mode: re-compute the last 4 weeks (handles in-flight messages
 * that arrived since the last run).
 *
 * Full mode (--full): wipe and rebuild every week from epoch.
 *
 * Usage:
 *   node scripts/build-overlay-weekly.mjs            # incremental (4 weeks)
 *   node scripts/build-overlay-weekly.mjs --full     # full rebuild
 *   node scripts/build-overlay-weekly.mjs --since 1700000000  # since epoch
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || 'data/data.db';
const LOWLIST_PATH = path.resolve('scripts/lowlist.json');

const WEEK_S = 7 * 86400;
const EPOCH_TO_MONDAY = 4 * 86400;

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const sinceArg = args.indexOf('--since');
const SINCE_OVERRIDE = sinceArg >= 0 ? parseInt(args[sinceArg + 1], 10) : null;

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;

function tokensOf(s) {
	return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean);
}
function maxCharRun(s) {
	let m = 1, c = 1;
	for (let i = 1; i < s.length; i++) {
		if (s[i] === s[i - 1] && /\S/.test(s[i])) { c++; if (c > m) m = c; } else c = 1;
	}
	return m;
}
function gini(values) {
	const n = values.length;
	if (n === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((s, v) => s + v, 0);
	if (sum === 0) return 0;
	let cum = 0;
	for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * sorted[i];
	return cum / (n * sum);
}
function median(arr) {
	if (!arr.length) return 0;
	const s = [...arr].sort((a, b) => a - b);
	const n = s.length;
	return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function weekStartOf(ts) {
	return Math.floor((ts - EPOCH_TO_MONDAY) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY;
}

const lowlistRaw = JSON.parse(readFileSync(LOWLIST_PATH, 'utf8'));
const LOWLIST = new Set((lowlistRaw.tokens ?? []).map((t) => String(t).toLowerCase()));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');
db.pragma('cache_size = -262144');
db.pragma('mmap_size = 1073741824');
db.pragma('temp_store = MEMORY');

db.exec(`
	CREATE TABLE IF NOT EXISTS general_messages_overlay_weekly (
		week_start          INTEGER PRIMARY KEY,
		count               INTEGER NOT NULL,
		effort              REAL    NOT NULL,
		heuristic           REAL    NOT NULL,
		resonance           REAL    NOT NULL,
		median_length       REAL    NOT NULL,
		lexical_diversity   REAL    NOT NULL,
		question_rate       REAL    NOT NULL,
		no_repeat_spam      REAL    NOT NULL,
		no_lowlist_hit      REAL    NOT NULL,
		reply_rate          REAL    NOT NULL,
		author_distribution REAL    NOT NULL,
		computed_at_s       INTEGER NOT NULL
	);
`);

let sinceS;
if (SINCE_OVERRIDE !== null) {
	sinceS = SINCE_OVERRIDE;
} else if (FULL) {
	db.prepare('DELETE FROM general_messages_overlay_weekly').run();
	sinceS = 0;
} else {
	const last = db.prepare('SELECT MAX(week_start) AS w FROM general_messages_overlay_weekly').get();
	sinceS = (last.w ?? Math.floor(Date.now() / 1000) - 4 * WEEK_S) - 4 * WEEK_S;
	if (sinceS < 0) sinceS = 0;
}

console.log(`[overlay] mode=${FULL ? 'full' : 'incremental'} since=${sinceS} (${new Date(sinceS * 1000).toISOString()})`);

const totalRows = db.prepare(`
	SELECT COUNT(*) AS c
	FROM general_messages_raw r
	WHERE r.created_at_s >= ? AND r.is_bot = 0 AND length(r.content) > 0
`).get(sinceS).c;
console.log(`[overlay] iterating ${totalRows} raw rows`);

const stmt = db.prepare(`
	SELECT
		r.id, r.created_at_s, r.author_id, r.content, r.reply_to,
		s.score   AS heuristic,
		eff.score AS effort,
		res.score AS resonance
	FROM general_messages_raw r
	LEFT JOIN general_messages_score s     ON s.id   = r.id
	LEFT JOIN general_messages_effort eff  ON eff.id = r.id
	LEFT JOIN general_messages_resonance res ON res.id = r.id
	WHERE r.created_at_s >= ? AND r.is_bot = 0 AND length(r.content) > 0
	ORDER BY r.created_at_s
`);

const buckets = new Map();
let processed = 0;

for (const r of stmt.iterate(sinceS)) {
	const w = weekStartOf(r.created_at_s);
	let b = buckets.get(w);
	if (!b) {
		b = {
			n: 0, sumEffort: 0, nEffort: 0, sumHeur: 0, nHeur: 0, sumReso: 0, nReso: 0,
			lengths: [], uniqueTokens: new Set(), totalTokens: 0,
			questions: 0, repeatSpam: 0, lowlistHits: 0, replies: 0,
			authorCounts: new Map()
		};
		buckets.set(w, b);
	}
	b.n++;
	if (r.effort !== null) { b.sumEffort += r.effort; b.nEffort++; }
	if (r.heuristic !== null) { b.sumHeur += r.heuristic; b.nHeur++; }
	if (r.resonance !== null) { b.sumReso += r.resonance; b.nReso++; }

	const toks = tokensOf(r.content);
	b.lengths.push(toks.length);
	b.totalTokens += toks.length;
	for (const t of toks) b.uniqueTokens.add(t);
	if (r.content.includes('?')) b.questions++;
	if (maxCharRun(r.content) >= 4) b.repeatSpam++;
	if (toks.length > 0 && toks.length <= 3 && toks.every((t) => LOWLIST.has(t))) b.lowlistHits++;
	if (r.reply_to) b.replies++;
	b.authorCounts.set(r.author_id, (b.authorCounts.get(r.author_id) ?? 0) + 1);

	processed++;
	if (processed % 50000 === 0) {
		process.stdout.write(`\r[overlay] ${processed}/${totalRows} rows, ${buckets.size} weeks`);
	}
}
process.stdout.write(`\r[overlay] ${processed}/${totalRows} rows, ${buckets.size} weeks\n`);

const upsert = db.prepare(`
	INSERT INTO general_messages_overlay_weekly (
		week_start, count, effort, heuristic, resonance,
		median_length, lexical_diversity, question_rate,
		no_repeat_spam, no_lowlist_hit, reply_rate, author_distribution,
		computed_at_s
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(week_start) DO UPDATE SET
		count = excluded.count,
		effort = excluded.effort,
		heuristic = excluded.heuristic,
		resonance = excluded.resonance,
		median_length = excluded.median_length,
		lexical_diversity = excluded.lexical_diversity,
		question_rate = excluded.question_rate,
		no_repeat_spam = excluded.no_repeat_spam,
		no_lowlist_hit = excluded.no_lowlist_hit,
		reply_rate = excluded.reply_rate,
		author_distribution = excluded.author_distribution,
		computed_at_s = excluded.computed_at_s
`);

const upsertMany = db.transaction((rows) => {
	for (const r of rows) upsert.run(...r);
});

const nowS = Math.floor(Date.now() / 1000);
const rows = [];
for (const [weekStart, b] of buckets.entries()) {
	rows.push([
		weekStart,
		b.n,
		b.nEffort ? b.sumEffort / b.nEffort : 0,
		b.nHeur ? b.sumHeur / b.nHeur : 0,
		b.nReso ? b.sumReso / b.nReso : 0,
		median(b.lengths),
		b.totalTokens > 0 ? Math.log1p(b.uniqueTokens.size) / Math.log1p(b.totalTokens) : 0,
		b.questions / b.n,
		1 - b.repeatSpam / b.n,
		1 - b.lowlistHits / b.n,
		b.replies / b.n,
		1 - gini([...b.authorCounts.values()]),
		nowS
	]);
}
upsertMany(rows);

console.log(`[overlay] upserted ${rows.length} weeks`);
db.close();
