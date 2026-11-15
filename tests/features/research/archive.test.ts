/**
 * Pawtropolis Tech -- tests/features/research/archive.test.ts
 * WHAT: Tests for the reader of one channel in messages_archive.
 * WHY: Every score starts from what this reader hands over: which messages
 *      count, in which order they came, and what stood before each of them.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Archive, byTimeThenId } from "../../../src/features/research/archive.js";
import { CHANNEL, GUILD, addMessages, changeArchive, createArchiveDb } from "./helpers.js";

let dir: string;
let file: string;
let archive: Archive | undefined;

function open(channel = CHANNEL): Archive {
  archive = new Archive(file, GUILD, channel);
  return archive;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-archive-"));
  file = path.join(dir, "data.db");
  createArchiveDb(file);
});

afterEach(() => {
  archive?.close();
  archive = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("byTimeThenId", () => {
  it("orders by time, then by the number in the id", () => {
    const sorted = [
      { createdAtS: 20, messageId: "5" },
      { createdAtS: 10, messageId: "100" },
      { createdAtS: 10, messageId: "99" },
      { createdAtS: 10, messageId: "101" },
    ].sort(byTimeThenId);
    expect(sorted.map((m) => m.messageId)).toEqual(["99", "100", "101", "5"]);
    expect(byTimeThenId(sorted[0]!, sorted[0]!)).toBe(0);
  });
});

describe("Archive", () => {
  it("refuses a database file that does not exist", () => {
    expect(() => new Archive(path.join(dir, "missing.db"), GUILD)).toThrow();
  });

  it("cannot write to the bot's database", () => {
    const reader = open() as unknown as { db: { prepare(sql: string): { run(): void } } };
    expect(() => reader.db.prepare("DELETE FROM messages_archive").run()).toThrow(/readonly/);
  });

  it("finds the general channel of the guild", () => {
    expect(open("").generalChannel()).toBe(CHANNEL);
  });

  it("has no general channel for a guild without config, or without the table", () => {
    archive = new Archive(file, "another-guild");
    expect(archive.generalChannel()).toBeNull();
    archive.close();
    changeArchive(file, "DROP TABLE guild_config");
    expect(open("").generalChannel()).toBeNull();
  });

  it("reads the rows of its own channel and guild only", () => {
    addMessages(file, [
      { id: "1", at: 100 },
      { id: "2", at: 101, channel: "another-channel" },
      { id: "3", at: 102, guild: "another-guild" },
    ]);
    expect(
      open()
        .rows(0, 1000)
        .map((r) => r.messageId)
    ).toEqual(["1"]);
    archive?.useChannel("another-channel");
    expect(archive?.rows(0, 1000).map((r) => r.messageId)).toEqual(["2"]);
  });

  it("reports what the bookkeeping needs, deleted rows included", () => {
    addMessages(file, [
      { id: "1", at: 100, author: "a", replyTo: "0" },
      { id: "2", at: 101, bot: true },
      { id: "3", at: 102, deleted: true },
      { id: "4", at: 103, content: "", attachment: true },
      { id: "5", at: 104, editedAt: 500 },
    ]);
    expect(open().rows(100, 105)).toEqual([
      {
        messageId: "1",
        authorId: "a",
        createdAtS: 100,
        isBot: false,
        isDeleted: false,
        hasText: true,
        contentRev: 0,
        replyToId: "0",
      },
      expect.objectContaining({ messageId: "2", isBot: true }),
      expect.objectContaining({ messageId: "3", isDeleted: true }),
      expect.objectContaining({ messageId: "4", hasText: false }),
      expect.objectContaining({ messageId: "5", contentRev: 500 }),
    ]);
  });

  it("includes the start of a range and leaves out its end", () => {
    addMessages(file, [
      { id: "1", at: 99 },
      { id: "2", at: 100 },
      { id: "3", at: 199 },
      { id: "4", at: 200 },
    ]);
    expect(
      open()
        .rows(100, 200)
        .map((r) => r.messageId)
    ).toEqual(["2", "3"]);
    expect(archive?.texts(100, 200).map((r) => r.messageId)).toEqual(["2", "3"]);
  });

  it("returns texts without the deleted messages, with what was attached", () => {
    addMessages(file, [
      { id: "1", at: 100, content: "hello there", attachment: true },
      { id: "2", at: 101, content: "gone", deleted: true },
      { id: "3", at: 102, content: "", embed: true, bot: true },
    ]);
    expect(open().texts(0, 1000)).toEqual([
      {
        messageId: "1",
        authorId: "author-1",
        createdAtS: 100,
        isBot: false,
        content: "hello there",
        hasAttachment: true,
        hasEmbed: false,
        contentRev: 0,
        replyToId: null,
      },
      expect.objectContaining({ messageId: "3", content: "", hasEmbed: true, isBot: true }),
    ]);
  });

  it("orders messages of one second by id", () => {
    addMessages(file, [
      { id: "1000", at: 100 },
      { id: "999", at: 100 },
      { id: "1001", at: 100 },
    ]);
    expect(
      open()
        .texts(0, 1000)
        .map((r) => r.messageId)
    ).toEqual(["999", "1000", "1001"]);
  });

  it("returns the last messages before a second, oldest first", () => {
    addMessages(file, [
      { id: "1", at: 100 },
      { id: "2", at: 101 },
      { id: "3", at: 102, deleted: true },
      { id: "4", at: 103 },
      { id: "5", at: 104 },
      { id: "6", at: 105 },
    ]);
    const reader = open();
    expect(reader.lastBefore(105, 3).map((r) => r.messageId)).toEqual(["2", "4", "5"]);
    expect(reader.lastBefore(101, 3).map((r) => r.messageId)).toEqual(["1"]);
    expect(reader.lastBefore(100, 3)).toEqual([]);
  });

  it("picks the last ones by id when many share the last second", () => {
    addMessages(
      file,
      Array.from({ length: 10 }, (_, i) => ({ id: String(990 + i * 3), at: 100 }))
    );
    // ids 990, 993, ... 1017: the three highest numbers are the latest
    expect(
      open()
        .lastBefore(101, 3)
        .map((r) => r.messageId)
    ).toEqual(["1011", "1014", "1017"]);
  });

  it("counts the replies that are not deleted", () => {
    addMessages(file, [
      { id: "1", at: 100 },
      { id: "2", at: 101, replyTo: "1" },
      { id: "3", at: 102, replyTo: "1", bot: true },
      { id: "4", at: 103, replyTo: "1", deleted: true },
      { id: "5", at: 104, replyTo: "2" },
      { id: "6", at: 105, replyTo: "1", channel: "another-channel" },
    ]);
    expect(open().replyCounts()).toEqual(
      new Map([
        ["1", 2],
        ["2", 1],
      ])
    );
  });

  it("knows when the channel began", () => {
    expect(open().firstMessageAt()).toBeNull();
    addMessages(file, [
      { id: "2", at: 500 },
      { id: "1", at: 300 },
      { id: "3", at: 100, channel: "another-channel" },
    ]);
    expect(archive?.firstMessageAt()).toBe(300);
  });
});
