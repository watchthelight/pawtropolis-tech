// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/db/migration080.test.ts
 * Verifies migration 080 creates consumed_confirmations and that consuming a
 * confirmId is single-use (the reentrancy guard behind #00081).
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { migrate080ConsumedConfirmations } from "../../migrations/080_consumed_confirmations.js";

function db(): InstanceType<typeof Database> {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`);
  migrate080ConsumedConfirmations(d);
  return d;
}

describe("migration 080: consumed_confirmations", () => {
  it("a confirmId can only be consumed once", () => {
    const d = db();
    const consume = (id: string) =>
      d.prepare(`INSERT OR IGNORE INTO consumed_confirmations (confirm_id) VALUES (?)`).run(id).changes;

    expect(consume("abc123")).toBe(1); // first click wins
    expect(consume("abc123")).toBe(0); // double-click is a no-op
    expect(consume("def456")).toBe(1); // a different confirmation is unaffected
    d.close();
  });

  it("is idempotent / safe to run twice", () => {
    const d = db();
    expect(() => migrate080ConsumedConfirmations(d)).not.toThrow();
    expect(d.prepare(`SELECT version FROM schema_migrations WHERE version='080'`).get()).toBeTruthy();
    d.close();
  });
});
