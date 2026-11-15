/**
 * Pawtropolis Tech -- tests/features/serviceKeys.test.ts
 * WHAT: The service table behind /service-keys: which names each service uses,
 *       what counts as stored, and what each test call sends and concludes.
 * WHY: A test call decides whether a key is stored. It has to send the key it
 *      was given (not the stored one), and it has to tell "the service took it"
 *      apart from every kind of refusal.
 * NOTE: Nothing here talks to a service. fetch is replaced in every test.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { detectNsfwVision, visionPausedUntil } from "../../src/features/googleVision.js";
import { KEY_SERVICES, findKeyService, storedValues } from "../../src/features/serviceKeys.js";

const NAMES = ["GOOGLE_VISION_API_KEY", "SAUCENAO_API_KEY", "E621_LOGIN", "E621_API_KEY"] as const;
const saved = new Map<string, string | undefined>();
const fetchMock = vi.fn();

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status });

const service = (id: string) => {
  const found = findKeyService(id);
  if (!found) throw new Error(`no service ${id}`);
  return found;
};

/** The request a test call made: where it went and what it carried. */
function request(index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

async function uploadedImage(field: string): Promise<{ type: string; bytes: Buffer }> {
  const file = (request().init.body as FormData).get(field) as Blob;
  return { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
}

beforeEach(() => {
  for (const name of NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of NAMES) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the service table", () => {
  it("covers Google Vision, SauceNAO and e621", () => {
    expect(KEY_SERVICES.map((s) => s.id)).toEqual(["vision", "saucenao", "e621"]);
  });

  it("uses the names the rest of the bot reads", () => {
    expect(KEY_SERVICES.flatMap((s) => s.fields.map((f) => f.env))).toEqual([...NAMES]);
  });

  it("has ids, names and labels that fit Discord's limits", () => {
    for (const s of KEY_SERVICES) {
      // Choice value and custom id suffix.
      expect(s.id).toMatch(/^[a-z0-9]{1,20}$/);
      // The form title is "<name>: enter the key", 45 characters at most.
      expect(`${s.name}: enter the key`.length).toBeLessThanOrEqual(45);
      expect(s.fields.length).toBeGreaterThan(0);
      // A form has five rows.
      expect(s.fields.length).toBeLessThanOrEqual(5);
      for (const field of s.fields) expect(field.label.length).toBeLessThanOrEqual(45);
    }
  });

  it("finds a service by id and nothing else", () => {
    expect(findKeyService("e621")?.name).toBe("e621");
    expect(findKeyService("E621")).toBeNull();
    expect(findKeyService("")).toBeNull();
    expect(findKeyService("constructor")).toBeNull();
  });
});

describe("storedValues", () => {
  it("is empty when nothing is set", () => {
    expect(storedValues(service("e621"))).toEqual({});
  });

  it("reads the environment when it is called", () => {
    const e621 = service("e621");
    expect(storedValues(e621)).toEqual({});

    process.env.E621_LOGIN = "pawbot";
    process.env.E621_API_KEY = "e6-key";

    expect(storedValues(e621)).toEqual({ E621_LOGIN: "pawbot", E621_API_KEY: "e6-key" });
  });

  it("leaves out a blank value and trims the others", () => {
    process.env.E621_LOGIN = "   ";
    process.env.E621_API_KEY = " e6-key ";

    expect(storedValues(service("e621"))).toEqual({ E621_API_KEY: "e6-key" });
  });

  it("only reads the names of the service it is asked about", () => {
    process.env.SAUCENAO_API_KEY = "sauce-key";

    expect(storedValues(service("vision"))).toEqual({});
  });
});

describe("the Google Vision test", () => {
  const vision = service("vision");

  it("passes when Google answers 200", async () => {
    fetchMock.mockImplementation(json(200, { responses: [{}] }));

    expect(await vision.test({ GOOGLE_VISION_API_KEY: "new-key" })).toEqual({ ok: true });
  });

  it("sends the key it was given and a real JPEG", async () => {
    process.env.GOOGLE_VISION_API_KEY = "stored-key";
    fetchMock.mockImplementation(json(200, { responses: [{}] }));

    await vision.test({ GOOGLE_VISION_API_KEY: "new-key" });

    const { url, init, headers } = request();
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect(headers["X-Goog-Api-Key"]).toBe("new-key");
    const body = JSON.parse(init.body as string) as {
      requests: { image: { content: string } }[];
    };
    const bytes = Buffer.from(body.requests[0]!.image.content, "base64");
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("fails with Google's answer when the key is refused", async () => {
    fetchMock.mockImplementation(
      json(400, { error: { message: "API key not valid. Please pass a valid API key." } })
    );

    expect(await vision.test({ GOOGLE_VISION_API_KEY: "bad-key" })).toEqual({
      ok: false,
      reason: "HTTP 400: API key not valid. Please pass a valid API key.",
    });
  });

  it("lifts the scan pause when Google accepts the key", async () => {
    process.env.GOOGLE_VISION_API_KEY = "stored-key";
    fetchMock.mockImplementation(json(403, { error: { message: "billing" } }));
    await detectNsfwVision("https://cdn.discordapp.com/avatars/1/a.png");
    expect(visionPausedUntil()).toBeGreaterThan(0);

    fetchMock.mockImplementation(json(200, { responses: [{}] }));
    await vision.test({ GOOGLE_VISION_API_KEY: "stored-key" });

    expect(visionPausedUntil()).toBe(0);
  });

  it("leaves the pause alone when the key is refused", async () => {
    process.env.GOOGLE_VISION_API_KEY = "stored-key";
    fetchMock.mockImplementation(json(403, { error: { message: "billing" } }));
    await detectNsfwVision("https://cdn.discordapp.com/avatars/1/a.png");
    const pausedUntil = visionPausedUntil();
    expect(pausedUntil).toBeGreaterThan(0);

    await vision.test({ GOOGLE_VISION_API_KEY: "stored-key" });

    expect(visionPausedUntil()).toBe(pausedUntil);
  });
});

describe("the SauceNAO test", () => {
  const saucenao = service("saucenao");

  it("passes when the search runs, with or without hits", async () => {
    fetchMock.mockImplementation(json(200, { header: { status: 0 }, results: [] }));

    expect(await saucenao.test({ SAUCENAO_API_KEY: "new-key" })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("searches with the key it was given and a real JPEG", async () => {
    process.env.SAUCENAO_API_KEY = "stored-key";
    fetchMock.mockImplementation(json(200, { header: { status: 0 }, results: [] }));

    await saucenao.test({ SAUCENAO_API_KEY: "new-key" });

    const url = new URL(request().url);
    expect(url.origin + url.pathname).toBe("https://saucenao.com/search.php");
    expect(url.searchParams.get("api_key")).toBe("new-key");
    const image = await uploadedImage("file");
    expect(image.type).toBe("image/jpeg");
    expect([...image.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("fails when SauceNAO rejects the key", async () => {
    fetchMock.mockImplementation(
      json(403, {
        header: { status: -1, message: "The anonymous account type does not permit API usage." },
      })
    );

    expect(await saucenao.test({ SAUCENAO_API_KEY: "bad-key" })).toEqual({
      ok: false,
      reason: "credentials were rejected (HTTP 403)",
    });
  });

  it("fails with SauceNAO's message when the account is refused in the answer", async () => {
    fetchMock.mockImplementation(
      json(200, { header: { status: -2, message: "Search rate too high." } })
    );

    expect(await saucenao.test({ SAUCENAO_API_KEY: "new-key" })).toEqual({
      ok: false,
      reason: "Search rate too high.",
    });
  });

  it("fails when the daily allowance is used up", async () => {
    fetchMock.mockImplementation(json(429, { header: { status: -2 } }));

    expect(await saucenao.test({ SAUCENAO_API_KEY: "new-key" })).toEqual({
      ok: false,
      reason: "rate limit reached (HTTP 429)",
    });
  });

  it("fails without the request's own text when the network is down", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed: https://saucenao.com/search.php?api_key=new-key");
    });

    expect(await saucenao.test({ SAUCENAO_API_KEY: "new-key" })).toEqual({
      ok: false,
      reason: "network error",
    });
  });
});

describe("the e621 test", () => {
  const e621 = service("e621");
  const values = { E621_LOGIN: "pawbot", E621_API_KEY: "new-key" };

  it("passes when the similarity search runs", async () => {
    // e621 answers with an object, not a list, when nothing is similar.
    fetchMock.mockImplementation(json(200, { posts: [] }));

    expect(await e621.test(values)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signs in with the name and key it was given", async () => {
    process.env.E621_LOGIN = "stored-name";
    process.env.E621_API_KEY = "stored-key";
    fetchMock.mockImplementation(json(200, { posts: [] }));

    await e621.test(values);

    const { url, headers } = request();
    expect(url).toBe("https://e621.net/iqdb_queries.json");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("pawbot:new-key").toString("base64")}`);
    expect(headers["User-Agent"]).toContain("(by pawbot on e621)");
    const image = await uploadedImage("search[file]");
    expect(image.type).toBe("image/jpeg");
    expect([...image.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("fails when e621 rejects the name or the key", async () => {
    fetchMock.mockImplementation(
      json(401, { success: false, reason: "SessionLoader::AuthenticationFailure" })
    );

    expect(await e621.test(values)).toEqual({
      ok: false,
      reason: "credentials were rejected (HTTP 401)",
    });
  });

  it("fails when e621 is down", async () => {
    fetchMock.mockImplementation(json(503, {}));

    expect(await e621.test(values)).toEqual({ ok: false, reason: "service error (HTTP 503)" });
  });

  it("fails when e621 does not answer in time", async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    expect(await e621.test(values)).toEqual({ ok: false, reason: "request timed out" });
  });
});
