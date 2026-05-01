#!/usr/bin/env node
// Exports general_messages_overlay_weekly from data/data.db into a small
// shippable .db file. Use: node scripts/export-overlay.mjs <out>

import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';

const SRC = process.env.DB_PATH || 'data/data.db';
const OUT = process.argv[2] || '/tmp/overlay-export.db';

if (existsSync(OUT)) unlinkSync(OUT);

const src = new Database(SRC, { readonly: true });
const dst = new Database(OUT);

dst.exec(`
	CREATE TABLE general_messages_overlay_weekly (
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

const rows = src.prepare('SELECT * FROM general_messages_overlay_weekly').all();
const insert = dst.prepare(`
	INSERT INTO general_messages_overlay_weekly
	(week_start, count, effort, heuristic, resonance, median_length, lexical_diversity,
	 question_rate, no_repeat_spam, no_lowlist_hit, reply_rate, author_distribution, computed_at_s)
	VALUES (@week_start, @count, @effort, @heuristic, @resonance, @median_length, @lexical_diversity,
	        @question_rate, @no_repeat_spam, @no_lowlist_hit, @reply_rate, @author_distribution, @computed_at_s)
`);
const tx = dst.transaction((rs) => { for (const r of rs) insert.run(r); });
tx(rows);

console.log(`exported ${rows.length} rows to ${OUT}`);
src.close();
dst.close();
