// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/db/migration083.test.ts
 * Verifies migration 083 creates the inventory ledger, adds its guild_config toggles,
 * and is safe to run twice. getConfig() does SELECT * FROM guild_config, so the toggles
 * have to land as real columns or the feature is unreadable at runtime.
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { migrate083Inventory, verify083Inventory } from "../../migrations/083_inventory.js";

function freshDb(): InstanceType<typeof Database> {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`);
  d.exec(`CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY);`);
  return d;
}

describe("migration 083: inventory", () => {
  it("creates every ledger table", () => {
    const d = freshDb();
    migrate083Inventory(d);

    for (const t of ["inventory_items", "inventory_log", "pending_item_capture", "inventory_grant_keys"]) {
      const row = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t);
      expect(row, `missing table ${t}`).toBeTruthy();
    }
    d.close();
  });

  it("adds the guild_config toggles so getConfig can read them", () => {
    const d = freshDb();
    migrate083Inventory(d);

    const cols = new Set((d.pragma("table_info(guild_config)") as Array<{ name: string }>).map((c) => c.name));
    expect(cols.has("inventory_enabled")).toBe(true);
    expect(cols.has("inventory_grace_seconds")).toBe(true);
    expect(cols.has("inventory_debounce_seconds")).toBe(true);
    expect(cols.has("inventory_source_bot_ids_json")).toBe(true);
    expect(cols.has("inventory_extra_roles_json")).toBe(true);
    d.close();
  });

  it("REGRESSION: one pending capture per user and role, so a burst cannot double-bank", () => {
    const d = freshDb();
    migrate083Inventory(d);

    const insert = d.prepare(
      `INSERT OR IGNORE INTO pending_item_capture (guild_id, user_id, role_id, item_key, remove_at_s)
       VALUES ('g','u','r','art:emoji', 0)`
    );
    expect(insert.run().changes).toBe(1);
    expect(insert.run().changes).toBe(0);
    d.close();
  });

  it("REGRESSION: a one-shot grant key cannot be inserted twice for the same user", () => {
    const d = freshDb();
    migrate083Inventory(d);

    const insert = d.prepare(
      `INSERT OR IGNORE INTO inventory_grant_keys (guild_id, user_id, grant_key) VALUES ('g','u','k')`
    );
    expect(insert.run().changes).toBe(1);
    expect(insert.run().changes).toBe(0);
    d.close();
  });

  it("is idempotent and stamps the version", () => {
    const d = freshDb();
    migrate083Inventory(d);
    expect(() => migrate083Inventory(d)).not.toThrow();
    expect(d.prepare(`SELECT version FROM schema_migrations WHERE version='083'`).get()).toBeTruthy();
    d.close();
  });

  it("post-condition passes after the migration and fails before it", () => {
    const d = freshDb();
    expect(verify083Inventory(d)).toBe(false);
    migrate083Inventory(d);
    expect(verify083Inventory(d)).toBe(true);
    d.close();
  });
});
