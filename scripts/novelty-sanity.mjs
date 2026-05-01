#!/usr/bin/env node
// Sanity-check the novelty signal: 1 - cosine(target_vec, ctx_vec).
// Both vectors are already in general_messages_embed; ctx_vec is the
// embedding of the message's conversation context, so cosine ≈ "how
// much this message restates its context".
//
// Pulls 5000 random recent messages, ranks by novelty, prints the
// extremes + correlation against effort.

import Database from 'better-sqlite3';

const DB = process.env.DB_PATH || 'data/data.db.processed-snapshot';
const db = new Database(DB, { readonly: true });

function vec(buf) { return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); }
function cosine(a, b) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
	return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

const rows = db.prepare(`
	SELECT r.id, r.content, e.target_vec, e.ctx_vec, eff.score AS effort
	FROM general_messages_raw r
	JOIN general_messages_embed e ON e.id = r.id
	JOIN general_messages_effort eff ON eff.id = r.id
	JOIN general_messages_ctx c ON c.id = r.id
	WHERE r.is_bot = 0 AND length(r.content) > 5 AND c.ctx_json != '[]'
	ORDER BY RANDOM()
	LIMIT 5000
`).all();
db.close();

const scored = rows.map((r) => {
	const t = vec(r.target_vec), c = vec(r.ctx_vec);
	const sim = cosine(t, c);
	const novelty = 1 - sim;
	return { id: r.id, content: r.content.slice(0, 100), novelty, effort: r.effort };
});

scored.sort((a, b) => a.novelty - b.novelty);

console.log('--- LOWEST NOVELTY (predicted filler / restatement) ---');
for (const r of scored.slice(0, 12)) {
	console.log(`  novelty=${r.novelty.toFixed(3)}  effort=${r.effort.toFixed(3)}  ${JSON.stringify(r.content)}`);
}

console.log('\n--- HIGHEST NOVELTY (predicted topic-shift / new info) ---');
for (const r of scored.slice(-12).reverse()) {
	console.log(`  novelty=${r.novelty.toFixed(3)}  effort=${r.effort.toFixed(3)}  ${JSON.stringify(r.content)}`);
}

// Correlation
const n = scored.length;
const mn = scored.reduce((s, r) => s + r.novelty, 0) / n;
const me = scored.reduce((s, r) => s + r.effort, 0) / n;
let num = 0, dn = 0, de = 0;
for (const r of scored) {
	num += (r.novelty - mn) * (r.effort - me);
	dn  += (r.novelty - mn) ** 2;
	de  += (r.effort  - me) ** 2;
}
const r = num / (Math.sqrt(dn) * Math.sqrt(de) + 1e-9);
console.log(`\nn=${n}   mean novelty=${mn.toFixed(3)}   mean effort=${me.toFixed(3)}`);
console.log(`Pearson r(novelty, effort) = ${r.toFixed(3)}`);
console.log(r > 0.85 ? '⚠️  high correlation — novelty may add little signal' : '✓  novelty is largely orthogonal to effort');
