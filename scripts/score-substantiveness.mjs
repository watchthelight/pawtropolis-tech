#!/usr/bin/env node
/**
 * scripts/score-substantiveness.mjs
 *
 * Per-message substantiveness composite. Designed to be the second-lens
 * companion to effort: distinguishes "talkative" from "high-content".
 *
 *   composite = 0.5 * novelty + 0.3 * not_filler + 0.2 * lexical_density
 *
 * Components (all in [0, 1], higher = better):
 *   novelty         = clip(1 - cosine(target_vec, ctx_vec), 0, 1)
 *                     ctx_vec is pre-computed in general_messages_embed.
 *   not_filler      = 0 if normalized message matches scripts/filler-bank.json
 *                     phrase set, else 1.
 *   lexical_density = unique non-stopword content tokens / total content tokens.
 *                     Strips URLs, mentions, custom emojis. 0 when no content tokens.
 *
 * Resumable: skips ids already present in general_messages_substantiveness.
 * Cron-friendly: capped batch via --batch.
 *
 * Usage:
 *   node scripts/score-substantiveness.mjs                 # default 5000
 *   node scripts/score-substantiveness.mjs --batch 50000   # workstation
 *   node scripts/score-substantiveness.mjs --rescore       # blow away and redo
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';

const DB_PATH    = process.env.DB_PATH || 'data/data.db';
const BANK_PATH  = 'scripts/filler-bank.json';

const args = process.argv.slice(2);
const RESCORE = args.includes('--rescore');
const batchArg = args.indexOf('--batch');
const BATCH = batchArg >= 0 ? parseInt(args[batchArg + 1], 10) : 5000;

if (!existsSync(BANK_PATH)) {
	console.error(`missing ${BANK_PATH} — run scripts/build-filler-bank.mjs first`);
	process.exit(1);
}
const bank = JSON.parse(readFileSync(BANK_PATH, 'utf8'));
const FILLER = new Set(bank.phrases.map((p) => p.toLowerCase()));
console.log(`[subst] loaded ${FILLER.size} filler phrases`);

// English stopwords (small list, intentionally conservative).
const STOP = new Set([
	'a','an','the','and','or','but','if','then','than','that','this','these','those',
	'i','me','my','you','your','he','she','it','its','we','our','they','them','their',
	'is','am','are','was','were','be','been','being','have','has','had','do','does','did',
	'of','to','in','on','at','by','for','with','from','as','so','no','not','yes','yeah',
	'will','would','can','could','should','may','might','just','also','too',
	'one','two','some','any','all','each','every','more','most','other','only'
]);

const URL_RE     = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE   = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
const PUNCT_TRAIL = /[!?.,;:~\-_*]+$/;

function normalizeForBank(s) {
	return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').replace(/\s+/g, ' ').trim().replace(PUNCT_TRAIL, '');
}
function contentTokens(s) {
	return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/[\s.,!?;:()\[\]'"~`]+/).filter((t) => t && !STOP.has(t));
}

function vec(buf) {
	return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
function cosine(a, b) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
	return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}
function clip01(x) { return Math.max(0, Math.min(1, x)); }

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');
db.pragma('cache_size = -262144');

db.exec(`
	CREATE TABLE IF NOT EXISTS general_messages_substantiveness (
		id              TEXT PRIMARY KEY,
		created_at_s    INTEGER NOT NULL,
		score           REAL    NOT NULL,
		novelty         REAL    NOT NULL,
		not_filler      REAL    NOT NULL,
		lexical_density REAL    NOT NULL,
		scored_at_s     INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_subst_time ON general_messages_substantiveness(created_at_s);
`);

if (RESCORE) {
	db.exec('DELETE FROM general_messages_substantiveness');
	console.log('[rescore] cleared general_messages_substantiveness');
}

const todo = db.prepare(`
	SELECT r.id, r.created_at_s, r.content, e.target_vec, e.ctx_vec
	FROM general_messages_raw r
	JOIN general_messages_embed e ON e.id = r.id
	LEFT JOIN general_messages_substantiveness s ON s.id = r.id
	WHERE s.id IS NULL
	  AND r.is_bot = 0
	  AND length(r.content) > 0
	ORDER BY r.created_at_s
	LIMIT ?
`).all(BATCH);

if (todo.length === 0) {
	console.log('[subst] nothing to score');
	process.exit(0);
}
console.log(`[subst] scoring ${todo.length.toLocaleString()} messages`);

const insert = db.prepare(`
	INSERT INTO general_messages_substantiveness
		(id, created_at_s, score, novelty, not_filler, lexical_density, scored_at_s)
	VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const nowS = Math.floor(Date.now() / 1000);
const tx = db.transaction((rows) => {
	for (const r of rows) {
		const tv = vec(r.target_vec), cv = vec(r.ctx_vec);
		const novelty = clip01(1 - cosine(tv, cv));

		const norm = normalizeForBank(r.content);
		const not_filler = norm && FILLER.has(norm) ? 0 : 1;

		const toks = contentTokens(r.content);
		const lexical_density = toks.length > 0 ? new Set(toks).size / toks.length : 0;

		const score = 0.5 * novelty + 0.3 * not_filler + 0.2 * lexical_density;
		insert.run(r.id, r.created_at_s, score, novelty, not_filler, lexical_density, nowS);
	}
});

const CHUNK = 1000;
const t0 = Date.now();
for (let i = 0; i < todo.length; i += CHUNK) {
	tx(todo.slice(i, i + CHUNK));
	const done = Math.min(i + CHUNK, todo.length);
	const sec = (Date.now() - t0) / 1000;
	const rate = done / sec;
	process.stdout.write(`\r[subst] ${done.toLocaleString()}/${todo.length.toLocaleString()}  ${rate.toFixed(0)}/s`);
}
process.stdout.write('\n');

const stats = db.prepare(`
	SELECT COUNT(*) AS n, AVG(score) AS mean_score, AVG(novelty) AS mean_nov,
	       AVG(not_filler) AS mean_nf, AVG(lexical_density) AS mean_dens
	FROM general_messages_substantiveness
`).get();
console.log(`[stats] count=${stats.n.toLocaleString()}  composite=${stats.mean_score.toFixed(3)}  novelty=${stats.mean_nov.toFixed(3)}  not_filler=${stats.mean_nf.toFixed(3)}  density=${stats.mean_dens.toFixed(3)}`);
db.close();
