// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/quality.test.ts
 * WHAT: Tests for the queries of the Quality page, against a score file that
 *       the research job's own store has written.
 * WHY: The dashboard reads a file that another program writes. Building the
 *      file with the job's store keeps the two in step: a column the job
 *      renames fails here and not on the page. The numbers are small enough
 *      to work out by hand.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDb } from "./_helpers/db.js";
import { Store, WEEK_S, type Score, type WeekRow } from "../../src/features/research/store.js";

const { dbRef, scoreRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
  scoreRef: { current: null as null | import("better-sqlite3").Database },
}));
vi.mock("$lib/server/db", () => ({ db: () => dbRef.current! }));
vi.mock("$lib/server/researchDb", () => ({ researchDb: () => scoreRef.current }));

const {
  getAllTimeMeans,
  getAuthorBoards,
  getRecentTrend,
  getScoreStatus,
  getWeeklyMeasures,
  getWindowSummary,
} = await import("$lib/server/queries/quality");

const G = "g-test";
const DAY = 86400;
// Monday 2024-01-01 00:00 UTC
const MONDAY = 1704067200;

let dir: string;
let file: string;

const range = (startS: number, endS: number) => ({
  startS,
  endS,
  days: Math.max(1, Math.round((endS - startS) / DAY)),
  prevStartS: null,
  spec: { kind: "custom" as const, fromS: startS, toS: endS },
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
  medianLength: 5,
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

/** Lets the job's store write the score file, then opens it the way the dashboard does. */
function writeScores(fill: (store: Store) => void): void {
  scoreRef.current?.close();
  // A second call in one test starts over.
  fs.rmSync(file, { force: true });
  const store = new Store(file);
  fill(store);
  store.close();
  scoreRef.current = new Database(file, { readonly: true });
}

/** `count` messages of one author, a second apart from `startS` on. */
const messagesOf = (authorId: string, count: number, effort: number, startS: number): Score[] =>
  Array.from({ length: count }, (_, i) =>
    score(`${authorId}-${i}`, startS + i, { authorId, effort })
  );

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-queries-"));
  file = path.join(dir, "research.db");
  dbRef.current?.close();
  dbRef.current = makeDb();
});

afterEach(() => {
  scoreRef.current?.close();
  scoreRef.current = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => dbRef.current?.close());

describe("getWindowSummary", () => {
  beforeEach(() => {
    writeScores((store) => {
      store.upsertScores([
        score("before", MONDAY - 1, { effort: 0.9 }),
        score("w1-a", MONDAY, { effort: 0.1 }),
        score("w1-b", MONDAY + DAY, { effort: 0.3 }),
        score("w2-a", MONDAY + WEEK_S, { effort: 0.2 }),
        score("w2-b", MONDAY + WEEK_S + DAY, { effort: 0.6, substantiveness: 0.7 }),
        score("w2-c", MONDAY + WEEK_S + 2 * DAY, { effort: 1 }),
        score("w3-a", MONDAY + 2 * WEEK_S + 6 * DAY, { effort: 0.05 }),
        score("after", MONDAY + 3 * WEEK_S, { effort: 0.9 }),
      ]);
      // Five replies at a 95th percentile of five: a resonance of 1.
      store.setReplyCounts([{ messageId: "w1-a", createdAtS: MONDAY, replyCount: 5 }], 5);
    });
  });

  it("gives the means and the low-effort share of the window", () => {
    const { overview } = getWindowSummary(range(MONDAY, MONDAY + 3 * WEEK_S));

    // The start of the window is in, its end is out.
    expect(overview.totalScored).toBe(6);
    expect(overview.meanEffort).toBeCloseTo(2.25 / 6, 10);
    expect(overview.meanResonance).toBeCloseTo(1 / 6, 10);
    expect(overview.meanSubstantiveness).toBeCloseTo(1.2 / 6, 10);
    // 0.1 and 0.05 are low. A score of exactly 0.2 is not.
    expect(overview.lowEffortShare).toBeCloseTo(2 / 6, 10);
  });

  it("gives one bucket per week, from Monday, with a mean over four weeks by message", () => {
    const { weeks } = getWindowSummary(range(MONDAY, MONDAY + 3 * WEEK_S));

    expect(weeks.map((w) => [w.weekStart, w.iso, w.count])).toEqual([
      [MONDAY, "2024-01-01", 2],
      [MONDAY + WEEK_S, "2024-01-08", 3],
      [MONDAY + 2 * WEEK_S, "2024-01-15", 1],
    ]);
    expect(weeks[0]!.meanEffort).toBeCloseTo(0.2, 10);
    expect(weeks[1]!.meanEffort).toBeCloseTo(0.6, 10);
    expect(weeks[2]!.meanEffort).toBeCloseTo(0.05, 10);
    expect(weeks.map((w) => w.lowEffortShare)).toEqual([0.5, 0, 1]);
    // The week before the window has no bucket, but its message of 0.9 is in the mean.
    expect(weeks[0]!.rolling4w).toBeCloseTo(1.3 / 3, 10);
    // Every message counts once: (0.9 + 0.4 + 1.8) / 6, not the mean of the weekly means.
    expect(weeks[1]!.rolling4w).toBeCloseTo(3.1 / 6, 10);
    expect(weeks[2]!.rolling4w).toBeCloseTo(3.15 / 7, 10);
  });

  it("gives a week in full where the window begins or ends inside it", () => {
    // From Tuesday of the first week to Thursday of the third.
    const { overview, weeks, bins } = getWindowSummary(
      range(MONDAY + DAY, MONDAY + 2 * WEEK_S + 3 * DAY)
    );

    // Monday's message of the first week and Sunday's of the third are outside the window.
    expect(overview.totalScored).toBe(4);
    expect(overview.meanEffort).toBeCloseTo(2.1 / 4, 10);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(4);
    // The weekly series has them all the same.
    expect(weeks.map((w) => [w.weekStart, w.count])).toEqual([
      [MONDAY, 2],
      [MONDAY + WEEK_S, 3],
      [MONDAY + 2 * WEEK_S, 1],
    ]);
    expect(weeks[0]!.meanEffort).toBeCloseTo(0.2, 10);
    expect(weeks[2]!.lowEffortShare).toBe(1);
  });

  it("takes the mean over four weeks from the weeks before the window too", () => {
    writeScores((store) => {
      store.upsertScores(
        [0.9, 0.1, 0.1, 0.1, 0.1].map((effort, i) =>
          score(`m${i}`, MONDAY + i * WEEK_S, { effort })
        )
      );
    });
    const { overview, weeks } = getWindowSummary(range(MONDAY + 3 * WEEK_S, MONDAY + 5 * WEEK_S));

    expect(overview.totalScored).toBe(2);
    expect(overview.meanEffort).toBeCloseTo(0.1, 10);
    expect(weeks.map((w) => w.weekStart)).toEqual([MONDAY + 3 * WEEK_S, MONDAY + 4 * WEEK_S]);
    // The first point has the three weeks before it, the second has dropped the week of 0.9.
    expect(weeks[0]!.rolling4w).toBeCloseTo(0.3, 10);
    expect(weeks[1]!.rolling4w).toBeCloseTo(0.1, 10);
  });

  it("counts the four weeks by the calendar, also across weeks without messages", () => {
    writeScores((store) => {
      store.upsertScores([
        score("old", MONDAY, { effort: 0.9 }),
        score("new", MONDAY + 4 * WEEK_S, { effort: 0.1 }),
      ]);
    });
    const { weeks } = getWindowSummary(range(MONDAY, MONDAY + 5 * WEEK_S));

    expect(weeks.map((w) => w.weekStart)).toEqual([MONDAY, MONDAY + 4 * WEEK_S]);
    // Four weeks back from the second message, the first is no longer in.
    expect(weeks[1]!.rolling4w).toBeCloseTo(0.1, 10);
  });

  it("sorts every score into one of twenty bins, a full score into the last", () => {
    const { bins } = getWindowSummary(range(MONDAY, MONDAY + 3 * WEEK_S));

    expect(bins).toHaveLength(20);
    expect(bins[3]).toMatchObject({ binStart: 0.15, binEnd: 0.2 });
    expect(bins.map((bin) => bin.count)).toEqual([
      0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("gives an empty answer for a window without scores", () => {
    const summary = getWindowSummary(range(MONDAY - 3 * WEEK_S, MONDAY - 2 * WEEK_S));

    expect(summary.overview).toEqual({
      totalScored: 0,
      meanEffort: 0,
      meanResonance: 0,
      meanSubstantiveness: 0,
      lowEffortShare: 0,
    });
    expect(summary.weeks).toEqual([]);
    expect(summary.bins.every((bin) => bin.count === 0)).toBe(true);
  });
});

describe("getAuthorBoards", () => {
  const ADA = "111111111111000001";
  const BEA = "111111111111000002";
  const CY = "111111111111000003";
  const DEE = "111111111111000004";
  const EVE = "111111111111000005";
  const window = range(MONDAY, MONDAY + WEEK_S);

  beforeEach(() => {
    writeScores((store) => {
      store.upsertScores([
        ...messagesOf(ADA, 4, 0.9, MONDAY),
        // Outside the window: these must not count for Ada.
        ...messagesOf(`${ADA}-old`, 50, 0.1, MONDAY - WEEK_S).map((s) => ({ ...s, authorId: ADA })),
        ...messagesOf(BEA, 100, 0.5, MONDAY + 1000),
        ...messagesOf(CY, 10, 0.2, MONDAY + 2000),
        ...messagesOf(DEE, 2, 1, MONDAY + 3000),
        ...messagesOf(EVE, 3, 0.4, MONDAY + 4000),
      ]);
    });

    const bot = dbRef.current!;
    const member = bot.prepare(
      `INSERT INTO user_cache (user_id, guild_id, username, global_name, display_name, avatar_url)
       VALUES (?, ?, ?, ?, ?, '')`
    );
    member.run(ADA, G, "ada", "ada global", "Ada");
    member.run(BEA, G, "bea", "Bea", null);
    // A name from another server is not this server's name.
    member.run(CY, "another-guild", "cy", null, "Wrong Server");
    const activity = bot.prepare(
      "INSERT INTO user_activity (guild_id, user_id, joined_at, left_at) VALUES (?, ?, 1, ?)"
    );
    activity.run(G, ADA, null);
    activity.run(G, BEA, MONDAY);
    const archived = bot.prepare(
      `INSERT INTO messages_archive (message_id, guild_id, channel_id, author_id, author_name,
         created_at_s)
       VALUES (?, ?, 'channel', ?, ?, ?)`
    );
    archived.run(`${CY}-0`, G, CY, "cy before", MONDAY + 2000);
    archived.run(`${CY}-9`, G, CY, "cy now", MONDAY + 2009);
  });

  it("counts every author and ranks those with enough messages three ways", () => {
    const boards = getAuthorBoards(G, window, 3);

    // Dee wrote two messages: counted as an author, on no board.
    expect(boards.distinctAuthors).toBe(5);
    expect(boards.minMsgs).toBe(3);
    expect(boards.topEffort.map((row) => row.id)).toEqual([ADA, BEA, EVE, CY]);
    expect(boards.workhorses.map((row) => row.id)).toEqual([BEA, ADA, CY, EVE]);
    expect(boards.drains.map((row) => row.id)).toEqual([BEA, CY, EVE, ADA]);
  });

  it("gives each row the numbers of the window only", () => {
    const [ada] = getAuthorBoards(G, window, 3).topEffort;

    expect(ada!.msgs).toBe(4);
    expect(ada!.meanEffort).toBeCloseTo(0.9, 10);
    expect(ada!.composite).toBeCloseTo(0.9 * Math.log10(4), 10);
    expect(ada!.drag).toBeCloseTo(0.1 * Math.log10(4), 10);
  });

  it("names an author from the member cache, then from the newest archived message", () => {
    const rows = new Map(getAuthorBoards(G, window, 3).topEffort.map((row) => [row.id, row]));

    expect(rows.get(ADA)).toMatchObject({ display: "Ada", inGuild: true });
    expect(rows.get(BEA)).toMatchObject({ display: "Bea", inGuild: false });
    expect(rows.get(CY)).toMatchObject({ display: "cy now", inGuild: true });
    expect(rows.get(EVE)).toMatchObject({ display: "User 000005", inGuild: true });
  });

  it("asks for 200 messages unless told otherwise", () => {
    const boards = getAuthorBoards(G, window);

    expect(boards.minMsgs).toBe(200);
    expect(boards.distinctAuthors).toBe(5);
    expect(boards.topEffort).toEqual([]);
  });

  it("keeps ten authors on a board", () => {
    writeScores((store) => {
      store.upsertScores(
        Array.from({ length: 12 }, (_, i) =>
          messagesOf(`author-${String(i).padStart(2, "0")}`, 3, (i + 1) / 20, MONDAY + i * 10)
        ).flat()
      );
    });
    const boards = getAuthorBoards(G, window, 3);

    expect(boards.distinctAuthors).toBe(12);
    expect(boards.topEffort).toHaveLength(10);
    expect(boards.topEffort[0]!.id).toBe("author-11");
    expect(boards.drains[0]!.id).toBe("author-00");
  });
});

describe("getWeeklyMeasures", () => {
  it("gives every week that overlaps the window, each measure under its own name", () => {
    const measures = {
      substantiveness: 0.11,
      resonance: 0.12,
      replyRate: 0.13,
      questionRate: 0.14,
      medianLength: 7,
      lexicalDiversity: 0.16,
      authorDistribution: 0.17,
      heuristic: 0.18,
      noLowlistHit: 0.19,
      noRepeatSpam: 0.21,
    };
    writeScores((store) => {
      store.upsertWeek(week(MONDAY - WEEK_S), 1);
      store.upsertWeek(week(MONDAY, { count: 40, ...measures }), 1);
      store.upsertWeek(week(MONDAY + WEEK_S, { count: 50 }), 1);
      store.upsertWeek(week(MONDAY + 2 * WEEK_S), 1);
    });

    // From Thursday of the first week to the end of the second.
    const weeks = getWeeklyMeasures(range(MONDAY + 3 * DAY, MONDAY + 2 * WEEK_S));

    expect(weeks.map((w) => [w.weekStart, w.iso, w.count])).toEqual([
      [MONDAY, "2024-01-01", 40],
      [MONDAY + WEEK_S, "2024-01-08", 50],
    ]);
    expect(weeks[0]!.values).toEqual(measures);
  });
});

describe("getRecentTrend", () => {
  const weeksOf = (values: { effort: number; substantiveness: number }[]) =>
    writeScores((store) => {
      values.forEach((value, i) => store.upsertWeek(week(MONDAY + i * WEEK_S, value), 1));
    });
  const flat = (count: number, effort: number, substantiveness: number) =>
    Array.from({ length: count }, () => ({ effort, substantiveness }));

  it("says nothing with fewer than eight weeks", () => {
    weeksOf(flat(7, 0.5, 0.5));

    expect(getRecentTrend(MONDAY + 20 * WEEK_S)).toBeNull();
  });

  it("sets the last four weeks against the four before, out of the last twelve", () => {
    // 13 weeks: the oldest falls outside the twelve.
    weeksOf([...flat(5, 0.9, 0.9), ...flat(4, 0.4, 0.5), ...flat(4, 0.44, 0.495)]);
    const trend = getRecentTrend(MONDAY + 20 * WEEK_S)!;

    expect(trend.weeks).toHaveLength(12);
    expect(trend.weeks[0]!.weekStart).toBe(MONDAY + WEEK_S);
    expect(trend.weeks[11]!.weekStart).toBe(MONDAY + 12 * WEEK_S);
    expect(trend.effort.current).toBeCloseTo(0.44, 10);
    expect(trend.effort.prior).toBeCloseTo(0.4, 10);
    expect(trend.effort.deltaPct).toBeCloseTo(10, 6);
    expect(trend.substantiveness.deltaPct).toBeCloseTo(-1, 6);
    // A change under two percent is not called a change.
    expect(trend.sentence).toBe(
      "Effort is up 10.0% and substantiveness is about the same against the four weeks before."
    );
  });

  it("names a fall as a fall", () => {
    weeksOf([...flat(4, 0.5, 0.4), ...flat(4, 0.4, 0.42)]);

    expect(getRecentTrend(MONDAY + 20 * WEEK_S)!.sentence).toBe(
      "Effort is down 20.0% and substantiveness is up 5.0% against the four weeks before."
    );
  });

  it("leaves out the weeks from the end of the window on", () => {
    weeksOf([...flat(8, 0.5, 0.5), ...flat(4, 0.9, 0.9)]);
    const trend = getRecentTrend(MONDAY + 8 * WEEK_S)!;

    expect(trend.weeks).toHaveLength(8);
    expect(trend.weeks.at(-1)!.weekStart).toBe(MONDAY + 7 * WEEK_S);
    expect(trend.effort.deltaPct).toBe(0);
  });
});

describe("getAllTimeMeans", () => {
  it("weighs each week by its messages", () => {
    writeScores((store) => {
      store.upsertWeek(
        week(MONDAY, { count: 1, effort: 0.2, resonance: 0, substantiveness: 1 }),
        1
      );
      store.upsertWeek(
        week(MONDAY + WEEK_S, { count: 3, effort: 0.6, resonance: 0.4, substantiveness: 0.2 }),
        1
      );
    });

    const means = getAllTimeMeans()!;
    expect(means.effort).toBeCloseTo(0.5, 10);
    expect(means.resonance).toBeCloseTo(0.3, 10);
    expect(means.substantiveness).toBeCloseTo(0.4, 10);
  });

  it("is null before the job has built a week", () => {
    writeScores(() => {});

    expect(getAllTimeMeans()).toBeNull();
  });
});

describe("getScoreStatus", () => {
  it("reports what the job wrote about itself and the span of the scores", () => {
    writeScores((store) => {
      store.upsertScores([score("a", MONDAY + 50), score("b", MONDAY), score("c", MONDAY + 900)]);
      store.setMeta("total", "3");
      store.setMeta("pending", "2");
      store.setMeta("last_run_s", String(MONDAY + 1000));
    });

    expect(getScoreStatus()).toEqual({
      total: 3,
      pending: 2,
      oldestS: MONDAY,
      newestS: MONDAY + 900,
      lastRunS: MONDAY + 1000,
    });
  });

  it("reports an empty file as empty, with no run yet", () => {
    writeScores(() => {});

    expect(getScoreStatus()).toEqual({
      total: 0,
      pending: 0,
      oldestS: null,
      newestS: null,
      lastRunS: null,
    });
  });
});

describe("on a host without a score file", () => {
  it("answers every question with nothing", () => {
    const all = range(0, MONDAY + WEEK_S);

    expect(getScoreStatus()).toBeNull();
    expect(getWindowSummary(all).overview.totalScored).toBe(0);
    expect(getWindowSummary(all).bins).toHaveLength(20);
    expect(getAuthorBoards(G, all)).toEqual({
      distinctAuthors: 0,
      minMsgs: 200,
      topEffort: [],
      workhorses: [],
      drains: [],
    });
    expect(getWeeklyMeasures(all)).toEqual([]);
    expect(getRecentTrend(MONDAY)).toBeNull();
    expect(getAllTimeMeans()).toBeNull();
  });
});
