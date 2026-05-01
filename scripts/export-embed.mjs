import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';

const SRC = 'data/data.db.processed-snapshot';
const OUT = '/tmp/embed-export.db';
if (existsSync(OUT)) unlinkSync(OUT);

const src = new Database(SRC, { readonly: true });
const dst = new Database(OUT);
dst.pragma('journal_mode = OFF');
dst.pragma('synchronous = OFF');

const sql = src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='general_messages_embed'`).get().sql;
dst.exec(sql);

const count = src.prepare('SELECT COUNT(*) AS c FROM general_messages_embed').get().c;
console.log(`embed: ${count.toLocaleString()} rows`);

const cols = src.prepare(`PRAGMA table_info(general_messages_embed)`).all().map((c) => c.name);
const placeholders = cols.map(() => '?').join(',');
const insert = dst.prepare(`INSERT INTO general_messages_embed (${cols.join(',')}) VALUES (${placeholders})`);
const tx = dst.transaction((rs) => { for (const r of rs) insert.run(...cols.map((c) => r[c])); });

const CHUNK = 20_000;
let offset = 0;
while (offset < count) {
	const rows = src.prepare(`SELECT * FROM general_messages_embed LIMIT ? OFFSET ?`).all(CHUNK, offset);
	tx(rows);
	offset += rows.length;
	process.stdout.write(`\r  ${offset.toLocaleString()}/${count.toLocaleString()}`);
	if (!rows.length) break;
}
process.stdout.write('\n');
src.close();
dst.close();
console.log('done');
