// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/budget.test.ts
 * WHAT: Token pricing, the per-run estimate, the monthly ledger and the cap check.
 * WHY: The org API budget is fixed. The guard has to refuse before money is
 *      spent, count a calendar month correctly, and price an unknown model on
 *      the safe side.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  NO_USAGE,
  checkBudget,
  costUsd,
  estimateCostUsd,
  formatFooter,
  formatTokens,
  formatUsd,
  getMonthSpendUsd,
  imageTokens,
  isPriceKnown,
  monthStartS,
  recordRun,
  type RunRecord,
} from "../../../src/features/artistInvestigation/budget.js";
import { CHANNEL_ID, GUILD_ID, memoryDb } from "./fixtures.js";

const NOV_14 = Date.UTC(2026, 10, 14, 16, 30);

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  guildId: GUILD_ID,
  channelId: CHANNEL_ID,
  invokedBy: "400000000000000010",
  model: "claude-opus-5-5",
  status: "ok",
  usage: { inputTokens: 30_000, outputTokens: 6_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0.24,
  imageCount: 4,
  lookupCount: 8,
  nowMs: NOV_14,
  ...overrides,
});

describe("costUsd", () => {
  it("prices input and output tokens per million", () => {
    expect(costUsd("claude-opus-5-5", { ...NO_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(24, 10);
    expect(costUsd("claude-sonnet-5-5", { ...NO_USAGE, inputTokens: 500_000, outputTokens: 100_000 })).toBeCloseTo(2, 10);
    expect(costUsd("claude-fable-5-2", { ...NO_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(48, 10);
  });

  it("prices cache writes and cache reads at their own rates", () => {
    expect(costUsd("claude-opus-5-5", { ...NO_USAGE, cacheWriteTokens: 1_000_000 })).toBeCloseTo(5, 10);
    expect(costUsd("claude-opus-5-5", { ...NO_USAGE, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2, 10);
  });

  it("costs nothing when no tokens were used", () => {
    expect(costUsd("claude-opus-5-5", NO_USAGE)).toBe(0);
  });

  it("switches Haiku to its long-prompt price only past 100,000 prompt tokens", () => {
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 100_000 })).toBeCloseTo(0.01, 10);
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 100_001 })).toBeCloseTo(0.0500005, 10);
    // Cached tokens are part of the prompt size.
    expect(costUsd("claude-haiku-5-5", { ...NO_USAGE, inputTokens: 60_000, cacheReadTokens: 60_000, outputTokens: 1_000 })).toBeCloseTo(
      (60_000 * 0.5 + 60_000 * 0.05 + 1_000 * 2.5) / 1_000_000,
      10
    );
  });

  it("recognizes a dated model id", () => {
    expect(isPriceKnown("claude-opus-5-5-20261101")).toBe(true);
    expect(costUsd("claude-opus-5-5-20261101", { ...NO_USAGE, inputTokens: 1_000_000 })).toBeCloseTo(4, 10);
  });

  it("prices an unknown model at the highest known rate", () => {
    expect(isPriceKnown("claude-opus-5")).toBe(false);
    expect(isPriceKnown("some-future-model")).toBe(false);
    expect(costUsd("some-future-model", { ...NO_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(48, 10);
  });
});

describe("imageTokens and estimateCostUsd", () => {
  it("counts an image in 28 pixel patches, rounding each side up", () => {
    expect(imageTokens(1568, 1176)).toBe(56 * 42);
    expect(imageTokens(100, 100)).toBe(16);
    expect(imageTokens(28, 28)).toBe(1);
  });

  it("assumes the whole output allowance and three characters a token", () => {
    const estimate = estimateCostUsd("claude-opus-5-5", { imageTokens: 10_000, textChars: 30_000, maxOutputTokens: 20_000 });
    // (10,000 image + 10,000 text + 1,500 overhead) input tokens at $4, 20,000 output tokens at $20.
    expect(estimate).toBeCloseTo((21_500 * 4 + 20_000 * 20) / 1_000_000, 10);
  });

  it("never estimates below what the same tokens cost afterwards", () => {
    const estimate = estimateCostUsd("claude-opus-5-5", { imageTokens: 2_352 * 12, textChars: 90_000, maxOutputTokens: 20_000 });
    const actual = costUsd("claude-opus-5-5", { ...NO_USAGE, inputTokens: 2_352 * 12 + 30_000, outputTokens: 20_000 });
    expect(estimate).toBeGreaterThanOrEqual(actual);
  });
});

describe("checkBudget", () => {
  it("allows a run that fits under the cap", () => {
    expect(checkBudget(200, 10, 0.5)).toEqual({ allowed: true });
  });

  it("allows a run that lands exactly on the cap", () => {
    expect(checkBudget(200, 199.5, 0.5)).toEqual({ allowed: true });
  });

  it("refuses a run that would pass the cap, with the numbers and the setting to change", () => {
    const decision = checkBudget(200, 199.75, 0.5);
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringContaining("Monthly cap reached") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("$199.75") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("up to $0.50") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("$200.00 cap (INVESTIGATE_MONTHLY_CAP_USD)") });
  });

  it("refuses every paid run when the cap is zero", () => {
    expect(checkBudget(0, 0, 0.01).allowed).toBe(false);
  });

  it("allows a run that costs nothing even when the month is over the cap", () => {
    // Lookups without the model are free, so the cap does not block them.
    expect(checkBudget(200, 200, 0)).toEqual({ allowed: true });
  });
});

describe("monthly ledger", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    db = memoryDb();
  });
  afterEach(() => {
    db.close();
  });

  it("finds the start of the UTC calendar month", () => {
    expect(monthStartS(NOV_14)).toBe(Date.UTC(2026, 10, 1) / 1000);
    expect(monthStartS(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe(Date.UTC(2026, 11, 1) / 1000);
    expect(monthStartS(Date.UTC(2027, 0, 1, 0, 0, 0))).toBe(Date.UTC(2027, 0, 1) / 1000);
  });

  it("starts the month at zero", () => {
    expect(getMonthSpendUsd(db, NOV_14)).toBe(0);
  });

  it("adds up every run recorded this month, whatever its status", () => {
    recordRun(db, run({ costUsd: 0.24 }));
    recordRun(db, run({ costUsd: 0.5, status: "error", usage: NO_USAGE, nowMs: NOV_14 + 60_000 }));
    recordRun(db, run({ costUsd: 0, status: "skipped", usage: NO_USAGE }));
    expect(getMonthSpendUsd(db, NOV_14 + 120_000)).toBeCloseTo(0.74, 10);
  });

  it("leaves last month's runs out and resets at the month boundary", () => {
    const novemberStart = Date.UTC(2026, 10, 1);
    recordRun(db, run({ costUsd: 150, nowMs: novemberStart - 1000 }));
    recordRun(db, run({ costUsd: 1.25, nowMs: novemberStart }));
    recordRun(db, run({ costUsd: 2, nowMs: NOV_14 }));

    expect(getMonthSpendUsd(db, NOV_14)).toBeCloseTo(3.25, 10);
    expect(getMonthSpendUsd(db, Date.UTC(2026, 10, 30, 23, 59, 59))).toBeCloseTo(3.25, 10);
    expect(getMonthSpendUsd(db, Date.UTC(2026, 11, 1))).toBe(0);
  });

  it("stores who ran it, where, the model, the tokens and the counts, and no ticket content", () => {
    recordRun(db, run({ usage: { inputTokens: 30_000, outputTokens: 6_000, cacheReadTokens: 100, cacheWriteTokens: 200 } }));

    const row = db.prepare(`SELECT * FROM artist_investigation_run`).get() as Record<string, unknown>;
    expect(row).toMatchObject({
      guild_id: GUILD_ID,
      channel_id: CHANNEL_ID,
      invoked_by: "400000000000000010",
      model: "claude-opus-5-5",
      status: "ok",
      input_tokens: 30_000,
      output_tokens: 6_000,
      cache_read_tokens: 100,
      cache_write_tokens: 200,
      cost_usd: 0.24,
      image_count: 4,
      lookup_count: 8,
      created_at_s: Math.floor(NOV_14 / 1000),
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        "cache_read_tokens", "cache_write_tokens", "channel_id", "cost_usd", "created_at_s", "guild_id", "id",
        "image_count", "input_tokens", "invoked_by", "lookup_count", "model", "output_tokens", "status",
      ].sort()
    );
  });

  it("blocks the next run once recorded spend reaches the cap", () => {
    recordRun(db, run({ costUsd: 4.8 }));
    const spent = getMonthSpendUsd(db, NOV_14);
    expect(checkBudget(5, spent, 0.1).allowed).toBe(true);
    expect(checkBudget(5, spent, 0.3).allowed).toBe(false);
  });
});

describe("formatting", () => {
  it("shows dollars to the cent and never rounds a real cost to zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("under $0.01");
    expect(formatUsd(1.239)).toBe("$1.24");
    expect(formatUsd(200)).toBe("$200.00");
  });

  it("shortens token counts", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(21_500)).toBe("21.5k");
  });

  it("puts this run and the month against the cap in the footer", () => {
    const footer = formatFooter({
      model: "claude-opus-5-5",
      usage: { inputTokens: 20_000, outputTokens: 2_000, cacheReadTokens: 1_000, cacheWriteTokens: 500 },
      runUsd: 0.486,
      monthUsd: 12.34,
      capUsd: 200,
    });
    expect(footer).toBe(
      "Run: $0.49 (21.5k in / 2.0k out, claude-opus-5-5) · Month: $12.34 of $200.00 cap · estimated from published prices"
    );
  });

  it("says so in the footer when the model has no price on file", () => {
    const footer = formatFooter({ model: "some-future-model", usage: NO_USAGE, runUsd: 0, monthUsd: 0, capUsd: 200 });
    expect(footer).toContain("no price on file for this model, cost shown at the highest known rate");
  });
});
