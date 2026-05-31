// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/store/byteMultiplierStore.test.ts
 * Covers the longest-wins expiry semantics added for #00076: a stray or weaker
 * redemption must never SHORTEN an already-active multiplier window.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  upsertActiveMultiplier,
  getActiveMultiplier,
  removeUserMultiplier,
} from "../../src/store/byteMultiplierStore.js";

const G = "test-guild-bms";
const U = "test-user-bms";

function base(expiresAt: number, rarity: "epic" | "legendary" = "epic") {
  return {
    guildId: G,
    userId: U,
    multiplierRoleId: "role-x",
    multiplierName: rarity,
    multiplierValue: 2,
    expiresAt,
    tokenRarity: rarity,
    redeemedBy: U,
  };
}

describe("byteMultiplierStore upsert (longest-wins expiry, #00076)", () => {
  afterEach(() => {
    removeUserMultiplier(G, U);
  });

  it("keeps the longer expiry when a shorter window is written afterward", () => {
    upsertActiveMultiplier(base(10_000, "legendary")); // long window first
    upsertActiveMultiplier(base(5_000, "epic")); // weaker/shorter write second
    expect(getActiveMultiplier(G, U)?.expires_at).toBe(10_000);
  });

  it("extends to the longer expiry when a longer window is written afterward", () => {
    upsertActiveMultiplier(base(5_000, "epic"));
    upsertActiveMultiplier(base(10_000, "legendary"));
    expect(getActiveMultiplier(G, U)?.expires_at).toBe(10_000);
  });
});
