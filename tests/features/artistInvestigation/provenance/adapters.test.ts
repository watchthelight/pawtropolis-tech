// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/provenance/adapters.test.ts
 * WHAT: The three reverse image lookup adapters and the helpers they share,
 *       with every HTTP call stubbed.
 * WHY: Each service has its own request format, its own way of saying "no
 *      result" and its own way of failing. The adapters must send what the
 *      service expects, keep credentials out of error text, and turn auth and
 *      quota failures into a stop for that service only.
 */
import { describe, expect, it, vi } from "vitest";
import { e621 } from "../../../../src/features/artistInvestigation/provenance/e621.js";
import { fluffle } from "../../../../src/features/artistInvestigation/provenance/fluffle.js";
import { saucenao } from "../../../../src/features/artistInvestigation/provenance/saucenao.js";
import {
  LookupError,
  OutOfTimeError,
  Pacer,
  httpError,
  qualityFromScore,
  tweetDate,
  type LookupContext,
  type LookupImage,
} from "../../../../src/features/artistInvestigation/provenance/shared.js";
import { settings } from "../fixtures.js";

const image: LookupImage = { bytes: Buffer.from("jpeg-bytes"), mediaType: "image/jpeg" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(...responses: Array<Response | Error>) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function context(
  overrides: Parameters<typeof settings>[0] = {}
): LookupContext & { pace: ReturnType<typeof vi.fn> } {
  return { settings: settings(overrides), pace: vi.fn(async () => undefined) };
}

const call = (spy: ReturnType<typeof stubFetch>, index: number) => {
  const [url, init] = spy.mock.calls[index] as [string, RequestInit];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    form: init.body as FormData,
  };
};

const tweetId = (ms: number) => String((BigInt(ms) - 1288834974657n) << 22n);

describe("shared helpers", () => {
  it("spaces requests by the service's gap", async () => {
    let clock = 1_000;
    const sleeps: number[] = [];
    const pacer = new Pacer(
      1_500,
      60_000,
      async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      () => clock
    );

    await pacer.wait();
    await pacer.wait();
    clock += 400;
    await pacer.wait();

    // The first request goes at once. The third had already waited 400 ms of its gap.
    expect(sleeps).toEqual([1_500, 1_100]);
  });

  it("refuses to hand out a slot at or past the deadline", async () => {
    let clock = 0;
    const pacer = new Pacer(
      1_000,
      2_500,
      async (ms) => {
        clock += ms;
      },
      () => clock
    );

    await pacer.wait();
    await pacer.wait();
    await pacer.wait();
    await expect(pacer.wait()).rejects.toBeInstanceOf(OutOfTimeError);
  });

  it("buckets similarity scores", () => {
    expect([90, 89.9, 70, 69.9].map(qualityFromScore)).toEqual([
      "exact",
      "probable",
      "probable",
      "unlikely",
    ]);
  });

  it("reads the post time out of a tweet link and nothing out of other links", () => {
    const posted = Date.UTC(2024, 0, 1);
    expect(tweetDate(`https://x.com/FoxyArtz/status/${tweetId(posted)}`)).toBe(
      "2024-01-01T00:00:00.000Z"
    );
    expect(tweetDate(`https://twitter.com/FoxyArtz/status/${tweetId(posted)}?s=20`)).toBe(
      "2024-01-01T00:00:00.000Z"
    );
    expect(tweetDate("https://www.furaffinity.net/view/12345/")).toBeNull();
    expect(tweetDate("https://x.com/FoxyArtz")).toBeNull();
    expect(
      tweetDate(`https://x.com/FoxyArtz/status/${tweetId(Date.now() + 10 * 86_400_000)}`)
    ).toBeNull();
  });

  it("treats auth and quota failures as fatal and other statuses as retryable", () => {
    const of = (status: number) => httpError(new Response(null, { status }));
    expect([of(401).fatal, of(403).fatal, of(429).fatal, of(404).fatal, of(500).fatal]).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(of(401).message).toBe("credentials were rejected (HTTP 401)");
    expect(of(429).message).toBe("rate limit reached (HTTP 429)");
    expect(of(503).message).toBe("service error (HTTP 503)");
    expect(of(404).message).toBe("request was rejected (HTTP 404)");
  });
});

describe("fluffle", () => {
  it("needs no key", () => {
    expect(fluffle.unavailableReason(settings())).toBeNull();
    expect(fluffle.mirrored).toBe(true);
  });

  it("uploads the image with a descriptive User-Agent and reads exact and probable matches", async () => {
    const posted = Date.UTC(2024, 5, 15, 12);
    const spy = stubFetch(
      json({
        results: [
          {
            match: "exact",
            url: "https://www.furaffinity.net/view/123/",
            platform: "furAffinity",
            distance: 0.9731,
            authors: [{ name: "FoxyArtz" }],
          },
          {
            match: "unlikely",
            url: "https://www.furaffinity.net/view/999/",
            platform: "furAffinity",
            distance: 0.41,
            authors: [{ name: "Noise" }],
          },
          {
            match: "probable",
            url: "https://e621.net/posts/55",
            platform: "e621",
            distance: 0.81,
            authors: [{ name: "foxyartz_(artist)" }],
          },
          {
            match: "exact",
            url: `https://x.com/FoxyArtz/status/${tweetId(posted)}`,
            platform: "twitter",
            distance: 1,
            authors: [],
          },
          {
            match: "exact",
            url: "javascript:alert(1)",
            platform: "twitter",
            distance: 1,
            authors: [],
          },
        ],
      })
    );
    const ctx = context({ userAgent: "pawtropolis-test/1.0 (contact)" });

    const matches = await fluffle.search(image, ctx);

    expect(ctx.pace).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const sent = call(spy, 0);
    expect(sent.url).toBe("https://api.fluffle.xyz/exact-search-by-file");
    expect(sent.init.method).toBe("POST");
    expect(sent.headers["User-Agent"]).toBe("pawtropolis-test/1.0 (contact)");
    expect(sent.form.get("Limit")).toBe("16");
    const file = sent.form.get("File") as File;
    expect(file.type).toBe("image/jpeg");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("jpeg-bytes");

    expect(matches).toEqual([
      {
        service: "fluffle",
        sourceUrl: "https://www.furaffinity.net/view/123/",
        platform: "furaffinity",
        uploader: "FoxyArtz",
        artists: ["FoxyArtz"],
        postedAt: null,
        similarity: 97.3,
        quality: "exact",
        title: null,
        tags: [],
        relatedUrls: [],
      },
      expect.objectContaining({
        sourceUrl: "https://e621.net/posts/55",
        platform: "e621",
        // On e621 the credited name is an artist tag, not the account that posted.
        uploader: null,
        artists: ["foxyartz_(artist)"],
        similarity: 81,
        quality: "probable",
      }),
      expect.objectContaining({
        platform: "twitter",
        postedAt: "2024-06-15T12:00:00.000Z",
        uploader: null,
        artists: [],
        similarity: 100,
      }),
    ]);
  });

  it("returns no matches for an empty answer", async () => {
    stubFetch(json({ results: [] }));
    expect(await fluffle.search(image, context())).toEqual([]);
    stubFetch(json({ unexpected: true }));
    expect(await fluffle.search(image, context())).toEqual([]);
  });

  it("stops the service on a rate limit and keeps going after a server error", async () => {
    stubFetch(new Response("slow down", { status: 429 }));
    await expect(fluffle.search(image, context())).rejects.toMatchObject({
      name: "LookupError",
      fatal: true,
    });

    stubFetch(new Response("oops", { status: 502 }));
    await expect(fluffle.search(image, context())).rejects.toMatchObject({
      message: "service error (HTTP 502)",
      fatal: false,
    });
  });

  it("reports a dropped connection, a timeout and a broken answer in plain words", async () => {
    stubFetch(new TypeError("fetch failed"));
    await expect(fluffle.search(image, context())).rejects.toMatchObject({
      message: "network error",
      fatal: false,
    });

    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    stubFetch(timeout);
    await expect(fluffle.search(image, context())).rejects.toMatchObject({
      message: "request timed out",
    });

    stubFetch(new Response("<html>maintenance</html>", { status: 200 }));
    await expect(fluffle.search(image, context())).rejects.toMatchObject({
      message: "answer was not valid JSON",
    });
  });
});

describe("e621", () => {
  const keys = { e621Login: "pawbot", e621ApiKey: "e6-secret", userAgent: "pawtropolis-test/1.0" };

  it("is skipped unless both the login and the key are set", () => {
    const reason = "no account name and API key stored, set them with /service-keys";
    expect(e621.unavailableReason(settings())).toBe(reason);
    expect(e621.unavailableReason(settings({ e621Login: "pawbot" }))).toBe(reason);
    expect(e621.unavailableReason(settings({ e621ApiKey: "e6-secret" }))).toBe(reason);
    expect(e621.unavailableReason(settings(keys))).toBeNull();
  });

  it("searches by similarity, then reads the posts for artists, sources and dates", async () => {
    const spy = stubFetch(
      json([
        {
          post_id: 111,
          score: 92.44,
          post: {
            posts: {
              created_at: "2024-03-02T10:00:00.000-05:00",
              source: "https://www.furaffinity.net/view/9/",
            },
          },
        },
        { post_id: 222, score: 50 },
        {
          post_id: 333,
          score: 75.26,
          post: {
            posts: {
              created_at: "2022-01-05T00:00:00.000Z",
              source: "https://twitter.com/a/status/1 notalink",
            },
          },
        },
      ]),
      json({
        posts: [
          {
            id: 111,
            created_at: "2024-03-02T15:00:00.000Z",
            uploader_name: "archiver",
            sources: ["https://www.furaffinity.net/view/9/", "not-a-url"],
            tags: {
              artist: ["foxyartz", "conditional_dnp"],
              general: ["fox", "ych", "line_art"],
              meta: ["commission", "hi_res"],
              lore: [],
            },
          },
        ],
      })
    );
    const ctx = context(keys);

    const matches = await e621.search(image, ctx);

    expect(ctx.pace).toHaveBeenCalledTimes(2);
    const first = call(spy, 0);
    expect(first.url).toBe("https://e621.net/iqdb_queries.json");
    expect(first.init.method).toBe("POST");
    expect(first.headers["User-Agent"]).toBe("pawtropolis-test/1.0 (by pawbot on e621)");
    expect(first.headers.Authorization).toBe(
      `Basic ${Buffer.from("pawbot:e6-secret").toString("base64")}`
    );
    expect(first.form.get("search[file]")).toBeInstanceOf(Blob);

    const second = call(spy, 1);
    expect(second.url).toBe("https://e621.net/posts.json?limit=6&tags=id%3A111%2C333");
    expect(second.headers.Authorization).toBe(first.headers.Authorization);

    expect(matches).toEqual([
      {
        service: "e621",
        sourceUrl: "https://e621.net/posts/111",
        platform: "e621",
        uploader: "archiver",
        artists: ["foxyartz"],
        postedAt: "2024-03-02T15:00:00.000Z",
        similarity: 92.4,
        quality: "exact",
        title: null,
        tags: ["ych", "line_art", "commission"],
        relatedUrls: ["https://www.furaffinity.net/view/9/"],
      },
      {
        service: "e621",
        sourceUrl: "https://e621.net/posts/333",
        platform: "e621",
        uploader: null,
        artists: [],
        // The post lookup did not return 333, so the similarity answer's own fields are used.
        postedAt: "2022-01-05T00:00:00.000Z",
        similarity: 75.3,
        quality: "probable",
        title: null,
        tags: [],
        relatedUrls: ["https://twitter.com/a/status/1"],
      },
    ]);
  });

  it("makes one request and returns nothing when e621 answers with its no-hits object", async () => {
    const spy = stubFetch(json({ posts: [] }));
    const ctx = context(keys);

    expect(await e621.search(image, ctx)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ctx.pace).toHaveBeenCalledTimes(1);
  });

  it("keeps the hits when the post lookup fails", async () => {
    stubFetch(
      json([
        {
          post_id: 111,
          score: 95,
          post: {
            posts: {
              created_at: "2024-03-02T15:00:00.000Z",
              source: "https://www.furaffinity.net/view/9/",
            },
          },
        },
      ]),
      new Response("down", { status: 503 })
    );
    const matches = await e621.search(image, context(keys));
    expect(matches).toEqual([
      expect.objectContaining({
        sourceUrl: "https://e621.net/posts/111",
        artists: [],
        postedAt: "2024-03-02T15:00:00.000Z",
        relatedUrls: ["https://www.furaffinity.net/view/9/"],
      }),
    ]);

    stubFetch(json([{ post_id: 111, score: 95 }]), new TypeError("fetch failed"));
    expect(await e621.search(image, context(keys))).toEqual([
      expect.objectContaining({ sourceUrl: "https://e621.net/posts/111" }),
    ]);
  });

  it("stops the service when the credentials are rejected, without echoing them", async () => {
    stubFetch(new Response("no", { status: 401 }));
    const failure = await e621.search(image, context(keys)).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(LookupError);
    expect(failure).toMatchObject({ fatal: true, message: "credentials were rejected (HTTP 401)" });
    expect(String((failure as Error).message)).not.toContain("e6-secret");
  });
});

describe("saucenao", () => {
  const keys = { sauceNaoApiKey: "sauce-secret" };

  it("is skipped without a key and never searches mirrored copies", () => {
    expect(saucenao.unavailableReason(settings())).toBe(
      "no API key stored, set one with /service-keys"
    );
    expect(saucenao.unavailableReason(settings(keys))).toBeNull();
    expect(saucenao.mirrored).toBe(false);
  });

  it("sends the documented query and reads results above the similarity floor", async () => {
    const spy = stubFetch(
      json({
        header: { status: 0 },
        results: [
          {
            header: { similarity: "93.21", index_name: "Index #40: FurAffinity" },
            data: {
              ext_urls: ["https://www.furaffinity.net/view/777/"],
              title: "Sunset fox",
              author_name: "FoxyArtz",
              created_at: "2023-05-06T00:00:00Z",
            },
          },
          { header: { similarity: "40.1" }, data: { ext_urls: ["https://example.com/noise"] } },
          {
            header: { similarity: "70" },
            data: {
              ext_urls: [],
              source: "https://www.pixiv.net/artworks/5",
              member_name: "pixfox",
              creator: ["pixfox", "other"],
            },
          },
          { header: { similarity: "88" }, data: { title: "no link" } },
        ],
      })
    );
    const ctx = context(keys);

    const matches = await saucenao.search(image, ctx);

    expect(ctx.pace).toHaveBeenCalledTimes(1);
    const sent = call(spy, 0);
    const url = new URL(sent.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://saucenao.com/search.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      output_type: "2",
      db: "999",
      numres: "8",
      api_key: "sauce-secret",
    });
    expect(sent.init.method).toBe("POST");
    expect(sent.form.get("file")).toBeInstanceOf(Blob);

    expect(matches).toEqual([
      {
        service: "saucenao",
        sourceUrl: "https://www.furaffinity.net/view/777/",
        platform: "furaffinity.net",
        uploader: "FoxyArtz",
        artists: ["FoxyArtz"],
        postedAt: "2023-05-06T00:00:00.000Z",
        similarity: 93.2,
        quality: "exact",
        title: "Sunset fox",
        tags: [],
        relatedUrls: [],
      },
      {
        service: "saucenao",
        sourceUrl: "https://www.pixiv.net/artworks/5",
        platform: "pixiv.net",
        uploader: "pixfox",
        artists: ["pixfox", "other"],
        postedAt: null,
        similarity: 70,
        quality: "probable",
        title: null,
        tags: [],
        relatedUrls: [],
      },
    ]);
  });

  it("stops the service when SauceNAO refuses the account, with its message stripped of HTML", async () => {
    stubFetch(
      json({
        header: {
          status: -2,
          message: "<strong>Daily Search Limit Exceeded.</strong><br />Try again tomorrow.",
        },
      })
    );
    await expect(saucenao.search(image, context(keys))).rejects.toMatchObject({
      name: "LookupError",
      fatal: true,
      message: "Daily Search Limit Exceeded. Try again tomorrow.",
    });
  });

  it("keeps the results when some of SauceNAO's indexes were offline", async () => {
    stubFetch(
      json({
        header: { status: 2 },
        results: [
          {
            header: { similarity: "91" },
            data: {
              ext_urls: ["https://www.deviantart.com/foxyartz/art/A-1"],
              author_name: "foxyartz",
            },
          },
        ],
      })
    );
    const matches = await saucenao.search(image, context(keys));
    expect(matches).toEqual([
      expect.objectContaining({ platform: "deviantart", artists: ["foxyartz"], quality: "exact" }),
    ]);
  });

  it("keeps the API key out of every error it raises", async () => {
    stubFetch(new TypeError("fetch failed: https://saucenao.com/search.php?api_key=sauce-secret"));
    const rejection = (search: Promise<unknown>) =>
      search.then(
        () => {
          throw new Error("the search did not fail");
        },
        (err: unknown) => err as Error
      );
    const network = await rejection(saucenao.search(image, context(keys)));
    expect(network.message).toBe("network error");

    stubFetch(new Response("forbidden", { status: 403 }));
    const refused = await rejection(saucenao.search(image, context(keys)));
    expect(refused).toMatchObject({ fatal: true, message: "credentials were rejected (HTTP 403)" });
    expect(refused.message).not.toContain("sauce-secret");
  });
});
