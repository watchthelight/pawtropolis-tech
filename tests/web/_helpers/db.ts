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
 * For tables that aren't in the dumped schema (channel_cache,
 * config_audit_log -- these get added by later migrations and may not be
 * present in tests/fixtures/schema.sql), use MISSING_DDL below:
 *
 *   beforeEach(() => {
 *     dbRef.current = makeDb();
 *     dbRef.current.exec(MISSING_DDL.channel_cache);
 *   });
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

/**
 * CREATE TABLE statements copied verbatim from migrations for tables that
 * are missing from `tests/fixtures/schema.sql`. Apply via `db.exec(...)` in
 * a test's beforeEach when the route under test needs them.
 *
 * Keep these in sync with the migration files if their DDL changes.
 */
export const MISSING_DDL = {
  // migrations/053_api_enrichment_tables.ts
  channel_cache: `
    CREATE TABLE IF NOT EXISTS channel_cache (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type INTEGER NOT NULL,
      parent_id TEXT,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    )
  `,

  // migrations/060_config_audit_log.ts
  // Note: the production query in api/export references columns
  // (changed_at_s) that this DDL does NOT define. See done/00044.
  config_audit_log: `
    CREATE TABLE IF NOT EXISTS config_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT NOT NULL DEFAULT 'dashboard',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,

  // migrations/067_ticket_system.ts -- redefines `ticket` from its
  // pre-067 5-column shape (still present in schema.sql) to the current
  // 16-column shape. Tests that touch the post-067 ticket subsystem
  // must DROP the stale table first, hence the prepended DROP. FK
  // constraints are dropped relative to production DDL to keep the
  // in-memory test DB free of seed-row requirements. See todo #00045
  // for the long-term fix (regenerate schema.sql from a post-067 dump).
  ticket_v067: `
    DROP TABLE IF EXISTS ticket;
    CREATE TABLE ticket (
      id                    TEXT PRIMARY KEY,
      type_key              TEXT NOT NULL,
      number                INTEGER NOT NULL,
      channel_id            TEXT NOT NULL,
      staff_thread_id       TEXT,
      guild_id              TEXT NOT NULL,
      opener_user_id        TEXT NOT NULL,
      claimed_by_user_id    TEXT,
      status                TEXT NOT NULL,
      close_reason          TEXT,
      closed_by_user_id     TEXT,
      archive_path          TEXT,
      legacy_source         TEXT,
      opened_at             INTEGER NOT NULL,
      claimed_at            INTEGER,
      closed_at             INTEGER
    );
  `,

  // migrations/067_ticket_system.ts -- absent from schema.sql.
  ticket_attachment: `
    CREATE TABLE IF NOT EXISTS ticket_attachment (
      id              TEXT PRIMARY KEY,
      message_id      TEXT NOT NULL,
      ticket_id       TEXT NOT NULL,
      filename        TEXT NOT NULL,
      mime            TEXT,
      size_bytes      INTEGER NOT NULL,
      local_path      TEXT,
      sha256          TEXT,
      original_url    TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `,
} as const;

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
