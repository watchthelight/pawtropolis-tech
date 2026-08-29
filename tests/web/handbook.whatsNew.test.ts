// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/handbook.whatsNew.test.ts
 * WHAT: Marker parsing and the seven-day expiry behind the handbook "New" highlight.
 * WHY: The whole point of the marker is that it expires by itself, so nobody has to
 *      remember to remove it. If the window maths is wrong the badge either sticks
 *      forever or never appears, and both failures are silent.
 */

import { describe, expect, it } from "vitest";

import {
  NEW_WINDOW_DAYS,
  isWithinNewWindow,
  parseNewMarker,
} from "../../web/src/lib/handbook-shared.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-29T12:00:00Z");

describe("parseNewMarker", () => {
  it("reads the date out of a well-formed marker", () => {
    expect(parseNewMarker("<!-- new: 2026-08-29 -->")).toBe("2026-08-29");
  });

  it("tolerates the spacing and casing people actually type", () => {
    expect(parseNewMarker("<!--new:2026-08-29-->")).toBe("2026-08-29");
    expect(parseNewMarker("<!--   NEW:   2026-08-29   -->")).toBe("2026-08-29");
    expect(parseNewMarker("  <!-- new: 2026-08-29 -->  ")).toBe("2026-08-29");
  });

  it("ignores comments that are not markers", () => {
    expect(parseNewMarker("<!-- TODO: rewrite this section -->")).toBeNull();
    expect(parseNewMarker("<!-- new -->")).toBeNull();
    expect(parseNewMarker("<!-- newer: 2026-08-29 -->")).toBeNull();
    expect(parseNewMarker("")).toBeNull();
  });

  it("REGRESSION: rejects a malformed date rather than flagging the section forever", () => {
    expect(parseNewMarker("<!-- new: 2026-13-45 -->")).toBeNull();
    expect(parseNewMarker("<!-- new: yesterday -->")).toBeNull();
    expect(parseNewMarker("<!-- new: 26-08-29 -->")).toBeNull();
  });

  it("does not match a marker with trailing content on the same line", () => {
    expect(parseNewMarker("<!-- new: 2026-08-29 --> and more")).toBeNull();
  });
});

describe("isWithinNewWindow", () => {
  it("flags a section marked today", () => {
    expect(isWithinNewWindow("2026-08-29", NOW)).toBe(true);
  });

  it("stays flagged through the last day of the window", () => {
    const sixDaysAgo = new Date(NOW - 6 * DAY).toISOString().slice(0, 10);
    expect(isWithinNewWindow(sixDaysAgo, NOW)).toBe(true);
  });

  it("REGRESSION: expires on its own once the window passes", () => {
    const longAgo = new Date(NOW - (NEW_WINDOW_DAYS + 1) * DAY).toISOString().slice(0, 10);
    expect(isWithinNewWindow(longAgo, NOW)).toBe(false);
  });

  it("REGRESSION: an old marker left in the file forever never re-flags", () => {
    expect(isWithinNewWindow("2020-01-01", NOW)).toBe(false);
  });

  it("treats a future date as new, so a marker can be staged ahead of an announcement", () => {
    expect(isWithinNewWindow("2026-09-15", NOW)).toBe(true);
  });

  it("returns false for a missing or unparseable date", () => {
    expect(isWithinNewWindow(null, NOW)).toBe(false);
    expect(isWithinNewWindow("", NOW)).toBe(false);
    expect(isWithinNewWindow("not-a-date", NOW)).toBe(false);
  });

  it("REGRESSION: expiry follows the clock, not the build, so an old deploy still ages out", () => {
    const marked = "2026-08-29";
    expect(isWithinNewWindow(marked, Date.parse("2026-08-30T00:00:00Z"))).toBe(true);
    expect(isWithinNewWindow(marked, Date.parse("2026-09-30T00:00:00Z"))).toBe(false);
  });
});

/**
 * The decorator takes a marked token array. `marked` is a web-only dependency and the
 * root test run cannot resolve it, and decorator.ts imports it for types only, so the
 * tokens are built by hand here in the exact shape marked emits for a command section.
 */
function sectionTokens(command: string, marker: string | null) {
  const tokens: unknown[] = [
    { type: "heading", depth: 3, text: `\`/${command}\``, raw: `### \`/${command}\`
` },
  ];
  if (marker !== null) {
    tokens.push({ type: "html", raw: marker, text: marker, block: true, pre: false });
  }
  tokens.push({
    type: "paragraph",
    raw: "**Who can use it:** Everyone",
    text: "**Who can use it:** Everyone",
  });
  tokens.push({ type: "paragraph", raw: "Body.", text: "Body." });
  return tokens;
}

const META = {
  slug: "bot-handbook",
  title: "Bot Handbook",
  defaultTier: "public",
  tagline: "",
  source: "",
};

async function decorateSection(command: string, marker: string | null) {
  const { decorate, resetSlugCounter } = await import(
    "../../web/src/lib/server/handbook/decorator.js"
  );
  resetSlugCounter();
  const doc = decorate(sectionTokens(command, marker) as never, META as never, "owner", false);
  const section = doc.tokens.find(
    (t) => (t as { type: string }).type === "command_section"
  ) as unknown as { isNew: boolean; newSince: string | null };
  return { doc, section };
}

describe("decorator wiring", () => {
  it("flags a section whose body opens with a fresh marker", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { doc, section } = await decorateSection("stash", `<!-- new: ${today} -->`);

    expect(section.newSince).toBe(today);
    expect(section.isNew).toBe(true);
    expect(doc.tocEntries[0]!.newSince).toBe(today);
  });

  it("REGRESSION: an expired marker leaves the section unflagged", async () => {
    const { section } = await decorateSection("old", "<!-- new: 2020-01-01 -->");
    expect(section.newSince).toBe("2020-01-01");
    expect(section.isNew).toBe(false);
  });

  it("REGRESSION: an unrelated html comment does not flag the section", async () => {
    const { section } = await decorateSection("thing", "<!-- TODO: rewrite -->");
    expect(section.newSince).toBeNull();
    expect(section.isNew).toBe(false);
  });

  it("leaves an unmarked section alone", async () => {
    const { section } = await decorateSection("plain", null);
    expect(section.newSince).toBeNull();
    expect(section.isNew).toBe(false);
  });

  it("still resolves the permission line when a marker sits above it", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { doc } = await decorateSection("stash", `<!-- new: ${today} -->`);
    const section = doc.tokens.find(
      (t) => (t as { type: string }).type === "command_section"
    ) as unknown as { requiredTier: string };
    expect(section.requiredTier).toBe("public");
  });
});
