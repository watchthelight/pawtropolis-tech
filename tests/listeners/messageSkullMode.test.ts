/**
 * Pawtropolis Tech — tests/listeners/messageSkullMode.test.ts
 * WHAT: Unit tests for Skull Mode message listener.
 * WHY: Verify filtering, odds calculation, and reaction logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Events } from "discord.js";

// Mock config
vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// NOTE: constants.js is deliberately NOT mocked. The listener clamps odds with
// the REAL SKULLMODE_ODDS_MIN / SKULLMODE_ODDS_MAX bounds, so the tests exercise
// production values. A previous version mocked SKULLMODE_ODDS_MAX as 10000 while
// production is 1000, hiding a 10x divergence (finding #00135).

import { name, execute } from "../../src/listeners/messageSkullMode.js";
import { getConfig } from "../../src/lib/config.js";
import { logger } from "../../src/lib/logger.js";
import { SKULLMODE_ODDS_MIN, SKULLMODE_ODDS_MAX } from "../../src/lib/constants.js";

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;

function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    guild: { id: "guild-123" },
    author: { bot: false },
    webhookId: null,
    channel: { id: "channel-456" },
    id: "message-789",
    react: vi.fn(),
    ...overrides,
  };
}

describe("messageSkullMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks(); // Restore Math.random spy
    mockGetConfig.mockResolvedValue({
      skullmode_enabled: true,
      skullmode_odds: 1, // Always trigger for tests
    });
    vi.spyOn(Math, "random").mockReturnValue(0); // Always roll 0
  });

  describe("event name", () => {
    it("exports correct event name", () => {
      expect(name).toBe(Events.MessageCreate);
    });
  });

  describe("message filtering", () => {
    it("skips DM messages (no guild)", async () => {
      const message = createMockMessage({ guild: null });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });

    it("skips bot messages", async () => {
      const message = createMockMessage({ author: { bot: true } });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });

    it("skips webhook messages", async () => {
      const message = createMockMessage({ webhookId: "webhook-123" });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });
  });

  describe("config checks", () => {
    it("skips if skullmode is not enabled", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: false });
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).not.toHaveBeenCalled();
    });

    it("handles config error gracefully", async () => {
      mockGetConfig.mockRejectedValue(new Error("DB error"));
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.error).toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });

    it("skips if config is null", async () => {
      mockGetConfig.mockResolvedValue(null);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).not.toHaveBeenCalled();
    });
  });

  describe("odds handling", () => {
    it("reacts when roll is zero", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}"); // Skull emoji
    });

    it("does not react when roll is non-zero", async () => {
      // odds = real-clamped 1000, floor(0.5 * 1000) = 500 != 0 -> no react
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true, skullmode_odds: 1000 });
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).not.toHaveBeenCalled();
    });

    it("clamps odds below the floor up to SKULLMODE_ODDS_MIN", async () => {
      // A negative value survives the `|| 1000` falsy guard, so the lower clamp
      // is genuinely exercised: Math.max(SKULLMODE_ODDS_MIN, min(MAX, -5)) = MIN.
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true, skullmode_odds: -5 });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}");
      // The logged odds prove the clamp landed on the real production minimum.
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ odds: SKULLMODE_ODDS_MIN }),
        expect.any(String)
      );
    });

    it("clamps odds above the ceiling down to SKULLMODE_ODDS_MAX", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true, skullmode_odds: 100000 });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}");
      // Asserting the real bound (1000) catches divergence from production.
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ odds: SKULLMODE_ODDS_MAX }),
        expect.any(String)
      );
    });

    it("treats a falsy odds value of 0 as the default 1000 (current behavior)", async () => {
      // CURRENT BEHAVIOR: `Number(cfg.skullmode_odds || 1000)` coerces 0 -> 1000,
      // so the SKULLMODE_ODDS_MIN clamp is bypassed for falsy odds. Documented here
      // so a future change to the falsy guard is caught (finding #00135).
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true, skullmode_odds: 0 });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ odds: 1000 }),
        expect.any(String)
      );
    });

    it("uses default odds of 1000 when not configured", async () => {
      mockGetConfig.mockResolvedValue({ skullmode_enabled: true });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ odds: 1000 }),
        expect.any(String)
      );
    });
  });

  describe("reaction behavior", () => {
    it("reacts with skull emoji", async () => {
      const message = createMockMessage();

      await execute(message as any);

      expect(message.react).toHaveBeenCalledWith("\u{1F480}");
    });

    it("logs successful reaction", async () => {
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("logs warning when reaction fails", async () => {
      const message = createMockMessage();
      message.react.mockRejectedValue(new Error("Missing permissions"));

      await execute(message as any);

      expect(logger.warn).toHaveBeenCalled();
    });

    it("includes error code in warning log", async () => {
      const message = createMockMessage();
      const error = new Error("Missing permissions") as Error & { code: number };
      error.code = 50013;
      message.react.mockRejectedValue(error);

      await execute(message as any);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 50013 }),
        expect.any(String)
      );
    });
  });
});
