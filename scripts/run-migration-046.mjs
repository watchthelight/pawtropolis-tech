import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "./data/data.db";
const db = new Database(dbPath);
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

const already = db.prepare("SELECT id FROM migration_log WHERE id = ?").get("046");
if (!already) {
  db.prepare('INSERT INTO migration_log (id, applied_at) VALUES (?, datetime("now"))').run("046");
  console.log("Recorded migration 046");
}

db.close();
console.log("Migration 046 complete");
