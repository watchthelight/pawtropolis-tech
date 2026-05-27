/**
 * Pawtropolis Tech -- scripts/gen-test-schema.ts
 * WHAT: Dumps the schema (tables + indexes + triggers + views, no data) of a
 *       SQLite database to tests/fixtures/schema.sql, the seed for the
 *       in-memory test DB.
 * WHY: The fixture drifts as migrations land. This is the regen tool that
 *       init-test-db.ts and tests/web/_helpers/db.ts have always referenced
 *       (`npm run gen:test-schema`) but which never existed. (#00045.)
 * HOW: Reads sqlite_master, normalizes each CREATE to `IF NOT EXISTS`, and
 *       writes them grouped by type and sorted by name for stable diffs.
 *
 * USAGE:
 *   npm run gen:test-schema                       # dump ./data/data.db
 *   DB_PATH=./tmp/x.db npm run gen:test-schema    # dump a specific DB
 *   DB_PATH=./tmp/x.db tsx scripts/gen-test-schema.ts path/to/out.sql
 *
 * NOTE: The source DB must already be fully migrated. To produce a post-latest
 *   fixture from a behind database, apply pending migrations to a copy first
 *   (see migrate.ts), then point DB_PATH at the copy.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = process.env.DB_PATH || "./data/data.db";
const outPath = resolve(process.cwd(), process.argv[2] ?? "tests/fixtures/schema.sql");

type MasterRow = { type: string; name: string; sql: string | null };

/** Insert `IF NOT EXISTS` after the CREATE keyword if it is not already there. */
function normalize(sql: string): string {
  return sql.replace(
    /^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(?!IF\s+NOT\s+EXISTS\b)/i,
    (_m, unique: string | undefined, kind: string) =>
      `CREATE ${unique ? "UNIQUE " : ""}${kind.toUpperCase()} IF NOT EXISTS `
  );
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const allRows = db
  .prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
  )
  .all() as MasterRow[];
db.close();

// Virtual tables (e.g. fts5) auto-create internal shadow tables
// (<name>_data, _idx, _docsize, _config, _content). Those rows live in
// sqlite_master but cannot be re-created by hand ("object name reserved for
// internal use") -- emitting the CREATE VIRTUAL TABLE statement recreates them.
// Drop the shadow tables from the dump, keep the virtual table itself.
const virtualNames = allRows
  .filter((r) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(r.sql ?? ""))
  .map((r) => r.name);
const isShadow = (name: string) =>
  virtualNames.some((v) => name !== v && name.startsWith(`${v}_`));

const rows = allRows.filter((r) => !isShadow(r.name));

const byName = (a: MasterRow, b: MasterRow) => a.name.localeCompare(b.name);
const pick = (type: string) => rows.filter((r) => r.type === type).sort(byName);

const ordered = [...pick("table"), ...pick("view"), ...pick("index"), ...pick("trigger")];

const out = [
  `-- Auto-generated schema dump (CI test fixture). DO NOT hand-edit.`,
  `-- Tables + indexes + triggers + views, no data. Sorted by type then name.`,
  `-- Regenerate with: npm run gen:test-schema (see scripts/gen-test-schema.ts).`,
  "",
  ...ordered.map((r) => `${normalize(r.sql!.trim())};`),
  "",
].join("\n");

writeFileSync(outPath, out, "utf8");

const counts = {
  table: pick("table").length,
  view: pick("view").length,
  index: pick("index").length,
  trigger: pick("trigger").length,
};
console.log(
  `[gen-test-schema] wrote ${counts.table} tables, ${counts.index} indexes, ` +
    `${counts.trigger} triggers, ${counts.view} views to ${outPath}`
);
