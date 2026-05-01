#!/usr/bin/env node
/**
 * scripts/build-filler-bank.mjs
 *
 * Scans general_messages_raw, finds high-frequency short messages, writes
 * scripts/filler-bank.json. Used by score-substantiveness.mjs as the
 * filler-phrase penalty component.
 *
 * Bank format:
 *   { generated_at_s: <epoch>, threshold_min_count: N, phrases: ["...", ...] }
 *
 * Usage:
 *   node scripts/build-filler-bank.mjs           # default top 200
 *   node scripts/build-filler-bank.mjs --n 300   # bigger bank
 *   node scripts/build-filler-bank.mjs --min 50  # only phrases seen 50+ times
 */

import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

const DB = process.env.DB_PATH || 'data/data.db';
const OUT = 'scripts/filler-bank.json';

const args = process.argv.slice(2);
const argInt = (flag, def) => {
	const i = args.indexOf(flag);
	return i >= 0 ? parseInt(args[i + 1], 10) : def;
};
const N        = argInt('--n', 200);
const MIN_HITS = argInt('--min', 20);

const URL_RE     = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE   = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
const PUNCT_TRAIL = /[!?.,;:~\-_*]+$/;

function normalize(s) {
	return s
		.toLowerCase()
		.replace(URL_RE, ' ')
		.replace(MENTION_RE, ' ')
		.replace(EMOJI_RE, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(PUNCT_TRAIL, '');
}

function tokenCount(s) {
	return s.split(/\s+/).filter(Boolean).length;
}

const db = new Database(DB, { readonly: true });
console.log(`[filler] scanning ${DB}`);

const counts = new Map();
let inspected = 0;
const stmt = db.prepare(`
	SELECT content
	FROM general_messages_raw
	WHERE is_bot = 0 AND length(content) BETWEEN 1 AND 60
`);

for (const r of stmt.iterate()) {
	const norm = normalize(r.content);
	if (!norm) continue;
	if (tokenCount(norm) > 4) continue;
	counts.set(norm, (counts.get(norm) ?? 0) + 1);
	inspected++;
	if (inspected % 100000 === 0) process.stdout.write(`\r[filler] inspected ${inspected.toLocaleString()}, distinct ${counts.size.toLocaleString()}`);
}
process.stdout.write(`\r[filler] inspected ${inspected.toLocaleString()}, distinct ${counts.size.toLocaleString()}\n`);

const ranked = [...counts.entries()]
	.filter(([, n]) => n >= MIN_HITS)
	.sort((a, b) => b[1] - a[1])
	.slice(0, N);

console.log(`[filler] ${ranked.length} phrases at ≥${MIN_HITS} hits`);
console.log(`[filler] top 25:`);
for (const [phrase, n] of ranked.slice(0, 25)) {
	console.log(`  ${String(n).padStart(6)}  ${JSON.stringify(phrase)}`);
}

const out = {
	generated_at_s: Math.floor(Date.now() / 1000),
	threshold_min_count: MIN_HITS,
	phrases: ranked.map(([p]) => p),
	counts: Object.fromEntries(ranked)
};
writeFileSync(OUT, JSON.stringify(out, null, '\t'));
console.log(`[filler] wrote ${OUT} (${ranked.length} phrases)`);

db.close();
