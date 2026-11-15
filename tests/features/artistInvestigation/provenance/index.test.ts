// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/provenance/index.test.ts
 * WHAT: How lookups are planned, cached, limited and merged across services,
 *       and how each match is labeled against the applicant.
 * WHY: A dead site, a missing key or a spent quota must stay inside its own
 *      service and be named in the report. Duplicate sources must collapse to
 *      one entry, and a repeat run must not spend the services' rate limits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { LIMITS } from "../../../../src/features/artistInvestigation/config.js";
import {
  pruneCache,
  readCache,
  writeCache,
} from "../../../../src/features/artistInvestigation/provenance/cache.js";
import {
  annotateMatch,
  baseHints,
  runProvenance,
  type ProvenanceContext,
} from "../../../../src/features/artistInvestigation/provenance/index.js";
import {
  LookupError,
  type LookupService,
} from "../../../../src/features/artistInvestigation/provenance/shared.js";
import type {
  ProvenanceServiceName,
  RawMatch,
} from "../../../../src/features/artistInvestigation/types.js";
import { T0, memoryDb, preparedImage, rawMatch, settings } from "../fixtures.js";

type Search = LookupService["search"];

const DAY_MS = 86_400_000;
const ACCOUNT_CREATED = Date.UTC(2023, 0, 15);

function service(
  name: ProvenanceServiceName,
  search: Search = async () => [],
  overrides: Partial<LookupService> = {}
) {
  return {
    name,
    gapMs: 0,
    mirrored: false,
    unavailableReason: () => null,
    ...overrides,
    search: vi.fn(search),
  };
}

/** A search that answers each call with the next outcome in the list. */
function scripted(...outcomes: Array<RawMatch[] | Error>): Search {
  return async () => {
    const next = outcomes.shift();
    if (next === undefined) throw new Error("unexpected extra lookup");
    if (next instanceof Error) throw next;
    return next;
  };
}

function clock(start = T0) {
  let nowMs = start;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const context = (overrides: Partial<ProvenanceContext> = {}): ProvenanceContext => ({
  settings: settings(),
  handles: [{ platform: "furaffinity", handle: "FoxyArtz", origin: "link", url: null }],
  accountCreatedAtMs: ACCOUNT_CREATED,
  ...overrides,
});

const source = (n: number) => `https://www.furaffinity.net/view/${n}/`;
const webPage = (n: number) => `https://pages.example.com/${n}`;

/** A match the way the Google adapter builds one: a page, no names, no score. */
const googleMatch = (sourceUrl: string) =>
  rawMatch({
    service: "google",
    sourceUrl,
    platform: "pages.example.com",
    uploader: null,
    artists: [],
    similarity: null,
  });

describe("runProvenance", () => {
  let db: ReturnType<typeof memoryDb>;
  let time: ReturnType<typeof clock>;

  const run = (images: string[], services: LookupService[], ctx = context()) =>
    runProvenance(
      images.map((key) => preparedImage(key)),
      ctx,
      { db, services, now: time.now, sleep: time.sleep }
    );

  beforeEach(() => {
    db = memoryDb();
    time = clock();
  });
  afterEach(() => {
    db.close();
  });

  it("names a service without a key as skipped and never calls it", async () => {
    const active = service("fluffle", async () => [rawMatch()]);
    const skipped = service("saucenao", undefined, {
      unavailableReason: () => "SAUCENAO_API_KEY is not set",
    });

    const result = await run(["img1"], [active, skipped]);

    expect(skipped.search).not.toHaveBeenCalled();
    expect(result.services).toEqual([
      { service: "fluffle", status: "ok", detail: null, queries: 1, cacheHits: 0, matches: 1 },
      {
        service: "saucenao",
        status: "skipped",
        detail: "SAUCENAO_API_KEY is not set",
        queries: 0,
        cacheHits: 0,
        matches: 0,
      },
    ]);
  });

  it("does nothing when there are no images", async () => {
    const fluffle = service("fluffle");
    const result = await run([], [fluffle]);

    expect(fluffle.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      matches: [],
      services: [
        { service: "fluffle", status: "ok", detail: null, queries: 0, cacheHits: 0, matches: 0 },
      ],
      omitted: 0,
    });
  });

  it("sends the downscaled lookup copy, and the mirrored copy only to services that take one", async () => {
    const sent: Record<string, string[]> = { fluffle: [], saucenao: [] };
    const record =
      (name: string): Search =>
      async (image) => {
        sent[name]?.push(`${image.bytes.toString()} ${image.mediaType}`);
        return [];
      };

    await run(
      ["img1", "img2"],
      [
        service("fluffle", record("fluffle"), { mirrored: true }),
        service("saucenao", record("saucenao")),
      ]
    );

    // Every original goes first, so a short time budget is spent on the plain searches.
    expect(sent.fluffle).toEqual([
      "lookup-img1 image/jpeg",
      "lookup-img2 image/jpeg",
      "mirrored-img1 image/jpeg",
      "mirrored-img2 image/jpeg",
    ]);
    expect(sent.saucenao).toEqual(["lookup-img1 image/jpeg", "lookup-img2 image/jpeg"]);
  });

  describe("cache", () => {
    it("answers a repeat run from the cache without calling the service", async () => {
      const fluffle = service("fluffle", async () => [rawMatch()], { mirrored: true });

      const first = await run(["img1"], [fluffle]);
      time.advance(3 * DAY_MS);
      const second = await run(["img1"], [fluffle]);

      expect(fluffle.search).toHaveBeenCalledTimes(2);
      expect(first.services[0]).toMatchObject({
        status: "ok",
        queries: 2,
        cacheHits: 0,
        matches: 1,
      });
      expect(second.services[0]).toMatchObject({
        status: "ok",
        queries: 0,
        cacheHits: 2,
        matches: 1,
      });
      expect(second.matches).toEqual(first.matches);
    });

    it("remembers that a search found nothing", async () => {
      const fluffle = service("fluffle");

      await run(["img1"], [fluffle]);
      const second = await run(["img1"], [fluffle]);

      expect(fluffle.search).toHaveBeenCalledTimes(1);
      expect(second.services[0]).toMatchObject({ queries: 0, cacheHits: 1, matches: 0 });
    });

    it("goes by the file's hash, so the same file under another label is a cache hit", async () => {
      const fluffle = service("fluffle", async () => [rawMatch()]);
      const deps = { db, services: [fluffle], now: time.now, sleep: time.sleep };

      await runProvenance([preparedImage("img1", { sha256: "same-file" })], context(), deps);
      const second = await runProvenance(
        [preparedImage("img4", { sha256: "same-file" })],
        context(),
        deps
      );

      expect(fluffle.search).toHaveBeenCalledTimes(1);
      expect(second.matches).toEqual([expect.objectContaining({ imageKey: "img4" })]);
    });

    it("keeps each service's answers apart", async () => {
      const fluffle = service("fluffle", async () => [rawMatch()]);
      const sauce = service("saucenao", async () => [
        rawMatch({ service: "saucenao", sourceUrl: source(2) }),
      ]);

      await run(["img1"], [fluffle]);
      const second = await run(["img1"], [fluffle, sauce]);

      expect(sauce.search).toHaveBeenCalledTimes(1);
      expect(second.services).toEqual([
        expect.objectContaining({ service: "fluffle", queries: 0, cacheHits: 1 }),
        expect.objectContaining({ service: "saucenao", queries: 1, cacheHits: 0 }),
      ]);
    });

    it("looks an image up again once the cached answer is over a week old", async () => {
      const fluffle = service("fluffle", async () => [rawMatch()]);

      await run(["img1"], [fluffle]);
      time.advance(LIMITS.cacheTtlSeconds * 1000);
      await run(["img1"], [fluffle]);
      expect(fluffle.search).toHaveBeenCalledTimes(1);

      time.advance(1000);
      const third = await run(["img1"], [fluffle]);
      expect(fluffle.search).toHaveBeenCalledTimes(2);
      expect(third.services[0]).toMatchObject({ queries: 1, cacheHits: 0 });
    });

    it("does not cache a failed lookup", async () => {
      const fluffle = service(
        "fluffle",
        scripted(new LookupError("rate limit reached (HTTP 429)", true), [rawMatch()])
      );

      const first = await run(["img1"], [fluffle]);
      const second = await run(["img1"], [fluffle]);

      expect(first.services[0]).toMatchObject({ status: "failed", matches: 0 });
      expect(second.services[0]).toMatchObject({
        status: "ok",
        queries: 1,
        cacheHits: 0,
        matches: 1,
      });
    });
  });

  describe("failures", () => {
    it("reports a service that failed part of the way as partial and keeps what it found", async () => {
      const fluffle = service(
        "fluffle",
        scripted([rawMatch()], new LookupError("service error (HTTP 500)"))
      );

      const result = await run(["img1", "img2"], [fluffle]);

      expect(result.services).toEqual([
        {
          service: "fluffle",
          status: "partial",
          detail: "1 of 2 lookups finished: service error (HTTP 500)",
          queries: 1,
          cacheHits: 0,
          matches: 1,
        },
      ]);
      expect(result.matches).toEqual([expect.objectContaining({ imageKey: "img1" })]);
    });

    it("gives up on a service after two failures in a row", async () => {
      const fluffle = service(
        "fluffle",
        scripted(new LookupError("network error"), new LookupError("network error"))
      );

      const result = await run(["img1", "img2", "img3", "img4"], [fluffle]);

      expect(fluffle.search).toHaveBeenCalledTimes(2);
      expect(result.services[0]).toMatchObject({
        status: "failed",
        detail: "0 of 4 lookups finished: network error",
        queries: 0,
      });
    });

    it("carries on after a single failure", async () => {
      const fluffle = service(
        "fluffle",
        scripted(
          new LookupError("request timed out"),
          [rawMatch({ sourceUrl: source(1) })],
          new LookupError("request timed out"),
          [rawMatch({ sourceUrl: source(2) })]
        )
      );

      const result = await run(["img1", "img2", "img3", "img4"], [fluffle]);

      expect(fluffle.search).toHaveBeenCalledTimes(4);
      expect(result.services[0]).toMatchObject({
        status: "partial",
        detail: "2 of 4 lookups finished: request timed out",
        queries: 2,
        matches: 2,
      });
      expect(result.matches.map((m) => m.imageKey).sort()).toEqual(["img2", "img4"]);
    });

    it("stops a service at once on a rejected key or a spent quota", async () => {
      const refused = service(
        "saucenao",
        scripted(new LookupError("rate limit reached (HTTP 429)", true))
      );
      const lateRefusal = service(
        "e621",
        scripted(
          [rawMatch({ service: "e621", sourceUrl: "https://e621.net/posts/5" })],
          new LookupError("credentials were rejected (HTTP 401)", true)
        )
      );

      const result = await run(["img1", "img2", "img3"], [refused, lateRefusal]);

      expect(refused.search).toHaveBeenCalledTimes(1);
      expect(lateRefusal.search).toHaveBeenCalledTimes(2);
      expect(result.services).toEqual([
        expect.objectContaining({
          service: "saucenao",
          status: "failed",
          detail: "0 of 3 lookups finished: rate limit reached (HTTP 429)",
        }),
        expect.objectContaining({
          service: "e621",
          status: "partial",
          detail: "1 of 3 lookups finished: credentials were rejected (HTTP 401)",
          matches: 1,
        }),
      ]);
    });

    it("hides the text of an error it did not expect", async () => {
      const boom = () =>
        new TypeError("cannot read https://saucenao.com/search.php?api_key=sauce-secret");
      const sauce = service("saucenao", scripted(boom(), boom()));

      const result = await run(["img1", "img2"], [sauce]);

      expect(result.services[0]).toMatchObject({
        status: "failed",
        detail: "0 of 2 lookups finished: unexpected error",
      });
      expect(JSON.stringify(result)).not.toContain("sauce-secret");
    });

    it("stops a slow service when the time budget runs out", async () => {
      const slow = service(
        "saucenao",
        async (_image, lookup) => {
          await lookup.pace();
          return [];
        },
        { gapMs: LIMITS.provenanceBudgetMs * 0.6 }
      );

      const result = await run(["img1", "img2", "img3"], [slow]);

      // The third request's slot falls past the deadline, so it is never sent.
      expect(slow.search).toHaveBeenCalledTimes(3);
      expect(result.services[0]).toMatchObject({
        status: "partial",
        detail: "2 of 3 lookups finished: ran out of time",
        queries: 2,
      });
      expect(time.now() - T0).toBe(LIMITS.provenanceBudgetMs * 0.6);
    });

    it("keeps the other services' results when one service is down", async () => {
      const up = service("fluffle", async () => [rawMatch()]);
      const down = service(
        "e621",
        scripted(
          new LookupError("service error (HTTP 503)"),
          new LookupError("service error (HTTP 503)")
        )
      );
      const alsoUp = service("saucenao", async () => [
        rawMatch({ service: "saucenao", sourceUrl: "https://www.deviantart.com/foxyartz/art/A-1" }),
      ]);

      const result = await run(["img1", "img2"], [up, down, alsoUp]);

      expect(result.services.map((s) => [s.service, s.status, s.matches])).toEqual([
        ["fluffle", "ok", 2],
        ["e621", "failed", 0],
        ["saucenao", "ok", 2],
      ]);
      expect(result.matches).toHaveLength(4);
    });
  });

  describe("merging", () => {
    it("keeps the original over the mirrored copy when both find the same source", async () => {
      const fluffle = service("fluffle", async () => [rawMatch()], { mirrored: true });

      const result = await run(["img1"], [fluffle]);

      expect(result.matches).toEqual([
        expect.objectContaining({ variant: "original", baseHints: [] }),
      ]);
    });

    it("marks a source that only the mirrored copy found", async () => {
      const fluffle = service(
        "fluffle",
        async (image) => (image.bytes.toString().startsWith("mirrored") ? [rawMatch()] : []),
        { mirrored: true }
      );

      const result = await run(["img1"], [fluffle]);

      expect(result.matches).toEqual([
        expect.objectContaining({
          variant: "mirrored",
          baseHints: [
            "found only when the image was mirrored, so the submission may be a flipped copy",
          ],
        }),
      ]);
    });

    it("lists a source once when two services both find it", async () => {
      const fluffle = service("fluffle", async () => [
        rawMatch({ sourceUrl: "https://www.furaffinity.net/view/12345/" }),
      ]);
      const sauce = service("saucenao", async () => [
        rawMatch({
          service: "saucenao",
          sourceUrl: "http://furaffinity.net/view/12345?utm_source=x",
        }),
      ]);

      const result = await run(["img1"], [fluffle, sauce]);

      expect(result.matches).toEqual([
        expect.objectContaining({
          service: "fluffle",
          sourceUrl: "https://www.furaffinity.net/view/12345/",
        }),
      ]);
      expect(result.omitted).toBe(0);
      expect(result.services.map((s) => [s.service, s.queries, s.matches])).toEqual([
        ["fluffle", 1, 1],
        ["saucenao", 1, 0],
      ]);
    });

    it("keeps the art archive's entry when Google finds the same page", async () => {
      // The archive found the page only with the mirrored copy. Google's entry is
      // for the original and still must not replace it: it names nobody.
      const archive = () =>
        service(
          "fluffle",
          async (image) => (image.bytes.toString().startsWith("mirrored") ? [rawMatch()] : []),
          { mirrored: true }
        );
      const google = () => service("google", async () => [googleMatch(rawMatch().sourceUrl)]);
      const mirroredArchiveEntry = [
        expect.objectContaining({
          service: "fluffle",
          artists: ["FoxyArtz"],
          variant: "mirrored",
          baseHints: [
            "found only when the image was mirrored, so the submission may be a flipped copy",
          ],
        }),
      ];

      expect((await run(["img1"], [archive(), google()])).matches).toEqual(mirroredArchiveEntry);
      expect((await run(["img2"], [google(), archive()])).matches).toEqual(mirroredArchiveEntry);
    });

    it("ranks Google's first four matches for an image with the rest and puts the later ones last", async () => {
      const google = service("google", async () =>
        Array.from({ length: 6 }, (_, i) => googleMatch(webPage(i)))
      );
      const fluffle = service("fluffle", async () => [
        rawMatch({ sourceUrl: source(1), quality: "probable", similarity: 85 }),
        rawMatch({ sourceUrl: source(2), quality: "probable", similarity: 80 }),
        rawMatch({ sourceUrl: source(3), quality: "probable", similarity: 75 }),
      ]);

      const result = await run(["img1"], [fluffle, google]);

      // Six whole copies on the web would otherwise take every place on the list.
      expect(result.matches.map((m) => m.sourceUrl)).toEqual([
        webPage(0),
        webPage(1),
        webPage(2),
        webPage(3),
        source(1),
        source(2),
      ]);
      expect(result.omitted).toBe(3);
      expect(result.services.map((s) => [s.service, s.matches])).toEqual([
        ["fluffle", 2],
        ["google", 4],
      ]);
    });

    it("lists more of Google's matches when nothing else needs the room", async () => {
      const google = service("google", async () =>
        Array.from({ length: 7 }, (_, i) => googleMatch(webPage(i)))
      );
      const fluffle = service("fluffle", async () => [
        rawMatch({ sourceUrl: source(1), quality: "probable", similarity: 85 }),
      ]);

      const result = await run(["img1"], [fluffle, google]);

      expect(result.matches.map((m) => m.sourceUrl)).toEqual([
        webPage(0),
        webPage(1),
        webPage(2),
        webPage(3),
        source(1),
        webPage(4),
      ]);
      expect(result.omitted).toBe(2);
    });

    it("prefers the copy of a duplicate that carries a post date", async () => {
      const fluffle = service("fluffle", async () => [rawMatch({ postedAt: null })]);
      const sauce = service("saucenao", async () => [
        rawMatch({ service: "saucenao", postedAt: "2024-01-01T00:00:00.000Z" }),
      ]);

      const result = await run(["img1"], [fluffle, sauce]);

      expect(result.matches).toEqual([
        expect.objectContaining({ service: "saucenao", postedAt: "2024-01-01T00:00:00.000Z" }),
      ]);
    });

    it("ranks by match quality, then similarity", async () => {
      const fluffle = service("fluffle", async () => [
        rawMatch({ sourceUrl: source(1), quality: "probable", similarity: 80 }),
        rawMatch({ sourceUrl: source(2), quality: "exact", similarity: 91 }),
        rawMatch({ sourceUrl: source(3), quality: "unlikely", similarity: 99 }),
        rawMatch({ sourceUrl: source(4), quality: "exact", similarity: 97 }),
        rawMatch({ sourceUrl: source(5), quality: null, similarity: 85 }),
      ]);

      const result = await run(["img1"], [fluffle]);

      expect(result.matches.map((m) => m.sourceUrl)).toEqual([
        source(4),
        source(2),
        source(5),
        source(1),
        source(3),
      ]);
    });

    it("keeps the best six matches for each image and counts the rest", async () => {
      const eight = Array.from({ length: 8 }, (_, i) =>
        rawMatch({ sourceUrl: source(100 + i), quality: "probable", similarity: 70 + i })
      );
      const two = [rawMatch({ sourceUrl: source(200) }), rawMatch({ sourceUrl: source(201) })];
      const fluffle = service("fluffle", async (image) =>
        image.bytes.toString() === "lookup-img1" ? eight : two
      );

      const result = await run(["img1", "img2"], [fluffle]);

      const forImage = (key: string) => result.matches.filter((m) => m.imageKey === key);
      expect(forImage("img1").map((m) => m.similarity)).toEqual([77, 76, 75, 74, 73, 72]);
      expect(forImage("img2")).toHaveLength(2);
      expect(result.omitted).toBe(2);
      expect(result.services[0]).toMatchObject({ matches: 8 });
    });

    it("points out a source that matches two of the applicant's images", async () => {
      const fluffle = service("fluffle", async (image) =>
        image.bytes.toString() === "lookup-img3"
          ? [rawMatch({ sourceUrl: source(9) })]
          : [rawMatch({ sourceUrl: source(1) })]
      );

      const result = await run(["img1", "img2", "img3"], [fluffle]);

      const hints = Object.fromEntries(result.matches.map((m) => [m.imageKey, m.baseHints]));
      expect(hints).toEqual({
        img1: ["the same source also matches img2"],
        img2: ["the same source also matches img1"],
        img3: [],
      });
    });

    it("labels every match against the applicant's handles and account age", async () => {
      const fluffle = service("fluffle", async () => [
        rawMatch({
          sourceUrl: source(1),
          artists: ["FoxyArtz"],
          postedAt: "2024-03-01T00:00:00.000Z",
        }),
        rawMatch({
          sourceUrl: source(2),
          artists: ["SomeoneElse"],
          uploader: "SomeoneElse",
          postedAt: "2021-03-01T00:00:00.000Z",
          similarity: 90,
        }),
      ]);

      const result = await run(["img1"], [fluffle]);

      expect(result.matches).toEqual([
        expect.objectContaining({
          ownership: "applicant",
          matchedHandle: "furaffinity: FoxyArtz",
          predatesAccount: false,
        }),
        expect.objectContaining({ ownership: "other", matchedHandle: null, predatesAccount: true }),
      ]);
    });
  });
});

describe("annotateMatch", () => {
  const hit = (match: Partial<RawMatch>, variant: "original" | "mirrored" = "original") => ({
    imageKey: "img2",
    variant,
    match: rawMatch(match),
  });

  it("keeps the service's fields and adds the image it belongs to", () => {
    const annotated = annotateMatch(hit({ title: "Sunset fox", similarity: 88.5 }), context());
    expect(annotated).toMatchObject({
      ...rawMatch({ title: "Sunset fox", similarity: 88.5 }),
      imageKey: "img2",
      variant: "original",
    });
  });

  it.each([
    ["before the account existed", "2022-06-01T00:00:00.000Z", true],
    ["after the account was created", "2024-06-01T00:00:00.000Z", false],
    ["with no date", null, null],
    ["with a date that cannot be read", "last Tuesday", null],
  ])("says whether a post made %s predates the account", (_label, postedAt, expected) => {
    expect(annotateMatch(hit({ postedAt }), context()).predatesAccount).toBe(expected);
  });

  it("cannot compare dates when the account's age is unknown", () => {
    const annotated = annotateMatch(
      hit({ postedAt: "2022-06-01T00:00:00.000Z" }),
      context({ accountCreatedAtMs: null })
    );
    expect(annotated.predatesAccount).toBeNull();
  });

  it("says unknown when the applicant claimed no handles", () => {
    const annotated = annotateMatch(
      hit({ artists: ["SomeoneElse"], uploader: "SomeoneElse" }),
      context({ handles: [] })
    );
    expect(annotated).toMatchObject({ ownership: "unknown", matchedHandle: null });
  });

  it("adds the mirrored note after any base hints", () => {
    const annotated = annotateMatch(hit({ title: "F2U fox base" }, "mirrored"), context());
    expect(annotated.baseHints).toEqual([
      'source title mentions a base: "F2U fox base"',
      "found only when the image was mirrored, so the submission may be a flipped copy",
    ]);
  });
});

describe("baseHints", () => {
  it.each([
    "F2U canine base",
    "Free bases pack 3",
    "P2U lineart - feline",
    "YCH auction: beach day",
    "Your Character Here (open)",
    "Chibi template",
    "Adoptables batch 12",
    "Line art, free to use",
  ])("reads a base out of the title %s", (title) => {
    expect(baseHints(rawMatch({ title }))).toEqual([`source title mentions a base: "${title}"`]);
  });

  it.each([
    "Baseball fox",
    "Database of my characters",
    "Based on a true story",
    "Adopted puppy",
    "Sunset over the bay",
  ])("sees no base in the title %s", (title) => {
    expect(baseHints(rawMatch({ title }))).toEqual([]);
  });

  it("shortens a long title", () => {
    const title = `Base ${"x".repeat(200)}`;
    const [hint] = baseHints(rawMatch({ title }));
    expect(hint).toBe(`source title mentions a base: "${title.slice(0, 80)}"`);
  });

  it("reads base tags, with underscores or without", () => {
    const hints = baseHints(
      rawMatch({
        tags: [
          "fox",
          "ych",
          "line_art",
          "your_character_here",
          "commission",
          "template",
          "adoptable",
        ],
      })
    );
    // At most four tags are named.
    expect(hints).toEqual(["source is tagged ych, line_art, your_character_here, template"]);
  });

  it("reports the title and the tags separately", () => {
    expect(baseHints(rawMatch({ title: "P2U base", tags: ["base"] }))).toEqual([
      'source title mentions a base: "P2U base"',
      "source is tagged base",
    ]);
  });

  it("returns nothing for a match with no title and ordinary tags", () => {
    expect(baseHints(rawMatch({ title: null, tags: ["fox", "sketch", "commission"] }))).toEqual([]);
  });
});

describe("lookup cache", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    db = memoryDb();
  });
  afterEach(() => {
    db.close();
  });

  it("returns what was stored for the same hash, service and variant only", () => {
    const stored = [rawMatch({ title: "Sunset fox" })];
    writeCache(db, "hash-a", "fluffle", "original", stored, T0);

    expect(readCache(db, "hash-a", "fluffle", "original", T0)).toEqual(stored);
    expect(readCache(db, "hash-a", "fluffle", "mirrored", T0)).toBeNull();
    expect(readCache(db, "hash-a", "e621", "original", T0)).toBeNull();
    expect(readCache(db, "hash-b", "fluffle", "original", T0)).toBeNull();
  });

  it("replaces an older entry for the same key", () => {
    writeCache(db, "hash-a", "fluffle", "original", [rawMatch()], T0);
    writeCache(db, "hash-a", "fluffle", "original", [], T0 + DAY_MS);

    expect(readCache(db, "hash-a", "fluffle", "original", T0 + DAY_MS)).toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM artist_provenance_cache`).get()).toEqual({ n: 1 });
  });

  it("treats an entry it cannot read as a miss", () => {
    const insert = db.prepare(
      `INSERT INTO artist_provenance_cache (image_sha256, service, variant, result_json, fetched_at_s) VALUES (?, 'fluffle', 'original', ?, ?)`
    );
    insert.run("broken", "{not json", T0 / 1000);
    insert.run("wrong-shape", '{"matches":[]}', T0 / 1000);

    expect(readCache(db, "broken", "fluffle", "original", T0)).toBeNull();
    expect(readCache(db, "wrong-shape", "fluffle", "original", T0)).toBeNull();
  });

  it("expires an entry after a week", () => {
    writeCache(db, "hash-a", "fluffle", "original", [rawMatch()], T0);
    const ttlMs = LIMITS.cacheTtlSeconds * 1000;

    expect(LIMITS.cacheTtlSeconds).toBe(7 * 86_400);
    expect(readCache(db, "hash-a", "fluffle", "original", T0 + ttlMs)).not.toBeNull();
    expect(readCache(db, "hash-a", "fluffle", "original", T0 + ttlMs + 1000)).toBeNull();
  });

  it("prunes expired entries and reports how many went", () => {
    writeCache(db, "old-1", "fluffle", "original", [], T0 - 8 * DAY_MS);
    writeCache(db, "old-2", "e621", "mirrored", [], T0 - 30 * DAY_MS);
    writeCache(db, "fresh", "fluffle", "original", [rawMatch()], T0 - 2 * DAY_MS);

    expect(pruneCache(db, T0)).toBe(2);
    expect(pruneCache(db, T0)).toBe(0);
    expect(readCache(db, "fresh", "fluffle", "original", T0)).toHaveLength(1);
  });
});
