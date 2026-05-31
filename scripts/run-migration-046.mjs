import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "./data/data.db";
// fileMustExist guards against a wrong cwd silently creating an empty DB and
// ALTERing a non-existent user_cache.
const db = new Database(dbPath, { fileMustExist: true });
db.pragma("journal_mode = WAL");

const cols = [
  ["banner_url", "TEXT"],
  ["accent_color", "INTEGER"],
  ["joined_at", "INTEGER"],
  ["created_at", "INTEGER"],
];

for (const [name, type] of cols) {
  const exists = db.prepare("PRAGMA table_info(user_cache)").all().some((c) => c.name === name);
  if (!exists) {
    db.prepare(`ALTER TABLE user_cache ADD COLUMN ${name} ${type}`).run();
    console.log(`Added user_cache.${name}`);
  } else {
    console.log(`Column user_cache.${name} already exists`);
  }
}

// Track in the canonical schema_migrations table (same as scripts/migrate.ts),
// not a separate migration_log, so the deploy runner sees 046 as applied and
// does not re-run it.
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
)`);
const already = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("046");
if (!already) {
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
    "046",
    "extend_user_cache_profile"
  );
  console.log("Recorded migration 046");
}

db.close();
console.log("Migration 046 complete");
