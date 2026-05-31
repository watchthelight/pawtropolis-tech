/**
 * Pawtropolis Tech — tests/listeners/messageDadMode.test.ts
 * WHAT: Unit tests for Dad Mode message listener.
 * WHY: Verify pattern matching, odds calculation, and response logic.
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

// NOTE: src/lib/constants.js is intentionally NOT mocked. The odds-clamp
// tests below validate the real production bounds (DADMODE_ODDS_MIN = 2,
// DADMODE_ODDS_MAX = 100000). Mocking constants would let a regression that
// changed those bounds slip through, which is exactly finding #00134.

import { name, execute } from "../../src/listeners/messageDadMode.js";
import { getConfig } from "../../src/lib/config.js";
import { logger } from "../../src/lib/logger.js";
import { DADMODE_ODDS_MIN, DADMODE_ODDS_MAX } from "../../src/lib/constants.js";

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;

function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    guild: { id: "guild-123" },
    author: { bot: false },
    webhookId: null,
    content: "I'm hungry",
    channel: { id: "channel-456" },
    id: "message-789",
    reply: vi.fn(),
    ...overrides,
  };
}

describe("messageDadMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks(); // Restore Math.random spy
    mockGetConfig.mockResolvedValue({
      dadmode_enabled: true,
      dadmode_odds: 1, // Always trigger for tests
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
    });

    it("skips bot messages", async () => {
      const message = createMockMessage({ author: { bot: true } });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips webhook messages", async () => {
      const message = createMockMessage({ webhookId: "webhook-123" });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips empty content", async () => {
      const message = createMockMessage({ content: "" });

      await execute(message as any);

      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("skips command-like messages starting with /", async () => {
      const message = createMockMessage({ content: "/help" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("skips command-like messages starting with !", async () => {
      const message = createMockMessage({ content: "!ping" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("skips command-like messages starting with .", async () => {
      const message = createMockMessage({ content: ".help" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("config checks", () => {
    it("skips if dadmode is not enabled", async () => {
      mockGetConfig.mockResolvedValue({ dadmode_enabled: false });
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("handles config error gracefully", async () => {
      mockGetConfig.mockRejectedValue(new Error("DB error"));
      const message = createMockMessage();

      await execute(message as any);

      expect(logger.error).toHaveBeenCalled();
      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("pattern matching", () => {
    it("matches \"I'm hungry\"", async () => {
      const message = createMockMessage({ content: "I'm hungry" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi hungry, I'm dad." });
    });

    it("matches \"Im tired\"", async () => {
      const message = createMockMessage({ content: "Im tired" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi tired, I'm dad." });
    });

    it("matches \"I am happy\"", async () => {
      const message = createMockMessage({ content: "I am happy" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi happy, I'm dad." });
    });

    it("matches with leading whitespace", async () => {
      const message = createMockMessage({ content: "  I'm excited" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi excited, I'm dad." });
    });

    it("matches with leading quotes", async () => {
      const message = createMockMessage({ content: "\"I'm confused\"" });

      await execute(message as any);

      // Note: The regex captures until sentence end, so the closing quote is included
      expect(message.reply).toHaveBeenCalledWith({ content: "Hi confused\", I'm dad." });
    });

    it("does not match \"I'm\" at the end of message", async () => {
      const message = createMockMessage({ content: "tell me I'm" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("does not match non-matching content", async () => {
      const message = createMockMessage({ content: "hello world" });

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("name sanitization", () => {
    it("removes @ mentions", async () => {
      const message = createMockMessage({ content: "I'm @everyone's friend" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.not.stringContaining("@"),
      }));
    });

    it("removes # channel references", async () => {
      const message = createMockMessage({ content: "I'm in #general now" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.not.stringContaining("#"),
      }));
    });

    it("collapses multiple spaces", async () => {
      const message = createMockMessage({ content: "I'm   very   sleepy" });

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi very sleepy, I'm dad." });
    });

    it("skips empty name after normalization", async () => {
      // Content with only @ and # that get stripped, plus spaces
      // After stripping @/#, we have "   " which trims to empty
      const message = createMockMessage({ content: "I'm @" });

      await execute(message as any);

      // The name after stripping @ is empty, so no reply
      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("odds handling", () => {
    // The source computes roll = Math.floor(Math.random() * odds) and only
    // replies when roll === 0. By controlling Math.random() we can prove the
    // EFFECTIVE odds, and therefore that the real clamp bounds are applied.

    it("uses the real production clamp bounds", () => {
      // Guards against a regression that changes the constants. If these ever
      // drift, the boundary assertions below would silently stop testing the
      // clamp, so pin them explicitly.
      expect(DADMODE_ODDS_MIN).toBe(2);
      expect(DADMODE_ODDS_MAX).toBe(100000);
    });

    it("does not reply when roll is non-zero", async () => {
      vi.restoreAllMocks(); // Clear the beforeEach spy
      // v4: restoreAllMocks no longer keeps the module-mock getConfig
      // implementation, so re-establish it. Use odds > 1 so a 0.5 random
      // produces a genuinely non-zero roll (floor(0.5 * 1000) = 500).
      mockGetConfig.mockResolvedValue({
        dadmode_enabled: true,
        dadmode_odds: 1000,
      });
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("clamps a below-minimum odds value UP to DADMODE_ODDS_MIN", async () => {
      // dadmode_odds: 1 is below the real floor of 2, and (crucially) survives
      // the `cfg.dadmode_odds || 1000` guard because 1 is truthy. So the source
      // computes odds = Math.max(2, Math.min(100000, 1)) = 2.
      // With Math.random() = 0.5: floor(0.5 * 2) = 1  -> NO reply.
      // If the floor clamp were absent (odds stayed 1): floor(0.5 * 1) = 0 -> reply.
      // The absence of a reply here is what proves the lower clamp fired.
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 1 });
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("still hits on a roll of 0 even at the clamped minimum", async () => {
      // Sanity check the other side: at the clamped minimum (odds = 2), a roll
      // of 0 (Math.random() = 0 -> floor(0 * 2) = 0) must still fire.
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 1 });
      vi.spyOn(Math, "random").mockReturnValue(0);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi hungry, I'm dad." });
    });

    it("clamps an above-maximum odds value DOWN to DADMODE_ODDS_MAX", async () => {
      // dadmode_odds far above the real ceiling of 100000.
      // odds = Math.max(2, Math.min(100000, 100_000_000)) = 100000.
      // With Math.random() = 1e-6: floor(1e-6 * 100000) = floor(0.1) = 0 -> reply.
      // If the ceiling clamp were absent (odds stayed 100_000_000):
      //   floor(1e-6 * 100_000_000) = floor(100) = 100 -> NO reply.
      // The presence of a reply here is what proves the upper clamp fired.
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 100_000_000 });
      vi.spyOn(Math, "random").mockReturnValue(1e-6);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).toHaveBeenCalledWith({ content: "Hi hungry, I'm dad." });
    });

    it("does NOT reply at the clamped maximum when the roll misses", async () => {
      // Complements the test above: at odds = 100000 (clamped), a random just
      // above the 1/100000 hit window must miss. floor(2e-5 * 100000) = 2 != 0.
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 100_000_000 });
      vi.spyOn(Math, "random").mockReturnValue(2e-5);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it("CURRENT BEHAVIOR: dadmode_odds of 0 is coerced to 1000, NOT the floor", async () => {
      // Documents finding #00134. Because `cfg.dadmode_odds || 1000` treats the
      // falsy 0 as "unset", a configured 0 becomes 1000 BEFORE the clamp, so the
      // effective odds are 1000 (NOT the DADMODE_ODDS_MIN floor of 2). The lower
      // clamp branch is therefore never exercised by a 0 value. Proven by a
      // random that separates odds=1000 from odds=2:
      //   Math.random() = 0.4 -> floor(0.4 * 1000) = 400 != 0 -> NO reply (odds 1000)
      //   if odds were the floor 2: floor(0.4 * 2) = 0        -> WOULD reply
      // No reply here therefore confirms odds == 1000, i.e. the `|| 1000`
      // coercion ran and the floor was bypassed. This is the source quirk the
      // finding describes; we pin the current behavior rather than fix source.
      mockGetConfig.mockResolvedValue({ dadmode_enabled: true, dadmode_odds: 0 });
      vi.spyOn(Math, "random").mockReturnValue(0.4);
      const message = createMockMessage();

      await execute(message as any);

      expect(message.reply).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("logs warning when reply fails", async () => {
      const message = createMockMessage();
      message.reply.mockRejectedValue(new Error("Missing permissions"));

      await execute(message as any);

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
