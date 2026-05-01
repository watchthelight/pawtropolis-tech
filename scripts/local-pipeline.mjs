#!/usr/bin/env node
// Local-only pipeline runner. Loops ctx + embed until drained, then runs
// effort + resonance once. Designed for big-RAM workstation, NOT EC2.
//
// Usage:
//   node scripts/local-pipeline.mjs

import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
const CTX_BATCH = 100_000;
const EMBED_BATCH = 50_000;

function pendingCounts() {
	const db = new Database(DB_PATH, { readonly: true });
	try {
		const ctx = db.prepare(`
			SELECT COUNT(*) AS c
			FROM general_messages_raw r
			LEFT JOIN general_messages_ctx c ON c.id = r.id
			WHERE c.id IS NULL AND r.is_bot = 0
		`).get().c;
		const embed = db.prepare(`
			SELECT COUNT(*) AS c
			FROM general_messages_raw r
			JOIN general_messages_ctx c ON c.id = r.id
			LEFT JOIN general_messages_embed e ON e.id = r.id
			WHERE e.id IS NULL AND r.is_bot = 0
		`).get().c;
		const effort = db.prepare(`
			SELECT COUNT(*) AS c
			FROM general_messages_raw r
			JOIN general_messages_embed e ON e.id = r.id
			LEFT JOIN general_messages_effort eff ON eff.id = r.id
			WHERE eff.id IS NULL AND r.is_bot = 0
		`).get().c;
		return { ctx, embed, effort };
	} finally {
		db.close();
	}
}

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: 'inherit' });
		child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
	});
}

async function loopUntilDrained(name, script, batch, getPending) {
	let pending = getPending();
	console.log(`\n[loop] ${name}: ${pending} pending`);
	while (pending > 0) {
		const t0 = Date.now();
		await run('node', ['--max-old-space-size=8192', script, '--batch', String(batch)]);
		const after = getPending();
		const done = pending - after;
		const sec = (Date.now() - t0) / 1000;
		console.log(`[loop] ${name}: processed ${done} in ${sec.toFixed(1)}s, ${after} remaining`);
		if (after >= pending) {
			console.log(`[loop] ${name}: no progress, stopping`);
			break;
		}
		pending = after;
	}
}

async function main() {
	const start = pendingCounts();
	console.log('[start] pending:', start);

	await loopUntilDrained('ctx', 'scripts/build-context-incremental.mjs', CTX_BATCH, () => pendingCounts().ctx);
	await loopUntilDrained('embed', 'scripts/embed-incremental.mjs', EMBED_BATCH, () => pendingCounts().embed);

	console.log('\n[run] score-effort-v1');
	await run('node', ['--max-old-space-size=8192', 'scripts/score-effort-v1.mjs']);

	console.log('\n[run] score-resonance');
	await run('node', ['--max-old-space-size=8192', 'scripts/score-resonance.mjs']);

	console.log('\n[end] pending:', pendingCounts());
}

main().catch((e) => { console.error(e); process.exit(1); });
