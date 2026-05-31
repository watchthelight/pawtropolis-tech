import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = process.argv[2] || '/tmp/test-067.db';

// Derive version/name pairs from the on-disk migration files using the same
// regex migrate.ts uses, so this list can never drift from reality (a
// hand-maintained literal previously misnamed 047 and stamped a migration that
// does not exist, causing the runner to skip the real 047 forever).
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const versions = readdirSync(migrationsDir)
  .map((f) => f.match(/^(\d{3})_(.+)\.ts$/))
  .filter((m) => m !== null)
  .map((m) => [m[1], m[2]]);

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
