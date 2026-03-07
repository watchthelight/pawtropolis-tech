/**
 * Pawtropolis Tech — tests/web/events.test.ts
 * WHAT: Unit tests for SSE event type definitions and tier visibility.
 * WHY: Verify event types, payloads, and tier mapping are correct.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock $lib/server/roles so the web types module can resolve
vi.mock("$lib/server/roles", () => ({}));

// Import using relative path since $lib alias isn't configured in bot-side vitest
const events = await import("../../web/src/lib/types/events.js");

describe("SSE event types", () => {
  describe("getMinTierForEvent", () => {
    it("returns 'mod' for flag:created", () => {
      expect(events.getMinTierForEvent("flag:created")).toBe("mod");
    });

    it("returns 'mod' for flag:dismissed", () => {
      expect(events.getMinTierForEvent("flag:dismissed")).toBe("mod");
    });

    it("returns 'mod' for flag:kicked", () => {
      expect(events.getMinTierForEvent("flag:kicked")).toBe("mod");
    });

    it("returns 'gk' for review events", () => {
      expect(events.getMinTierForEvent("review:submitted")).toBe("gk");
    });

    it("returns 'none' for unknown event domains", () => {
      expect(events.getMinTierForEvent("unknown:event")).toBe("none");
    });
  });

  describe("EVENT_TIER_VISIBILITY", () => {
    it("maps flag: prefix to mod tier", () => {
      expect(events.EVENT_TIER_VISIBILITY["flag:"]).toBe("mod");
    });

    it("maps review: prefix to gk tier", () => {
      expect(events.EVENT_TIER_VISIBILITY["review:"]).toBe("gk");
    });

    it("maps system: prefix to owner tier", () => {
      expect(events.EVENT_TIER_VISIBILITY["system:"]).toBe("owner");
    });
  });

  describe("FlagCreatedPayload structure", () => {
    it("is assignable with correct fields", () => {
      const payload: events.FlagCreatedPayload = {
        userId: "123456789",
        flagType: "nsfw",
        reason: "auto_scan",
      };
      expect(payload.userId).toBe("123456789");
      expect(payload.flagType).toBe("nsfw");
      expect(payload.reason).toBe("auto_scan");
    });

    it("accepts behavioral flagType", () => {
      const payload: events.FlagCreatedPayload = {
        userId: "987654321",
        flagType: "behavioral",
        reason: "Manually flagged as a bot",
      };
      expect(payload.flagType).toBe("behavioral");
    });
  });

  describe("FlagDismissedPayload structure", () => {
    it("is assignable with correct fields", () => {
      const payload: events.FlagDismissedPayload = {
        userId: "123456789",
        flagType: "nsfw",
      };
      expect(payload.userId).toBe("123456789");
      expect(payload.flagType).toBe("nsfw");
    });
  });

  describe("FlagKickedPayload structure", () => {
    it("is assignable with correct fields", () => {
      const payload: events.FlagKickedPayload = {
        userId: "123456789",
        kickedBy: "987654321",
      };
      expect(payload.userId).toBe("123456789");
      expect(payload.kickedBy).toBe("987654321");
    });
  });
});
