// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/dashboardAuth.test.ts
 * WHAT: Unit tests for dashboard API authorization helpers.
 * WHY: Authorization is the seam between an authenticated user and a mutation.
 *      Tier comparisons must be exact and fail closed for unknown inputs;
 *      body validation must reject empty strings as well as missing fields.
 *      Drift here means unauthorized actions on production data.
 */

import { describe, expect, it } from "vitest";

import {
  TIER_ORDER,
  hasMinTier,
  missingIntegerFields,
  missingStringFields,
  type TierName,
} from "../../src/web/dashboardAuth.js";

describe("TIER_ORDER", () => {
  it("starts with owner and ends with none", () => {
    expect(TIER_ORDER[0]).toBe("owner");
    expect(TIER_ORDER[TIER_ORDER.length - 1]).toBe("none");
  });

  it("contains all expected tiers in the documented order", () => {
    expect([...TIER_ORDER]).toEqual([
      "owner",
      "cm",
      "cdl",
      "sa",
      "admin",
      "sm",
      "mod",
      "jm",
      "gk",
      "viewer",
      "none",
    ]);
  });

  it("has no duplicate tiers", () => {
    const seen = new Set<string>();
    for (const t of TIER_ORDER) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });
});

describe("hasMinTier", () => {
  describe("owner outranks everyone", () => {
    it.each(TIER_ORDER)("owner can satisfy minTier=%s", (t) => {
      expect(hasMinTier("owner", t)).toBe(true);
    });
  });

  describe("admin satisfies admin and below", () => {
    it("admin >= admin", () => {
      expect(hasMinTier("admin", "admin")).toBe(true);
    });
    it("admin >= sm", () => {
      expect(hasMinTier("admin", "sm")).toBe(true);
    });
    it("admin >= mod", () => {
      expect(hasMinTier("admin", "mod")).toBe(true);
    });
    it("admin >= gk", () => {
      expect(hasMinTier("admin", "gk")).toBe(true);
    });
    it("admin < cdl", () => {
      expect(hasMinTier("admin", "cdl")).toBe(false);
    });
    it("admin < cm", () => {
      expect(hasMinTier("admin", "cm")).toBe(false);
    });
  });

  describe("gk satisfies only gk-or-below", () => {
    it("gk >= gk", () => {
      expect(hasMinTier("gk", "gk")).toBe(true);
    });
    it("gk < admin (cannot do admin operations)", () => {
      expect(hasMinTier("gk", "admin")).toBe(false);
    });
    it("gk < mod", () => {
      expect(hasMinTier("gk", "mod")).toBe(false);
    });
  });

  describe("viewer cannot do gk-level operations", () => {
    it("viewer < gk", () => {
      expect(hasMinTier("viewer", "gk")).toBe(false);
    });
    it("viewer < mod", () => {
      expect(hasMinTier("viewer", "mod")).toBe(false);
    });
    it("viewer < admin", () => {
      expect(hasMinTier("viewer", "admin")).toBe(false);
    });
    it("viewer >= viewer (read-only routes)", () => {
      expect(hasMinTier("viewer", "viewer")).toBe(true);
    });
  });

  describe("none cannot do anything", () => {
    it("none < gk", () => {
      expect(hasMinTier("none", "gk")).toBe(false);
    });
    it("none < admin", () => {
      expect(hasMinTier("none", "admin")).toBe(false);
    });
  });

  describe("unknown tiers fail closed", () => {
    it("unknown user tier returns false", () => {
      expect(hasMinTier("hacker", "gk")).toBe(false);
    });
    it("unknown min tier returns false", () => {
      expect(hasMinTier("admin", "supreme")).toBe(false);
    });
    it("empty user tier returns false", () => {
      expect(hasMinTier("", "gk")).toBe(false);
    });
    it("empty min tier returns false", () => {
      expect(hasMinTier("admin", "")).toBe(false);
    });
    it("undefined-cast user tier returns false", () => {
      // cast to bypass the type guard; simulating bad runtime input from JSON
      expect(hasMinTier(undefined as unknown as TierName, "gk")).toBe(false);
    });
  });

  describe("permreject route requires admin+", () => {
    it("admin can permreject", () => {
      expect(hasMinTier("admin", "admin")).toBe(true);
    });
    it("sa can permreject", () => {
      expect(hasMinTier("sa", "admin")).toBe(true);
    });
    it("owner can permreject", () => {
      expect(hasMinTier("owner", "admin")).toBe(true);
    });
    it("gk cannot permreject", () => {
      expect(hasMinTier("gk", "admin")).toBe(false);
    });
    it("mod cannot permreject", () => {
      expect(hasMinTier("mod", "admin")).toBe(false);
    });
  });
});

describe("missingStringFields", () => {
  it("returns empty when all fields present", () => {
    expect(
      missingStringFields(
        { userId: "1", tier: "gk", appId: "A" },
        ["userId", "tier", "appId"],
      ),
    ).toEqual([]);
  });

  it("returns missing field names when keys absent", () => {
    expect(
      missingStringFields({ userId: "1" }, ["userId", "tier", "appId"]),
    ).toEqual(["tier", "appId"]);
  });

  it("treats empty string as missing", () => {
    expect(
      missingStringFields(
        { userId: "1", tier: "", appId: "A" },
        ["userId", "tier", "appId"],
      ),
    ).toEqual(["tier"]);
  });

  it("treats non-string values as missing", () => {
    expect(
      missingStringFields(
        { userId: "1", tier: 42, appId: null },
        ["userId", "tier", "appId"],
      ),
    ).toEqual(["tier", "appId"]);
  });

  it("returns all fields if body is null", () => {
    expect(missingStringFields(null, ["userId", "tier"])).toEqual([
      "userId",
      "tier",
    ]);
  });

  it("returns all fields if body is undefined", () => {
    expect(missingStringFields(undefined, ["userId", "tier"])).toEqual([
      "userId",
      "tier",
    ]);
  });
});

describe("missingIntegerFields", () => {
  it("accepts positive integers", () => {
    expect(missingIntegerFields({ ticketId: 123 }, ["ticketId"])).toEqual([]);
  });

  it("rejects zero", () => {
    expect(missingIntegerFields({ ticketId: 0 }, ["ticketId"])).toEqual([
      "ticketId",
    ]);
  });

  it("rejects negative numbers", () => {
    expect(missingIntegerFields({ ticketId: -1 }, ["ticketId"])).toEqual([
      "ticketId",
    ]);
  });

  it("rejects NaN and Infinity", () => {
    expect(missingIntegerFields({ ticketId: NaN }, ["ticketId"])).toEqual([
      "ticketId",
    ]);
    expect(
      missingIntegerFields({ ticketId: Number.POSITIVE_INFINITY }, ["ticketId"]),
    ).toEqual(["ticketId"]);
  });

  it("rejects strings even if numeric", () => {
    expect(missingIntegerFields({ ticketId: "123" }, ["ticketId"])).toEqual([
      "ticketId",
    ]);
  });
});
