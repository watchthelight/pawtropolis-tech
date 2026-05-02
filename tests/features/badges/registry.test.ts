// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import {
  BADGE_REGISTRY,
  assertNoDuplicateIds,
  getBadgeDefinition,
  listBadgeDefinitions,
} from "../../../src/features/badges/registry.js";

describe("badge registry", () => {
  it("has at least the documented movie tier badges", () => {
    for (const id of [
      "movie-tier-1",
      "movie-tier-2",
      "movie-tier-3",
      "movie-tier-4",
    ]) {
      const def = getBadgeDefinition(id);
      expect(def).toBeDefined();
      expect(def?.kind).toBe("role");
    }
  });

  it("has no duplicate ids", () => {
    expect(() => assertNoDuplicateIds()).not.toThrow();
  });

  it("listBadgeDefinitions returns only enabled entries", () => {
    expect(listBadgeDefinitions().every((b) => b.enabled)).toBe(true);
  });

  it("every badge id passes the safe-id pattern", () => {
    for (const def of BADGE_REGISTRY) {
      expect(def.id).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    }
  });

  it("includes notable channel badges used in docs", () => {
    expect(getBadgeDefinition("channel-writing")?.discordId).toBe(
      "1446602187655610461",
    );
    expect(getBadgeDefinition("channel-yapping-space")?.discordId).toBe(
      "1393507326865969152",
    );
  });
});
