/**
 * Pawtropolis Tech -- tests/features/research/store.test.ts
 * WHAT: Tests for the score file: scores, reply counts, weeks and the facts
 *       about the series.
 * WHY: The file is the research record. A score lost on an edit, a reply count
 *      reset by a rescore or two series mixed in one file would not show in
 *      any chart until someone compared numbers by hand.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REPLY_P95,
  Store,
  WEEK_S,
  resonanceOf,
  weekStartOf,
  type Score,
  type WeekRow,
} from "../../../src/features/research/store.js";

// Monday 2024-01-01 00:00 UTC
const MONDAY = 1704067200;

let dir: string;
let file: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-store-"));
  file = path.join(dir, "research.db");
  store = new Store(file);
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const score = (messageId: string, createdAtS: number, change: Partial<Score> = {}): Score => ({
  messageId,
  createdAtS,
  authorId: "author-1",
  contentRev: 0,
  effort: 0.5,
  heuristic: 0.4,
  novelty: 0.3,
  notFiller: 1,
  lexicalDensity: 0.2,
  substantiveness: 0.1,
  ...change,
});

const week = (weekStart: number, change: Partial<WeekRow> = {}): WeekRow => ({
  weekStart,
  count: 1,
  effort: 0.5,
  heuristic: 0.5,
  resonance: 0.5,
  medianLength: 4,
  lexicalDiversity: 0.5,
  questionRate: 0.5,
  noRepeatSpam: 0.5,
  noLowlistHit: 0.5,
  replyRate: 0.5,
  authorDistribution: 0.5,
  substantiveness: 0.5,
  novelty: 0.5,
  notFiller: 0.5,
  lexDensity: 0.5,
  ...change,
});

describe("weekStartOf", () => {
  it("is the Monday 00:00 UTC of the week", () => {
    expect(weekStartOf(MONDAY)).toBe(MONDAY);
    expect(weekStartOf(MONDAY + WEEK_S - 1)).toBe(MONDAY);
    expect(weekStartOf(MONDAY - 1)).toBe(MONDAY - WEEK_S);
    expect(new Date(weekStartOf(1763200000) * 1000).getUTCDay()).toBe(1);
  });
});

describe("resonanceOf", () => {
  it("is 0 without replies and 1 from the 95th percentile on", () => {
    expect(resonanceOf(0, 2)).toBe(0);
    expect(resonanceOf(1, 2)).toBeCloseTo(Math.log(2) / Math.log(3), 12);
    expect(resonanceOf(2, 2)).toBe(1);
    expect(resonanceOf(40, 2)).toBe(1);
  });
});

describe("Store", () => {
  it("can be opened again without losing anything", () => {
    store.upsertScores([score("1", MONDAY)]);
    store.setMeta("total", "1");
    store.close();
    store = new Store(file);
    expect(store.countScores()).toBe(1);
    expect(store.getMeta("total")).toBe("1");
  });

  it("lets the dashboard read while it is open for writing", () => {
    store.upsertScores([score("1", MONDAY)]);
    const reader = new Database(file, { readonly: true });
    expect(reader.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(reader.prepare("SELECT COUNT(*) AS n FROM message_scores").get()).toEqual({ n: 1 });
    reader.close();
  });

  it("keeps facts about the series", () => {
    expect(store.getMeta("last_run_s")).toBeNull();
    store.setMeta("last_run_s", "100");
    store.setMeta("last_run_s", "200");
    expect(store.getMeta("last_run_s")).toBe("200");
  });

  it("records what the series is made from, and refuses another series", () => {
    const identity = { channel_id: "c1", embedding_model: "model-a" };
    store.assertIdentity(identity);
    expect(store.getMeta("channel_id")).toBe("c1");
    expect(() => store.assertIdentity(identity)).not.toThrow();
    expect(() => store.assertIdentity({ ...identity, embedding_model: "model-b" })).toThrow(
      'its embedding_model is "model-a", this run has "model-b"'
    );
    expect(store.getMeta("embedding_model")).toBe("model-a");
  });

  it("returns the scores of a time range, start included and end not", () => {
    store.upsertScores([score("1", 99), score("2", 100), score("3", 199), score("4", 200)]);
    expect(store.keysInRange(100, 200)).toEqual([
      { messageId: "2", createdAtS: 100, contentRev: 0, replyCount: 0 },
      { messageId: "3", createdAtS: 199, contentRev: 0, replyCount: 0 },
    ]);
    expect(store.scoresInRange(100, 200).map((s) => s.messageId)).toEqual(["2", "3"]);
    expect(store.scoresInRange(100, 101)).toEqual([
      { ...score("2", 100), replyCount: 0, resonance: 0 },
    ]);
  });

  it("keeps the reply count of a message that is scored again", () => {
    store.upsertScores([score("1", 100)]);
    store.setReplyCounts([{ messageId: "1", createdAtS: 100, replyCount: 2 }], 2);
    store.upsertScores([score("1", 100, { contentRev: 777, effort: 0.9 })]);
    expect(store.scoresInRange(0, 1000)).toEqual([
      { ...score("1", 100, { contentRev: 777, effort: 0.9 }), replyCount: 2, resonance: 1 },
    ]);
    expect(store.countScores()).toBe(1);
  });

  it("deletes scores", () => {
    store.upsertScores([score("1", 100), score("2", 100), score("3", 101)]);
    store.deleteScores([
      { messageId: "2", createdAtS: 100 },
      { messageId: "3", createdAtS: 101 },
    ]);
    expect(store.keysInRange(0, 1000).map((k) => k.messageId)).toEqual(["1"]);
  });

  it("writes resonance with the reply count", () => {
    store.upsertScores([score("1", 100), score("2", 101)]);
    store.setReplyCounts(
      [
        { messageId: "1", createdAtS: 100, replyCount: 1 },
        { messageId: "2", createdAtS: 101, replyCount: 9 },
      ],
      DEFAULT_REPLY_P95
    );
    const [first, second] = store.scoresInRange(0, 1000);
    expect(first?.resonance).toBeCloseTo(Math.log(2) / Math.log(6), 12);
    expect(second?.resonance).toBe(1);
  });

  it("measures the 95th percentile of the reply counts", () => {
    expect(store.replyP95()).toBe(DEFAULT_REPLY_P95);
    // 20 messages with replies: eighteen with 1, one with 3, one with 7
    store.upsertScores(Array.from({ length: 25 }, (_, i) => score(String(i), 100 + i)));
    expect(store.replyP95()).toBe(DEFAULT_REPLY_P95);
    const counts = [...new Array<number>(18).fill(1), 3, 7];
    store.setReplyCounts(
      counts.map((replyCount, i) => ({ messageId: String(i), createdAtS: 100 + i, replyCount })),
      DEFAULT_REPLY_P95
    );
    // sorted counts, position floor(20 * 0.95) = 19: the last one
    expect(store.replyP95()).toBe(7);
    store.setReplyCounts([{ messageId: "19", createdAtS: 119, replyCount: 0 }], DEFAULT_REPLY_P95);
    // 19 left, position floor(19 * 0.95) = 18: the 3
    expect(store.replyP95()).toBe(3);
  });

  it("rewrites resonance, per message and per week, when the percentile moves", () => {
    store.upsertScores([score("1", MONDAY), score("2", MONDAY + 60), score("3", MONDAY + WEEK_S)]);
    store.setReplyCounts(
      [
        { messageId: "1", createdAtS: MONDAY, replyCount: 1 },
        { messageId: "3", createdAtS: MONDAY + WEEK_S, replyCount: 2 },
      ],
      DEFAULT_REPLY_P95
    );
    store.upsertWeek(week(MONDAY, { count: 2 }), 1);
    store.upsertWeek(week(MONDAY + WEEK_S), 1);
    store.upsertWeek(week(MONDAY + 2 * WEEK_S, { resonance: 0.123 }), 1);

    store.rescaleResonance(2);

    const half = Math.log(2) / Math.log(3);
    const resonance = Object.fromEntries(
      store.scoresInRange(0, MONDAY + 3 * WEEK_S).map((s) => [s.messageId, s.resonance])
    );
    expect(resonance["1"]).toBeCloseTo(half, 12);
    expect(resonance["2"]).toBe(0);
    expect(resonance["3"]).toBe(1);

    const reader = new Database(file, { readonly: true });
    const weeks = reader
      .prepare("SELECT week_start AS w, resonance AS r FROM weekly_overlay ORDER BY week_start")
      .all() as { w: number; r: number }[];
    reader.close();
    expect(weeks[0]?.r).toBeCloseTo(half / 2, 12);
    expect(weeks[1]?.r).toBe(1);
    // A week without scores keeps its row as it is.
    expect(weeks[2]?.r).toBe(0.123);
  });

  it("counts scores and week rows by week", () => {
    store.upsertScores([
      score("1", MONDAY),
      score("2", MONDAY + WEEK_S - 1),
      score("3", MONDAY + WEEK_S),
    ]);
    expect(store.scoreCountsByWeek()).toEqual(
      new Map([
        [MONDAY, 2],
        [MONDAY + WEEK_S, 1],
      ])
    );
    expect(store.weekCounts()).toEqual(new Map());
    store.upsertWeek(week(MONDAY, { count: 2 }), 50);
    store.upsertWeek(week(MONDAY, { count: 3 }), 60);
    expect(store.weekCounts()).toEqual(new Map([[MONDAY, 3]]));
    store.deleteWeek(MONDAY);
    expect(store.weekCounts()).toEqual(new Map());
  });

  it("knows the oldest scored message", () => {
    expect(store.firstScoreAt()).toBeNull();
    store.upsertScores([score("2", 500), score("1", 300)]);
    expect(store.firstScoreAt()).toBe(300);
  });
});
