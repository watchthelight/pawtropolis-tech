// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/inventory/store.test.ts
 * WHAT: Ledger arithmetic and dedup primitives for the stackable reward inventory.
 * WHY: This layer is the source of truth for how many of an item a member holds. A debit
 *      that can go negative, or a dedup key that can be claimed twice, turns straight into
 *      members losing or duplicating rewards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

const holder = vi.hoisted(() => ({ db: null as unknown as InstanceType<typeof Database> }));

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: (sql: string) => holder.db.prepare(sql) },
}));

import {
  claimGrantKey,
  creditItem,
  creditedWithin,
  debitItem,
  deferCapture,
  deleteCapture,
  dueCaptures,
  enqueueCapture,
  getInventory,
  getInventoryLog,
  getItemQuantity,
  pendingCaptureFor,
} from "../../../src/features/inventory/store.js";

const G = "guild1";
const U = "user1";

beforeEach(() => {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE inventory_items (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, item_key)
    );
    CREATE TABLE inventory_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_key TEXT NOT NULL,
      delta INTEGER NOT NULL, source TEXT NOT NULL, actor_id TEXT, reason TEXT,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE pending_item_capture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
      item_key TEXT NOT NULL, grant_key TEXT,
      detected_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      remove_at_s INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      UNIQUE(guild_id, user_id, role_id)
    );
    CREATE TABLE inventory_grant_keys (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, grant_key TEXT NOT NULL,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, grant_key)
    );
  `);
  holder.db = d;
});

describe("inventory ledger", () => {
  it("stacks repeated credits of the same item", () => {
    creditItem(G, U, "art:emoji", 1, "art");
    creditItem(G, U, "art:emoji", 1, "art");
    creditItem(G, U, "art:emoji", 2, "art");
    expect(getItemQuantity(G, U, "art:emoji")).toBe(4);
  });

  it("keeps separate stacks per item and per user", () => {
    creditItem(G, U, "art:emoji", 2, "art");
    creditItem(G, U, "byte:mythic", 1, "byte");
    creditItem(G, "user2", "art:emoji", 5, "art");

    expect(getItemQuantity(G, U, "art:emoji")).toBe(2);
    expect(getItemQuantity(G, U, "byte:mythic")).toBe(1);
    expect(getItemQuantity(G, "user2", "art:emoji")).toBe(5);
  });

  it("REGRESSION: a debit cannot drive a stack negative", () => {
    creditItem(G, U, "art:emoji", 1, "art");

    expect(debitItem(G, U, "art:emoji", 1, "art")).toBe(true);
    expect(debitItem(G, U, "art:emoji", 1, "art")).toBe(false);
    expect(getItemQuantity(G, U, "art:emoji")).toBe(0);
  });

  it("REGRESSION: debiting an item the member never held is refused", () => {
    expect(debitItem(G, U, "art:fullbody", 1, "art")).toBe(false);
    expect(getItemQuantity(G, U, "art:fullbody")).toBe(0);
    expect(getInventoryLog(G, U)).toHaveLength(0);
  });

  it("refuses a debit larger than the stack, leaving it untouched", () => {
    creditItem(G, U, "art:emoji", 2, "art");
    expect(debitItem(G, U, "art:emoji", 3, "art")).toBe(false);
    expect(getItemQuantity(G, U, "art:emoji")).toBe(2);
  });

  it("hides empty stacks from the inventory view", () => {
    creditItem(G, U, "art:emoji", 1, "art");
    creditItem(G, U, "byte:rare", 2, "byte");
    debitItem(G, U, "art:emoji", 1, "art");

    const rows = getInventory(G, U);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.item_key).toBe("byte:rare");
  });

  it("records both directions in the log", () => {
    creditItem(G, U, "art:emoji", 2, "art", "bot1", "captured");
    debitItem(G, U, "art:emoji", 1, "art", U, "/redeem");

    const log = getInventoryLog(G, U);
    expect(log.map((r) => r.delta).sort((a, b) => a - b)).toEqual([-1, 2]);
  });

  it("ignores a non-positive credit instead of corrupting the stack", () => {
    creditItem(G, U, "art:emoji", 1, "art");
    creditItem(G, U, "art:emoji", 0, "art");
    creditItem(G, U, "art:emoji", -5, "art");
    expect(getItemQuantity(G, U, "art:emoji")).toBe(1);
    expect(getInventoryLog(G, U)).toHaveLength(1);
  });
});

describe("capture queue", () => {
  it("collapses repeat detections of the same role into one pending row", () => {
    const at = Math.floor(Date.now() / 1000) + 60;
    expect(enqueueCapture(G, U, "role1", "art:emoji", at)).toBe(true);
    expect(enqueueCapture(G, U, "role1", "art:emoji", at)).toBe(false);
    expect(dueCaptures(at)).toHaveLength(1);
  });

  it("only returns rows whose grace window has expired", () => {
    const now = Math.floor(Date.now() / 1000);
    enqueueCapture(G, U, "role1", "art:emoji", now + 60);
    enqueueCapture(G, U, "role2", "art:headshot", now - 5);

    const due = dueCaptures(now);
    expect(due).toHaveLength(1);
    expect(due[0]!.role_id).toBe("role2");
  });

  it("counts attempts and pushes the retry out when a capture is deferred", () => {
    const now = Math.floor(Date.now() / 1000);
    enqueueCapture(G, U, "role1", "art:emoji", now - 1);
    const row = pendingCaptureFor(G, U, "role1")!;

    expect(deferCapture(row.id, 60)).toBe(1);
    expect(deferCapture(row.id, 60)).toBe(2);
    expect(dueCaptures(now)).toHaveLength(0);
  });

  it("clears the row on delete so the same role can be captured again later", () => {
    const now = Math.floor(Date.now() / 1000);
    enqueueCapture(G, U, "role1", "art:emoji", now);
    deleteCapture(pendingCaptureFor(G, U, "role1")!.id);

    expect(pendingCaptureFor(G, U, "role1")).toBeNull();
    expect(enqueueCapture(G, U, "role1", "art:emoji", now)).toBe(true);
  });
});

describe("dedup primitives", () => {
  it("REGRESSION: a one-shot grant key can only be claimed once", () => {
    expect(claimGrantKey(G, U, "amari:lvl:25")).toBe(true);
    expect(claimGrantKey(G, U, "amari:lvl:25")).toBe(false);
  });

  it("scopes grant keys per user", () => {
    expect(claimGrantKey(G, U, "amari:lvl:25")).toBe(true);
    expect(claimGrantKey(G, "user2", "amari:lvl:25")).toBe(true);
  });

  it("REGRESSION: a re-credit inside the debounce window is visible to the caller", () => {
    const now = Math.floor(Date.now() / 1000);
    creditItem(G, U, "art:emoji", 1, "art");

    expect(creditedWithin(G, U, "art:emoji", now - 120)).toBe(true);
    expect(creditedWithin(G, U, "byte:rare", now - 120)).toBe(false);
  });

  it("does not treat an old credit as a debounce hit", () => {
    holder.db
      .prepare(
        `INSERT INTO inventory_log (guild_id, user_id, item_key, delta, source, created_at_s)
         VALUES (?, ?, ?, 1, 'art', ?)`
      )
      .run(G, U, "art:emoji", Math.floor(Date.now() / 1000) - 3600);

    expect(creditedWithin(G, U, "art:emoji", Math.floor(Date.now() / 1000) - 120)).toBe(false);
  });

  it("does not count a debit as a credit for debounce purposes", () => {
    const now = Math.floor(Date.now() / 1000);
    creditItem(G, U, "art:emoji", 1, "art");
    debitItem(G, U, "art:emoji", 1, "art");

    holder.db.prepare(`DELETE FROM inventory_log WHERE delta > 0`).run();
    expect(creditedWithin(G, U, "art:emoji", now - 120)).toBe(false);
  });
});
