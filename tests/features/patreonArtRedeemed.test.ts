// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/patreonArtRedeemed.test.ts
 * WHAT: Ledger behavior for the Patreon art redemption counter (#00077 / #00085).
 * WHY: A quantity > 1 tier (e.g. Legendary Fiona = 2 emoji) collapses onto a single
 *      binary ticket role. quantity_granted is a high-water mark, so re-granting the
 *      role after a redemption requires tracking redemptions: remaining = granted -
 *      redeemed. These tests exercise recordArtTicketRedemption + getArtGrantsForUser
 *      against a real in-memory DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

const holder = vi.hoisted(() => ({ db: null as unknown as InstanceType<typeof Database> }));

vi.mock("../../src/db/db.js", () => ({
  db: { prepare: (sql: string) => holder.db.prepare(sql) },
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// patreonArtRewards pulls in config.ts -> syncMarker.ts, which prepares against a
// sync_marker table at module load. Stub the sibling imports we do not exercise so
// the module graph loads without touching the real db at import time.
vi.mock("../../src/lib/config.js", () => ({ getConfig: vi.fn(() => ({})) }));
vi.mock("../../src/features/roleAutomation.js", () => ({ assignRole: vi.fn() }));
vi.mock("../../src/features/panicStore.js", () => ({ isPanicMode: vi.fn(() => false) }));
vi.mock("../../src/logging/pretty.js", () => ({ logActionPretty: vi.fn() }));

import { recordArtTicketRedemption, getArtGrantsForUser } from "../../src/features/patreonArtRewards.js";

const G = "guild1";
const U = "user1";

function seed(artType: string, granted: number, redeemed = 0): void {
  holder.db
    .prepare(
      `INSERT INTO patreon_art_granted (guild_id, user_id, art_type, quantity_granted, quantity_redeemed, last_granted_at_s)
       VALUES (?, ?, ?, ?, ?, unixepoch())`
    )
    .run(G, U, artType, granted, redeemed);
}

function remaining(artType: string): number {
  const g = getArtGrantsForUser(G, U).find((r) => r.art_type === artType);
  if (!g) return 0;
  return Math.max(0, g.quantity_granted - g.quantity_redeemed);
}

beforeEach(() => {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE patreon_art_granted (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      art_type TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL DEFAULT 0,
      quantity_redeemed INTEGER NOT NULL DEFAULT 0,
      last_granted_at_s INTEGER,
      UNIQUE(guild_id, user_id, art_type)
    );
  `);
  holder.db = d;
});

describe("patreon art redemption ledger", () => {
  it("a quantity-2 grant still has tickets remaining after one redemption", () => {
    seed("emoji", 2);
    expect(remaining("emoji")).toBe(2);

    const changes = recordArtTicketRedemption(G, U, "emoji");
    expect(changes).toBe(1);
    expect(remaining("emoji")).toBe(1); // second emoji ticket is NOT lost (#00077/#00085)
  });

  it("remaining reaches zero only after the full quantity is redeemed", () => {
    seed("emoji", 2);
    recordArtTicketRedemption(G, U, "emoji");
    recordArtTicketRedemption(G, U, "emoji");
    expect(remaining("emoji")).toBe(0);
  });

  it("redeemed is capped at granted - over-redemption cannot drive remaining negative", () => {
    seed("emoji", 2, 2);
    recordArtTicketRedemption(G, U, "emoji"); // a third spend somehow
    const g = getArtGrantsForUser(G, U).find((r) => r.art_type === "emoji")!;
    expect(g.quantity_redeemed).toBe(2); // clamped, not 3
    expect(remaining("emoji")).toBe(0);
  });

  it("is a no-op for a ticket that was never Patreon-granted", () => {
    const changes = recordArtTicketRedemption(G, U, "headshot");
    expect(changes).toBe(0);
    expect(getArtGrantsForUser(G, U)).toHaveLength(0);
  });

  it("only the targeted art type is affected", () => {
    seed("emoji", 2);
    seed("headshot", 1);
    recordArtTicketRedemption(G, U, "emoji");
    expect(remaining("emoji")).toBe(1);
    expect(remaining("headshot")).toBe(1); // untouched
  });
});
