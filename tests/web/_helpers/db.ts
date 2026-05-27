// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/_helpers/db.ts
 * WHAT: In-memory SQLite factory seeded from tests/fixtures/schema.sql.
 * WHY: Dashboard +server.ts handlers and query helpers import `db` from
 *      `$lib/server/db`. Production reads a file-backed WAL database; tests
 *      want isolation and zero filesystem coupling. This helper returns a
 *      throwaway `:memory:` instance with the real schema loaded, so
 *      handlers behave the same against it as against prod.
 *
 * Per-test fresh-instance pattern (preferred):
 *
 *   import { vi } from "vitest";
 *
 *   const { dbRef } = vi.hoisted(() => ({
 *     dbRef: { current: null as null | import("better-sqlite3").Database },
 *   }));
 *   vi.mock("$lib/server/db", () => ({ db: () => dbRef.current! }));
 *
 *   const { makeDb } = await import("../_helpers/db.js");
 *
 *   beforeEach(() => {
 *     dbRef.current?.close();
 *     dbRef.current = makeDb();
 *   });
 *   afterAll(() => dbRef.current?.close());
 *
 * The vi.hoisted ref is required because vi.mock is hoisted above all
 * imports -- the factory captures the ref's identity once but reads
 * dbRef.current lazily on every call to db().
 *
 * The schema is regenerated from a fully-migrated database via
 * `npm run gen:test-schema`, so it reflects every migration. If a test inserts
 * rows into FK-constrained tables without seeding the parents, disable FK
 * enforcement for that DB with `dbRef.current.pragma("foreign_keys = OFF")`.
 */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_PATH = path.resolve(process.cwd(), "tests/fixtures/schema.sql");

let cachedSchema: string | undefined;

function loadSchema(): string {
  if (cachedSchema === undefined) {
    cachedSchema = readFileSync(SCHEMA_PATH, "utf8");
  }
  return cachedSchema;
}

export function makeDb(): Database.Database {
  const db = new Database(":memory:");
  // Mirror production PRAGMAs from web/src/lib/server/db.ts, minus
  // query_only (tests may insert) and the WAL/mmap settings that have no
  // meaning for an in-memory database.
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  db.exec(loadSchema());
  return db;
}
