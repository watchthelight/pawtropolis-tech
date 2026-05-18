/**
 * scripts/init-test-db.ts — CI-only test database bootstrap.
 *
 * Tests assume ./data/data.db has the production schema. In production the
 * bot accumulates schema across years of ensure-functions and migrations.
 * In CI we skip all that and apply tests/fixtures/schema.sql (a dump of the
 * live schema) directly. Run scripts/migrate.ts afterwards for any pending
 * deltas.
 *
 * Regenerate the fixture when schema changes:
 *   npm run gen:test-schema
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = process.env.DB_PATH || "./data/data.db";
const schemaPath = resolve(process.cwd(), "tests/fixtures/schema.sql");

const sql = readFileSync(schemaPath, "utf-8");
const db = new Database(dbPath, { fileMustExist: false });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // schema dump references may not be ordered

try {
  db.exec(sql);
  console.log(`[init-test-db] applied ${schemaPath} to ${dbPath}`);
} catch (err) {
  console.error("[init-test-db] schema apply failed:", err);
  process.exit(1);
}

db.close();
process.exit(0);
