// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/handbook.bookmarks.test.ts
 * WHAT: Coverage for the pure handbook bookmark list logic.
 * WHY: Bookmarks round-trip through localStorage, a JSON API body, and a
 *      SQLite table, so every one of those hops can hand this module a
 *      malformed or duplicated row. The store persists whatever this returns,
 *      so a throw here would wipe a mod's saved sections. Lock the tolerance
 *      rules, the dedupe, and the cap direction.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_BOOKMARKS,
  addBookmark,
  bookmarkId,
  hasBookmark,
  mergeBookmarks,
  normalizeBookmarks,
  parseBookmarks,
  removeBookmark,
  serializeBookmarks,
  type HandbookBookmark,
} from "../../web/src/lib/handbook-bookmarks.js";

function bm(
  docSlug: string,
  headingSlug: string,
  addedAt = 1000
): HandbookBookmark {
  return {
    docSlug,
    headingSlug,
    label: headingSlug,
    docTitle: docSlug,
    addedAt,
  };
}

describe("bookmarkId", () => {
  it("joins doc and heading with the anchor separator used in hrefs", () => {
    expect(bookmarkId("mod-handbook", "warn-a-user")).toBe("mod-handbook#warn-a-user");
  });
});

describe("parseBookmarks", () => {
  it("REGRESSION: returns an empty list instead of throwing on unusable input", () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks("")).toEqual([]);
    expect(parseBookmarks("{not json")).toEqual([]);
    expect(parseBookmarks("42")).toEqual([]);
  });

  it("reads the versioned envelope written by serializeBookmarks", () => {
    const items = [bm("mod-handbook", "warn-a-user")];
    expect(parseBookmarks(serializeBookmarks(items))).toEqual(items);
  });

  it("also accepts a bare array so an older cache still loads", () => {
    const raw = JSON.stringify([bm("mod-handbook", "warn-a-user")]);
    expect(parseBookmarks(raw)).toHaveLength(1);
  });

  it("REGRESSION: drops rows missing a doc or heading slug and keeps the rest", () => {
    const raw = JSON.stringify({
      v: 1,
      items: [
        { docSlug: "mod-handbook" },
        { headingSlug: "warn-a-user" },
        null,
        "nope",
        bm("mod-handbook", "warn-a-user"),
      ],
    });
    const out = parseBookmarks(raw);
    expect(out).toHaveLength(1);
    expect(out[0].headingSlug).toBe("warn-a-user");
  });

  it("backfills a missing label and title rather than discarding the row", () => {
    const raw = JSON.stringify([{ docSlug: "mod-handbook", headingSlug: "warn-a-user" }]);
    const out = parseBookmarks(raw);
    expect(out[0].label).toBe("warn-a-user");
    expect(out[0].docTitle).toBe("mod-handbook");
    expect(out[0].addedAt).toBe(0);
  });
});

describe("normalizeBookmarks", () => {
  it("REGRESSION: collapses duplicate ids so a double click cannot double-list", () => {
    const out = normalizeBookmarks([
      bm("mod-handbook", "warn-a-user", 10),
      bm("mod-handbook", "warn-a-user", 20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].addedAt).toBe(10);
  });

  it("keeps the same heading slug across different docs", () => {
    const out = normalizeBookmarks([
      bm("mod-handbook", "overview"),
      bm("admin-guide", "overview"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("sorts oldest first so the saved order stays stable across reloads", () => {
    const out = normalizeBookmarks([bm("a", "x", 30), bm("b", "y", 10), bm("c", "z", 20)]);
    expect(out.map((b) => b.docSlug)).toEqual(["b", "c", "a"]);
  });

  it("REGRESSION: caps by dropping the oldest, so a new star at the limit sticks", () => {
    const many = Array.from({ length: MAX_BOOKMARKS + 5 }, (_, i) => bm("d", `h${i}`, i));
    const out = normalizeBookmarks(many);
    expect(out).toHaveLength(MAX_BOOKMARKS);
    expect(out[out.length - 1].headingSlug).toBe(`h${MAX_BOOKMARKS + 4}`);
    expect(out[0].headingSlug).toBe("h5");
  });
});

describe("addBookmark / removeBookmark / hasBookmark", () => {
  it("adds once and stays idempotent", () => {
    const first = addBookmark([], bm("mod-handbook", "warn-a-user"));
    const second = addBookmark(first, bm("mod-handbook", "warn-a-user", 9999));
    expect(second).toHaveLength(1);
    expect(second[0].addedAt).toBe(1000);
  });

  it("removes by id and leaves adjacent entries alone", () => {
    const items = [bm("mod-handbook", "warn-a-user", 1), bm("mod-handbook", "mute-a-user", 2)];
    const out = removeBookmark(items, bookmarkId("mod-handbook", "warn-a-user"));
    expect(out).toHaveLength(1);
    expect(out[0].headingSlug).toBe("mute-a-user");
  });

  it("removing an id that was never saved is a no-op", () => {
    const items = [bm("mod-handbook", "warn-a-user")];
    expect(removeBookmark(items, "admin-guide#nope")).toEqual(items);
  });

  it("hasBookmark answers on the composite id, not the heading alone", () => {
    const items = [bm("mod-handbook", "overview")];
    expect(hasBookmark(items, "mod-handbook#overview")).toBe(true);
    expect(hasBookmark(items, "admin-guide#overview")).toBe(false);
  });
});

describe("mergeBookmarks", () => {
  it("REGRESSION: unions both sides so first sign-in cannot drop local saves", () => {
    const local = [bm("mod-handbook", "warn-a-user", 5)];
    const server = [bm("admin-guide", "escalation", 7)];
    const out = mergeBookmarks(local, server);
    expect(out.map((b) => bookmarkId(b.docSlug, b.headingSlug))).toEqual([
      "mod-handbook#warn-a-user",
      "admin-guide#escalation",
    ]);
  });

  it("keeps the earlier timestamp for an entry present on both sides", () => {
    const out = mergeBookmarks([bm("d", "h", 50)], [bm("d", "h", 10)]);
    expect(out).toHaveLength(1);
    expect(out[0].addedAt).toBe(10);
  });
});
