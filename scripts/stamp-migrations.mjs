import Database from 'better-sqlite3';

const dbPath = process.argv[2] || '/tmp/test-067.db';
const versions = [
  ['046','extend_user_cache_profile'],
  ['047','lock_db_mode'],
  ['048','nsfw_alert_role_config'],
  ['049','art_job_thumbnail'],
  ['050','user_activity_left_at'],
  ['051','pulse_insights_indices'],
  ['052','voice_session'],
  ['053','api_enrichment_tables'],
  ['054','scan_banner_and_ai_columns'],
  ['055','deduplicate_role_tiers'],
  ['056','qotd'],
  ['057','level_reward_dedup'],
  ['058','invite_labels'],
  ['059','pulse_excluded_categories'],
  ['060','config_audit_log'],
  ['061','vote_out'],
  ['062','patreon_art_rewards'],
  ['063','dashboard_query_indexes'],
  ['064','idme_verification'],
  ['065','add_admin_role_id_column'],
  ['066','verify_thread'],
];

const db = new Database(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
)`);
const stmt = db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (?, ?) ON CONFLICT(version) DO NOTHING`);
let count = 0;
for (const [v, n] of versions) {
  const r = stmt.run(v, n);
  if (r.changes) count++;
}
console.log(`stamped ${count} migrations as applied in ${dbPath}`);
db.close();
