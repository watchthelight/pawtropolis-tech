/**
 * Pawtropolis Tech — tests/commands/stats/shared.test.ts
 * WHAT: Unit tests for stats shared utilities.
 * WHY: Verify formatDuration, DECISION_ACTIONS, the module re-exports, and the
 *      real runtime behavior of getAvgClaimToDecision / getAvgSubmitToFirstClaim.
 *
 * NOTE on the two AVG helpers: their bodies load the db handle with a CommonJS
 * `require("../../db/db.js")` (see src/commands/stats/shared.ts:65 and :103)
 * instead of the module-level ESM import the file already declares. Under the
 * Vitest/TS harness that `require` is the native Node require: it resolves the
 * literal `.js` path relative to the .ts source (src/db/db.js), which does not
 * exist on disk, and it does NOT consult Vitest's vi.mock registry. So invoking
 * either function actually executes its body and throws a module-resolution
 * error before the SQL ever runs. The tests below call the REAL functions and
 * assert that current behavior (a faithful, non-tautological exercise of the
 * function bodies) rather than re-implementing the SQL inline. See bugsFound.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module before importing shared. This intercepts the
// top-level ESM `export { db } from "../../db/db.js"` re-export. It does NOT
// intercept the CommonJS require() the two AVG helpers use internally (Vitest
// only rewrites import specifiers, not native require), which is exactly what
// the AVG-helper tests below demonstrate.
const { mockPrepare, mockGet } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/config.js", () => ({
  requireMinRole: vi.fn(),
  ROLE_IDS: {
    GATEKEEPER: "role-gk",
    SENIOR_MOD: "role-sm",
    SENIOR_ADMIN: "role-sa",
  },
  hasStaffPermissions: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../../../src/lib/errors.js", () => ({
  classifyError: vi.fn((e) => e),
  userFriendlyMessage: vi.fn(() => "An error occurred"),
}));

vi.mock("../../../src/lib/owner.js", () => ({
  isOwner: vi.fn(() => false),
}));

vi.mock("../../../src/lib/typeGuards.js", () => ({
  isGuildMember: vi.fn(() => true),
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => 1700000000),
}));

vi.mock("../../../src/lib/cmdWrap.js", () => ({
  withStep: vi.fn(async (_ctx, _phase, fn) => fn()),
}));

import {
  formatDuration,
  getAvgClaimToDecision,
  getAvgSubmitToFirstClaim,
  DECISION_ACTIONS,
} from "../../../src/commands/stats/shared.js";

describe("stats/shared", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ get: mockGet });
  });

  describe("DECISION_ACTIONS constant", () => {
    it("contains expected action types", () => {
      expect(DECISION_ACTIONS).toContain("approve");
      expect(DECISION_ACTIONS).toContain("reject");
      expect(DECISION_ACTIONS).toContain("perm_reject");
      expect(DECISION_ACTIONS).toContain("kick");
      expect(DECISION_ACTIONS).toContain("modmail_open");
      expect(DECISION_ACTIONS).toHaveLength(5);
    });
  });

  describe("formatDuration", () => {
    it("returns em-dash for null", () => {
      expect(formatDuration(null)).toBe("—");
    });

    it("returns em-dash for undefined", () => {
      expect(formatDuration(undefined)).toBe("—");
    });

    it("returns em-dash for negative values", () => {
      expect(formatDuration(-1)).toBe("—");
      expect(formatDuration(-100)).toBe("—");
    });

    it("formats zero seconds", () => {
      expect(formatDuration(0)).toBe("0m");
    });

    it("formats seconds under an hour as minutes only", () => {
      expect(formatDuration(60)).toBe("1m");
      expect(formatDuration(120)).toBe("2m");
      expect(formatDuration(300)).toBe("5m");
      expect(formatDuration(1800)).toBe("30m");
      expect(formatDuration(3540)).toBe("59m");
    });

    it("handles partial minutes correctly", () => {
      expect(formatDuration(90)).toBe("1m");
      expect(formatDuration(150)).toBe("2m");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(3600)).toBe("1h 0m");
      expect(formatDuration(3660)).toBe("1h 1m");
      expect(formatDuration(7200)).toBe("2h 0m");
      expect(formatDuration(7320)).toBe("2h 2m");
    });

    it("handles large values", () => {
      expect(formatDuration(86400)).toBe("24h 0m"); // 1 day
      expect(formatDuration(90061)).toBe("25h 1m");
    });

    it("truncates to floor for partial seconds", () => {
      expect(formatDuration(61)).toBe("1m");
      expect(formatDuration(119)).toBe("1m");
    });
  });

  // These two helpers load their db handle with require("../../db/db.js") inside
  // the function body. Calling them runs that body. Under Vitest/TS the require
  // resolves the literal .js path next to the .ts source (src/db/db.js, which is
  // not on disk) and bypasses the vi.mock registry, so the call throws a
  // module-resolution error before any SQL executes. We assert that real
  // behavior. This genuinely exercises the function bodies (unlike the previous
  // `typeof === "function"` tautology) and pins the defect described in #00219 /
  // bugsFound. The mockPrepare below is intentionally NOT reached.
  describe("getAvgClaimToDecision", () => {
    it("throws a module-resolution error from the internal require (db.js not on disk under TS)", () => {
      expect(() => getAvgClaimToDecision("guild-1", "mod-1", 0)).toThrow(
        /Cannot find module '\.\.\/\.\.\/db\/db\.js'/
      );
    });

    it("never reaches the mocked db prepare() because require() fails first", () => {
      try {
        getAvgClaimToDecision("guild-1", "mod-1", 0);
      } catch {
        // expected
      }
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });

  describe("getAvgSubmitToFirstClaim", () => {
    it("throws a module-resolution error from the internal require (db.js not on disk under TS)", () => {
      expect(() => getAvgSubmitToFirstClaim("guild-1", 0)).toThrow(
        /Cannot find module '\.\.\/\.\.\/db\/db\.js'/
      );
    });

    it("never reaches the mocked db prepare() because require() fails first", () => {
      try {
        getAvgSubmitToFirstClaim("guild-1", 0);
      } catch {
        // expected
      }
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });

  describe("re-exports", () => {
    it("exports db from db module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.db).toBeDefined();
    });

    it("exports nowUtc from time module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.nowUtc).toBeDefined();
      expect(typeof shared.nowUtc).toBe("function");
    });

    it("exports logger from logger module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.logger).toBeDefined();
    });

    it("exports requireMinRole from config module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.requireMinRole).toBeDefined();
    });

    it("exports ROLE_IDS from config module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.ROLE_IDS).toBeDefined();
      expect(shared.ROLE_IDS.GATEKEEPER).toBe("role-gk");
    });

    it("exports hasStaffPermissions from config module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.hasStaffPermissions).toBeDefined();
    });

    it("exports classifyError from errors module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.classifyError).toBeDefined();
    });

    it("exports userFriendlyMessage from errors module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.userFriendlyMessage).toBeDefined();
    });

    it("exports isOwner from owner module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.isOwner).toBeDefined();
    });

    it("exports isGuildMember from typeGuards module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.isGuildMember).toBeDefined();
    });

    it("exports SAFE_ALLOWED_MENTIONS from constants module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.SAFE_ALLOWED_MENTIONS).toBeDefined();
    });

    it("exports captureException from sentry module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.captureException).toBeDefined();
    });

    it("exports withStep from cmdWrap module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.withStep).toBeDefined();
    });

    it("exports getConfig from config module", async () => {
      const shared = await import("../../../src/commands/stats/shared.js");
      expect(shared.getConfig).toBeDefined();
    });
  });
});
