/**
 * Pawtropolis Tech -- tests/features/research/run.test.ts
 * WHAT: Tests for one run of the research job, against a throwaway archive and
 *       a stand-in for the embedding model.
 * WHY: The job's one promise is that after a run the score file says what the
 *      archive says: new and edited messages have a score, deleted ones have
 *      none, bots and empty messages never get one. These tests walk through
 *      each way the archive can change between two runs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Archive } from "../../../src/features/research/archive.js";
import {
  WINDOW_S,
  fullPassDue,
  runResearch,
  type RunOptions,
} from "../../../src/features/research/run.js";
import { Store, WEEK_S, weekStartOf } from "../../../src/features/research/store.js";
import {
  CHANNEL,
  GUILD,
  addMessages,
  changeArchive,
  createArchiveDb,
  fakeEmbedder,
  tinyModel,
} from "./helpers.js";

const DAY = 86400;
// Wednesday 2024-01-10 12:00 UTC
const NOW = 1704067200 + 9 * DAY + 12 * 3600;
// A moment inside the three-day window
const T = NOW - 1000;

const lowlist = new Set(["lol", "ok"]);
const fillerBank = new Set(["lol"]);
const identity = {
  guild_id: GUILD,
  channel_id: CHANNEL,
  effort_model: "tiny",
  embedding_model: "fake",
};

let dir: string;
let dbFile: string;
let archive: Archive;
let store: Store;
let fake: ReturnType<typeof fakeEmbedder>;
let embedderAskedFor: ReturnType<typeof vi.fn<RunOptions["embedder"]>>;

function run(change: Partial<RunOptions> = {}) {
  return runResearch({
    archive,
    store,
    model: tinyModel(),
    lowlist,
    fillerBank,
    identity,
    embedder: embedderAskedFor,
    nowS: NOW,
    mode: "window",
    ...change,
  });
}

const scores = () => store.scoresInRange(0, NOW + 10 * DAY);
const scoreOf = (id: string) => scores().find((s) => s.messageId === id);
const scoredIds = () => scores().map((s) => s.messageId);
const weeks = () => [...store.weekCounts()];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-run-"));
  dbFile = path.join(dir, "data.db");
  createArchiveDb(dbFile);
  archive = new Archive(dbFile, GUILD, CHANNEL);
  store = new Store(path.join(dir, "research.db"));
  fake = fakeEmbedder();
  embedderAskedFor = vi.fn<RunOptions["embedder"]>(async () => fake.embedder);
});

afterEach(() => {
  archive.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A small conversation with one of everything. */
function addConversation(): void {
  addMessages(dbFile, [
    { id: "100", at: T, author: "a", content: "x" },
    { id: "101", at: T + 10, author: "a", content: "first message here" },
    { id: "102", at: T + 20, bot: true, content: "beep" },
    { id: "103", at: T + 30, author: "b", content: "second one?", replyTo: "101" },
    { id: "104", at: T + 40, author: "b", content: "this was removed", deleted: true },
    { id: "105", at: T + 50, author: "a", content: "", attachment: true },
    { id: "106", at: T + 60, author: "a", content: "third message here", replyTo: "103" },
  ]);
}

describe("fullPassDue", () => {
  const nine = 1704067200 + 9 * DAY + 9 * 3600; // 2024-01-10 09:00 UTC

  it("is due when there never was one", () => {
    expect(fullPassDue(null, NOW)).toBe(true);
  });

  it("is due once a day, from 09:00 UTC on", () => {
    const yesterdayNoon = nine - DAY + 3 * 3600;
    expect(fullPassDue(yesterdayNoon, nine - 1)).toBe(false);
    expect(fullPassDue(yesterdayNoon, nine)).toBe(true);
    expect(fullPassDue(nine + 60, nine + 12 * 3600)).toBe(false);
    expect(fullPassDue(nine + 60, nine + DAY - 1)).toBe(false);
    expect(fullPassDue(nine + 60, nine + DAY)).toBe(true);
  });
});

describe("runResearch", () => {
  it("scores people's messages that have text, and nothing else", async () => {
    addConversation();
    const result = await run();

    expect(result).toEqual({
      mode: "window",
      scored: 4,
      removed: 0,
      pending: 0,
      replyUpdates: 2,
      weeksBuilt: 1,
      replyP95: 5,
      total: 4,
    });
    expect(scoredIds()).toEqual(["100", "101", "103", "106"]);
  });

  it("gives the model each text and the three messages before it", async () => {
    addConversation();
    await run();

    // One call: the four texts, then their four contexts. A deleted message is
    // no context; a bot's message and an empty one are.
    expect(fake.calls).toEqual([
      [
        "x",
        "first message here",
        "second one?",
        "third message here",
        " ",
        "x",
        "x first message here beep",
        "beep second one?",
      ],
    ]);
  });

  it("writes the measures of each message", async () => {
    addConversation();
    await run();

    // "x" against the context " ": same length, so the stand-in model calls them alike.
    const first = scoreOf("100");
    expect(first?.effort).toBeCloseTo(0.25, 6);
    expect(first?.novelty).toBeCloseTo(0, 6);
    expect(first?.authorId).toBe("a");
    expect(first?.contentRev).toBe(0);

    // A question that is unlike its context.
    const question = scoreOf("103");
    expect(question?.effort).toBeCloseTo(0.75, 6);
    expect(question?.novelty).toBe(1);
    expect(question?.notFiller).toBe(1);
    expect(question?.lexicalDensity).toBe(1);
    expect(question?.substantiveness).toBeCloseTo(0.5 + 0.3 + 0.2, 12);
    expect(question?.heuristic).toBeGreaterThan(0);
    expect(question?.authorId).toBe("b");
  });

  it("counts the replies inside the window", async () => {
    addConversation();
    await run();

    const oneReply = Math.log(2) / Math.log(6);
    expect(scoreOf("101")).toMatchObject({ replyCount: 1 });
    expect(scoreOf("101")?.resonance).toBeCloseTo(oneReply, 12);
    expect(scoreOf("103")?.replyCount).toBe(1);
    expect(scoreOf("106")).toMatchObject({ replyCount: 0, resonance: 0 });
  });

  it("builds the week and notes the state of the series", async () => {
    addConversation();
    await run();

    expect(weeks()).toEqual([[weekStartOf(T), 4]]);
    expect(store.getMeta("total")).toBe("4");
    expect(store.getMeta("pending")).toBe("0");
    expect(store.getMeta("last_run_s")).toBe(String(NOW));
    expect(store.getMeta("dirty_weeks")).toBe("");
    expect(store.getMeta("channel_id")).toBe(CHANNEL);
    // A window run is not a full pass.
    expect(store.getMeta("last_full_s")).toBeNull();
  });

  it("does not load the model when nothing is new", async () => {
    addConversation();
    await run();
    embedderAskedFor.mockClear();

    const result = await run({ nowS: NOW + 900 });
    expect(result).toMatchObject({ scored: 0, removed: 0, replyUpdates: 0, weeksBuilt: 0 });
    expect(embedderAskedFor).not.toHaveBeenCalled();
  });

  it("never loads the model for a channel without messages", async () => {
    expect(await run({ mode: "full" })).toMatchObject({ scored: 0, total: 0, weeksBuilt: 0 });
    expect(embedderAskedFor).not.toHaveBeenCalled();
  });

  it("scores an edited message again and keeps its replies", async () => {
    addConversation();
    await run();
    changeArchive(
      dbFile,
      "UPDATE messages_archive SET content = ?, is_edited = 1, edited_at_s = ? WHERE message_id = '101'",
      "first message, now a question?",
      T + 500
    );

    const result = await run({ nowS: NOW + 900 });
    expect(result).toMatchObject({ scored: 1, removed: 0, replyUpdates: 0, weeksBuilt: 1 });
    expect(scoreOf("101")).toMatchObject({ contentRev: T + 500, replyCount: 1 });
    expect(scoreOf("101")?.effort).toBeCloseTo(0.75, 6);
    expect(fake.calls.at(-1)).toEqual(["first message, now a question?", "x"]);
  });

  it("removes the score of a deleted message and the reply it was", async () => {
    addConversation();
    await run();
    changeArchive(dbFile, "UPDATE messages_archive SET is_deleted = 1 WHERE message_id = '103'");

    const result = await run({ nowS: NOW + 900 });
    expect(result).toMatchObject({ scored: 0, removed: 1, replyUpdates: 1, total: 3 });
    expect(scoredIds()).toEqual(["100", "101", "106"]);
    expect(scoreOf("101")).toMatchObject({ replyCount: 0, resonance: 0 });
    expect(weeks()).toEqual([[weekStartOf(T), 3]]);
  });

  it("removes the score of a message that left the archive or lost its text", async () => {
    addConversation();
    await run();
    changeArchive(dbFile, "DELETE FROM messages_archive WHERE message_id = '100'");
    changeArchive(
      dbFile,
      "UPDATE messages_archive SET content = '', edited_at_s = ? WHERE message_id = '106'",
      T + 600
    );

    expect(await run({ nowS: NOW + 900 })).toMatchObject({ scored: 0, removed: 2 });
    expect(scoredIds()).toEqual(["101", "103"]);
  });

  it("drops the week when its last message is gone", async () => {
    addMessages(dbFile, [{ id: "1", at: T }]);
    await run();
    expect(weeks()).toHaveLength(1);
    changeArchive(dbFile, "UPDATE messages_archive SET is_deleted = 1");

    expect(await run({ nowS: NOW + 900 })).toMatchObject({ removed: 1, weeksBuilt: 1, total: 0 });
    expect(weeks()).toEqual([]);
  });

  it("uses only what was said in an earlier second as context", async () => {
    addMessages(dbFile, [
      { id: "201", at: T, content: "alpha" },
      { id: "202", at: T, content: "beta" },
      { id: "203", at: T + 1, content: "gamma" },
    ]);
    await run();
    expect(fake.calls[0]?.slice(3)).toEqual([" ", " ", "alpha beta"]);
  });

  it("finds the context across the edge of a batch", async () => {
    addMessages(
      dbFile,
      Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i), at: T + i, content: `m${i}` }))
    );
    expect(await run()).toMatchObject({ scored: 300, pending: 0 });

    // 256 messages in the first call, 44 in the second. The first message of
    // the second call has the last three of the first call before it.
    expect(fake.calls.map((call) => call.length)).toEqual([512, 88]);
    expect(fake.calls[1]?.[0]).toBe("m256");
    expect(fake.calls[1]?.[44]).toBe("m253 m254 m255");
  });

  it("stops at its limit, oldest first, and goes on in the next run", async () => {
    addMessages(
      dbFile,
      Array.from({ length: 5 }, (_, i) => ({ id: String(300 + i), at: T + i }))
    );

    expect(await run({ maxMessages: 2 })).toMatchObject({ scored: 2, pending: 3, total: 2 });
    expect(scoredIds()).toEqual(["300", "301"]);
    expect(store.getMeta("pending")).toBe("3");

    expect(await run({ maxMessages: 2 })).toMatchObject({ scored: 2, pending: 1 });
    expect(await run({ maxMessages: 2 })).toMatchObject({ scored: 1, pending: 0 });
    expect(await run({ maxMessages: 2 })).toMatchObject({ scored: 0, pending: 0 });
    expect(weeks()).toEqual([[weekStartOf(T), 5]]);
  });

  it("skips a message that disappears while the run is at work", async () => {
    addConversation();
    const texts = archive.texts.bind(archive);
    const spy = vi
      .spyOn(archive, "texts")
      .mockImplementationOnce((fromS, toS) =>
        texts(fromS, toS).filter((m) => m.messageId !== "103")
      );

    expect(await run()).toMatchObject({ scored: 3 });
    expect(scoredIds()).toEqual(["100", "101", "106"]);

    spy.mockRestore();
    expect(await run({ nowS: NOW + 900 })).toMatchObject({ scored: 1 });
    expect(scoredIds()).toEqual(["100", "101", "103", "106"]);
  });

  it("refuses a score file that belongs to another series", async () => {
    addConversation();
    await run();
    await expect(run({ identity: { ...identity, channel_id: "another-channel" } })).rejects.toThrow(
      "belongs to another series"
    );
    await expect(run({ identity: { ...identity, embedding_model: "newer" } })).rejects.toThrow(
      'its embedding_model is "fake"'
    );
  });

  describe("the window", () => {
    const OLD = NOW - WINDOW_S - 10 * DAY;

    it("leaves alone what is older than three days", async () => {
      addMessages(dbFile, [
        { id: "1", at: OLD },
        { id: "2", at: T },
      ]);
      expect(await run()).toMatchObject({ scored: 1 });
      expect(scoredIds()).toEqual(["2"]);
    });

    it("leaves a reply to an old message to the full pass", async () => {
      addMessages(dbFile, [{ id: "1", at: OLD }]);
      await run({ mode: "full" });
      addMessages(dbFile, [{ id: "2", at: T, replyTo: "1" }]);

      expect(await run({ nowS: NOW + 900 })).toMatchObject({ scored: 1, replyUpdates: 0 });
      expect(scoreOf("1")?.replyCount).toBe(0);

      expect(await run({ mode: "full", nowS: NOW + 1800 })).toMatchObject({
        scored: 0,
        replyUpdates: 1,
      });
      expect(scoreOf("1")?.replyCount).toBe(1);
    });

    it("leaves an old deleted message to the full pass", async () => {
      addMessages(dbFile, [
        { id: "1", at: OLD },
        { id: "2", at: OLD + 60 },
      ]);
      await run({ mode: "full" });
      changeArchive(dbFile, "UPDATE messages_archive SET is_deleted = 1 WHERE message_id = '1'");

      expect(await run({ nowS: NOW + 900 })).toMatchObject({ removed: 0 });
      expect(await run({ mode: "full", nowS: NOW + 1800 })).toMatchObject({ removed: 1 });
      expect(scoredIds()).toEqual(["2"]);
      expect(weeks()).toEqual([[weekStartOf(OLD), 1]]);
    });
  });

  describe("the full pass", () => {
    it("goes over the whole channel in slices", async () => {
      addMessages(dbFile, [
        { id: "1", at: NOW - 100 * DAY },
        { id: "2", at: NOW - 50 * DAY },
        { id: "3", at: T },
      ]);
      const result = await run({ mode: "full" });
      expect(result).toMatchObject({ mode: "full", scored: 3, weeksBuilt: 3, total: 3 });
      expect(weeks()).toHaveLength(3);
      expect(store.getMeta("last_full_s")).toBe(String(NOW));
    });

    it("measures the 95th percentile of the replies and rescales resonance", async () => {
      addMessages(dbFile, [
        { id: "1", at: T },
        { id: "2", at: T + 1, replyTo: "1" },
        { id: "3", at: T + 2, replyTo: "1" },
        { id: "4", at: T + 3, replyTo: "2" },
      ]);
      // A window run first: resonance against the starting value of 5.
      await run();
      expect(scoreOf("1")?.resonance).toBeCloseTo(Math.log(3) / Math.log(6), 12);

      const result = await run({ mode: "full", nowS: NOW + 900 });
      // Two messages have replies, with 1 and 2: position floor(2 * 0.95) = 1 is the 2.
      expect(result.replyP95).toBe(2);
      expect(store.getMeta("reply_p95")).toBe("2");
      expect(scoreOf("1")?.resonance).toBe(1);
      expect(scoreOf("2")?.resonance).toBeCloseTo(Math.log(2) / Math.log(3), 12);

      // The next window run measures new replies against the new value.
      addMessages(dbFile, [{ id: "5", at: T + 4, replyTo: "4" }]);
      expect(await run({ nowS: NOW + 1800 })).toMatchObject({ replyP95: 2, replyUpdates: 1 });
      expect(scoreOf("4")?.resonance).toBeCloseTo(Math.log(2) / Math.log(3), 12);
    });

    it("is not counted as done while messages wait for a score", async () => {
      addMessages(dbFile, [
        { id: "1", at: T },
        { id: "2", at: T + 1 },
        { id: "3", at: T + 2 },
      ]);
      expect(await run({ mode: "auto", maxMessages: 2 })).toMatchObject({
        mode: "full",
        pending: 1,
      });
      expect(store.getMeta("last_full_s")).toBeNull();

      expect(await run({ mode: "auto", maxMessages: 2, nowS: NOW + 900 })).toMatchObject({
        mode: "full",
        scored: 1,
        pending: 0,
      });
      expect(store.getMeta("last_full_s")).toBe(String(NOW + 900));
    });

    it("runs by itself once a day", async () => {
      addMessages(dbFile, [{ id: "1", at: T }]);
      expect((await run({ mode: "auto" })).mode).toBe("full");
      expect((await run({ mode: "auto", nowS: NOW + 900 })).mode).toBe("window");
      // 2024-01-11 09:00 UTC
      const nextNine = NOW + 21 * 3600;
      expect((await run({ mode: "auto", nowS: nextNine - 1 })).mode).toBe("window");
      expect((await run({ mode: "auto", nowS: nextNine })).mode).toBe("full");
      expect((await run({ mode: "auto", nowS: nextNine + 900 })).mode).toBe("window");
    });

    it("looks at scores that are older than the first message left in the archive", async () => {
      addMessages(dbFile, [
        { id: "1", at: NOW - 100 * DAY },
        { id: "2", at: T },
      ]);
      await run({ mode: "full" });
      changeArchive(dbFile, "DELETE FROM messages_archive WHERE message_id = '1'");

      expect(await run({ mode: "full", nowS: NOW + 900 })).toMatchObject({ removed: 1, total: 1 });
      expect(weeks()).toEqual([[weekStartOf(T), 1]]);
    });
  });

  describe("a part of the channel", () => {
    const A = NOW - 60 * DAY;
    const B = NOW - 40 * DAY;

    beforeEach(() => {
      addMessages(dbFile, [
        { id: "1", at: A },
        { id: "2", at: A + 60, replyTo: "1" },
        { id: "3", at: B },
        { id: "4", at: T },
      ]);
    });

    it("scores the range it was given and no more", async () => {
      const result = await run({ mode: "range", fromS: A, toS: B, finalize: false });
      expect(result).toMatchObject({ mode: "range", scored: 2, replyUpdates: 0, weeksBuilt: 0 });
      expect(scoredIds()).toEqual(["1", "2"]);
    });

    it("leaves replies and weeks for later when told not to finalize", async () => {
      await run({ mode: "range", fromS: A, toS: B, finalize: false });
      expect(scoreOf("1")?.replyCount).toBe(0);
      expect(weeks()).toEqual([]);
      expect(store.getMeta("dirty_weeks")).toBe(String(weekStartOf(A)));
      expect(store.getMeta("last_full_s")).toBeNull();

      // The pass after it does what was left.
      const result = await run({ mode: "full", nowS: NOW + 900 });
      expect(result).toMatchObject({ scored: 2, replyUpdates: 1, weeksBuilt: 3 });
      expect(scoreOf("1")?.replyCount).toBe(1);
      expect(weeks().map(([start]) => start)).toEqual(
        [weekStartOf(A), weekStartOf(B), weekStartOf(T)].sort((a, b) => a - b)
      );
    });

    it("finalizes over the whole channel when asked for a range only", async () => {
      const result = await run({ mode: "range", fromS: A, toS: B });
      expect(result).toMatchObject({ scored: 2, replyUpdates: 1, weeksBuilt: 1 });
      expect(weeks()).toEqual([[weekStartOf(A), 2]]);
      // Only a full pass counts as one.
      expect(store.getMeta("last_full_s")).toBeNull();
    });

    it("takes an open end as now", async () => {
      expect(await run({ mode: "range", fromS: B })).toMatchObject({ scored: 2 });
      expect(scoredIds()).toEqual(["3", "4"]);
    });

    it("builds the weeks of scores that were put into the file from elsewhere", async () => {
      // What a merged history looks like: scores, but no week rows and no list of work.
      await run({ mode: "range", fromS: A, toS: NOW, finalize: false });
      store.setMeta("dirty_weeks", "");

      const result = await run({ mode: "full", nowS: NOW + 900 });
      expect(result).toMatchObject({ scored: 0, weeksBuilt: 3 });
      expect(weeks()).toHaveLength(3);
      expect(WEEK_S).toBe(7 * DAY);
    });
  });

  it("rebuilds the weeks a run left behind when it died", async () => {
    addMessages(dbFile, [{ id: "1", at: T }]);
    await run();
    // As if a run had changed the week and stopped before it rebuilt the row.
    store.setMeta("dirty_weeks", String(weekStartOf(T)));
    store.deleteWeek(weekStartOf(T));

    expect(await run({ nowS: NOW + 900 })).toMatchObject({ scored: 0, weeksBuilt: 1 });
    expect(weeks()).toEqual([[weekStartOf(T), 1]]);
    expect(store.getMeta("dirty_weeks")).toBe("");
  });
});
