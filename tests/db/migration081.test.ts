// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/db/migration081.test.ts
 * Verifies migration 081 adds quantity_redeemed to patreon_art_granted and is
 * idempotent. Backs the quantity > 1 re-grant fix (#00077 / #00085).
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { migrate081PatreonArtRedeemed } from "../../migrations/081_patreon_art_redeemed.js";

function freshDb(): InstanceType<typeof Database> {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`);
  d.exec(`
    CREATE TABLE patreon_art_granted (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      art_type TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL DEFAULT 0,
      last_granted_at_s INTEGER,
      UNIQUE(guild_id, user_id, art_type)
    );
  `);
  return d;
}

describe("migration 081: patreon_art_redeemed", () => {
  it("adds quantity_redeemed defaulting to 0", () => {
    const d = freshDb();
    migrate081PatreonArtRedeemed(d);

    const cols = d.pragma("table_info(patreon_art_granted)") as Array<{ name: string; dflt_value: string | null }>;
    const col = cols.find((c) => c.name === "quantity_redeemed");
    expect(col).toBeTruthy();

    d.prepare(`INSERT INTO patreon_art_granted (guild_id, user_id, art_type, quantity_granted) VALUES ('g','u','emoji',2)`).run();
    const row = d.prepare(`SELECT quantity_redeemed FROM patreon_art_granted WHERE user_id='u'`).get() as { quantity_redeemed: number };
    expect(row.quantity_redeemed).toBe(0);
    d.close();
  });

  it("is idempotent / safe to run twice", () => {
    const d = freshDb();
    migrate081PatreonArtRedeemed(d);
    expect(() => migrate081PatreonArtRedeemed(d)).not.toThrow();
    expect(d.prepare(`SELECT version FROM schema_migrations WHERE version='081'`).get()).toBeTruthy();
    d.close();
  });
});
