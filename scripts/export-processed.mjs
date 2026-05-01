#!/usr/bin/env node
// Extracts only the chat-quality processed tables into a small DB for shipping
// back to EC2. Skips raw tables (bot owns those).

import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';

const SRC = process.env.DB_PATH || 'data/data.db';
const OUT = process.argv[2] || '/tmp/processed-export.db';

if (existsSync(OUT)) unlinkSync(OUT);

const src = new Database(SRC, { readonly: true });
const dst = new Database(OUT);
dst.pragma('journal_mode = WAL');
dst.pragma('synchronous = OFF');

// Embeddings excluded — they're large (~5GB) and only used for downstream
// scoring on EC2's own cron, which can re-embed new rows itself. The dashboard
// reads ctx/effort/resonance/overlay directly.
const TABLES = [
	'general_messages_ctx',
	'general_messages_effort',
	'general_messages_resonance',
	'general_messages_overlay_weekly'
];

for (const t of TABLES) {
	const sql = src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t)?.sql;
	if (!sql) { console.log(`skip ${t} (not found)`); continue; }
	dst.exec(sql);
	const count = src.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
	console.log(`${t}: ${count.toLocaleString()} rows`);

	const cols = src.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
	const placeholders = cols.map(() => '?').join(',');
	const insert = dst.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`);
	const tx = dst.transaction((rs) => {
		for (const r of rs) insert.run(...cols.map((c) => r[c]));
	});

	const CHUNK = 50_000;
	let offset = 0;
	while (offset < count) {
		const rows = src.prepare(`SELECT * FROM ${t} LIMIT ? OFFSET ?`).all(CHUNK, offset);
		tx(rows);
		offset += rows.length;
		process.stdout.write(`\r  ${t}: ${offset.toLocaleString()}/${count.toLocaleString()}`);
		if (!rows.length) break;
	}
	process.stdout.write('\n');
}

src.close();
dst.close();
console.log(`wrote ${OUT}`);
