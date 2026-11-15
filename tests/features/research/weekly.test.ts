/**
 * Pawtropolis Tech -- tests/features/research/weekly.test.ts
 * WHAT: Tests for the row a week gets in the overlay table.
 * WHY: The long lines on the Quality tab are drawn from these rows. Each
 *      measure is worked out by hand here for a week of four messages.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, expect, it } from "vitest";
import { summarizeWeek, type WeekMessage } from "../../../src/features/research/weekly.js";

const lowlist = new Set(["lol", "ok"]);
const WEEK = 1704067200;

const message = (
  content: string,
  authorId: string,
  isReply: boolean,
  value: number
): WeekMessage => ({
  content,
  authorId,
  isReply,
  score: {
    effort: value,
    heuristic: value / 2,
    resonance: value / 4,
    substantiveness: value,
    novelty: value / 2,
    notFiller: value > 0.5 ? 1 : 0,
    lexicalDensity: value / 4,
  },
});

describe("summarizeWeek", () => {
  it("has no row for a week without messages", () => {
    expect(summarizeWeek(WEEK, [], lowlist)).toBeNull();
  });

  it("works out every measure of a small week", () => {
    const row = summarizeWeek(
      WEEK,
      [
        message("where is the brush pack?", "a", false, 0.8), // 5 tokens
        message("lol", "a", true, 0.2), // 1 token, throwaway only
        message("the brush pack is hereeeee", "a", true, 0.6), // 5 tokens, stretched
        message("ok lol", "b", false, 0.4), // 2 tokens, throwaway only
      ],
      lowlist
    );
    expect(row).not.toBeNull();
    expect(row?.weekStart).toBe(WEEK);
    expect(row?.count).toBe(4);
    expect(row?.effort).toBeCloseTo(0.5, 12);
    expect(row?.heuristic).toBeCloseTo(0.25, 12);
    expect(row?.resonance).toBeCloseTo(0.125, 12);
    expect(row?.substantiveness).toBeCloseTo(0.5, 12);
    expect(row?.novelty).toBeCloseTo(0.25, 12);
    expect(row?.notFiller).toBe(0.5);
    expect(row?.lexDensity).toBeCloseTo(0.125, 12);
    // token counts 5, 1, 5, 2: the middle two are 2 and 5
    expect(row?.medianLength).toBe(3.5);
    // 13 tokens, 9 different: where is the brush pack? lol pack hereeeee ok
    expect(row?.lexicalDiversity).toBeCloseTo(Math.log1p(9) / Math.log1p(13), 12);
    expect(row?.questionRate).toBe(0.25);
    expect(row?.noRepeatSpam).toBe(0.75);
    expect(row?.noLowlistHit).toBe(0.5);
    expect(row?.replyRate).toBe(0.5);
    // authors wrote 3 and 1: gini = (-1 * 1 + 1 * 3) / (2 * 4) = 0.25
    expect(row?.authorDistribution).toBeCloseTo(0.75, 12);
  });

  it("takes the middle value of an odd number of lengths", () => {
    const row = summarizeWeek(
      WEEK,
      [
        message("one", "a", false, 0.5),
        message("one two three", "b", false, 0.5),
        message("one two", "c", false, 0.5),
      ],
      lowlist
    );
    expect(row?.medianLength).toBe(2);
    // Three authors with one message each: perfectly even.
    expect(row?.authorDistribution).toBe(1);
  });

  it("has no word variety to report when no message has a word", () => {
    const row = summarizeWeek(WEEK, [message("\u{1F43E}", "a", false, 0.5)], lowlist);
    expect(row?.lexicalDiversity).toBe(0);
    expect(row?.medianLength).toBe(0);
    expect(row?.noLowlistHit).toBe(1);
  });
});
