import Database from 'better-sqlite3';
const db = new Database('data/data.db', { readonly: true });
const tables = ['general_messages_ctx', 'general_messages_embed', 'general_messages_effort', 'general_messages_resonance', 'general_messages_overlay_weekly'];
for (const t of tables) {
	const c = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
	console.log(`${t}: ${c.toLocaleString()} rows`);
}
db.close();
