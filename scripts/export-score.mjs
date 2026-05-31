import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';

const SRC = process.env.DB_PATH || 'data/data.db';
const OUT = process.argv[2] || '/tmp/score-export.db';
if (existsSync(OUT)) unlinkSync(OUT);

const src = new Database(SRC, { readonly: true });
const dst = new Database(OUT);
dst.pragma('journal_mode = OFF');
dst.pragma('synchronous = OFF');

const row = src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='general_messages_score'`).get();
if (!row?.sql) {
  console.error('table general_messages_score not found in', SRC);
  process.exit(1);
}
dst.exec(row.sql);

const count = src.prepare('SELECT COUNT(*) AS c FROM general_messages_score').get().c;
console.log(`score: ${count.toLocaleString()} rows`);

const cols = src.prepare(`PRAGMA table_info(general_messages_score)`).all().map((c) => c.name);
const insert = dst.prepare(`INSERT INTO general_messages_score (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
const tx = dst.transaction((rs) => { for (const r of rs) insert.run(...cols.map((c) => r[c])); });

const CHUNK = 50_000;
let offset = 0;
while (offset < count) {
	const rows = src.prepare(`SELECT * FROM general_messages_score LIMIT ? OFFSET ?`).all(CHUNK, offset);
	tx(rows);
	offset += rows.length;
	process.stdout.write(`\r  ${offset.toLocaleString()}/${count.toLocaleString()}`);
	if (!rows.length) break;
}
process.stdout.write('\n');
src.close();
dst.close();
console.log('done');
