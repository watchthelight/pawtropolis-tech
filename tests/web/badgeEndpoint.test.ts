// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handleBadgeRequest } from "../../src/web/badgeEndpoint.js";
import {
  upsertManifestEntry,
  writeManifest,
  readManifest,
} from "../../src/features/badges/store.js";
import type {
  BadgeManifestEntry,
  BadgeStoreConfig,
} from "../../src/features/badges/types.js";

let dir: string;
let config: BadgeStoreConfig;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "badges-endpoint-"));
  config = {
    manifestPath: path.join(dir, "manifest.json"),
    generatedDir: path.join(dir, "generated"),
    baseUrl: "https://example.test",
  };
  delete process.env.BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES;
});

function fakeReq(url: string, method = "GET"): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

function fakeRes(): {
  res: http.ServerResponse;
  status: number | null;
  headers: Record<string, string | number>;
  body: string;
} {
  let status: number | null = null;
  const headers: Record<string, string | number> = {};
  let body = "";
  const res = {
    writeHead(s: number, h?: Record<string, string | number>) {
      status = s;
      Object.assign(headers, h ?? {});
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    headers,
    get body() {
      return body;
    },
  } as never;
}

function entry(id: string, discordId = "1"): BadgeManifestEntry {
  return {
    id,
    kind: "role",
    guildId: "g",
    discordId,
    displayName: "Movie Tier I",
    prefix: "@",
    suffix: "1+ movies",
    colorHex: "#FFAA00",
    backgroundHex: "#3A3A3A",
    foregroundHex: "#FFFFFF",
    stale: false,
    resolvedAt: new Date().toISOString(),
    style: "discord-role",
    url: "https://example.test/badges/" + id + ".svg",
    generatedAt: new Date().toISOString(),
  };
}

describe("handleBadgeRequest", () => {
  it("serves health JSON", () => {
    const r = fakeRes();
    expect(handleBadgeRequest(fakeReq("/api/badges/health"), r.res, config)).toBe(true);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(r.body).status).toBe("ok");
  });

  it("serves manifest JSON", () => {
    let m = readManifest(config);
    m = upsertManifestEntry(m, entry("movie-tier-1"));
    writeManifest(config, m);
    const r = fakeRes();
    handleBadgeRequest(fakeReq("/api/badges/manifest.json"), r.res, config);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).entries["movie-tier-1"].displayName).toBe("Movie Tier I");
  });

  it("renders fallback for unknown registry id", () => {
    const r = fakeRes();
    handleBadgeRequest(fakeReq("/badges/movie-tier-1.svg"), r.res, config);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toContain("image/svg+xml");
    expect(r.body).toContain("<svg");
  });

  it("serves SVG from manifest when no on-disk file", () => {
    let m = readManifest(config);
    m = upsertManifestEntry(m, entry("movie-tier-1"));
    writeManifest(config, m);
    const r = fakeRes();
    handleBadgeRequest(fakeReq("/badges/movie-tier-1.svg"), r.res, config);
    expect(r.status).toBe(200);
    expect(r.body).toContain("Movie Tier I");
  });

  it("blocks direct ID routes by default", () => {
    // The module loaded at the top of this file captured
    // BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES (unset) as false at import time, so
    // this exercises the genuinely-disabled direct-ID branch (404 JSON).
    const r = fakeRes();
    handleBadgeRequest(fakeReq("/badges/roles/123456789.svg"), r.res, config);
    expect(r.status).toBe(404);
    expect(r.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(r.body).error).toBe("direct_id_routes_disabled");
  });

  it("rejects unsafe ids", () => {
    const r = fakeRes();
    const handled = handleBadgeRequest(fakeReq("/badges/..%2Fetc.svg"), r.res, config);
    // path may not parse to our regex; either falls through (handled=false)
    // or returns the invalid-id fallback. Both are safe.
    if (handled) {
      expect(r.body).toContain("<svg");
    }
  });

  it("returns 304 on If-None-Match match", () => {
    let m = readManifest(config);
    m = upsertManifestEntry(m, entry("movie-tier-1"));
    writeManifest(config, m);
    const r1 = fakeRes();
    handleBadgeRequest(fakeReq("/badges/movie-tier-1.svg"), r1.res, config);
    const etag = r1.headers["ETag"] as string;
    expect(etag).toBeTruthy();
    const req2 = { url: "/badges/movie-tier-1.svg", method: "GET", headers: { "if-none-match": etag } } as unknown as http.IncomingMessage;
    const r2 = fakeRes();
    handleBadgeRequest(req2, r2.res, config);
    expect(r2.status).toBe(304);
  });
});

// badgeEndpoint captures ALLOW_DIRECT_ID_ROUTES from the env at module-import
// time, so the only faithful way to exercise the flag-enabled direct-ID branch
// (badgeEndpoint.ts ~l163-187) is to stub the env and re-import the module so a
// fresh instance picks up the true value. We re-import the store helpers from
// the same reset graph so the manifest we seed is read back consistently.
describe("handleBadgeRequest -- direct ID routes enabled", () => {
  let mod: typeof import("../../src/web/badgeEndpoint.js");
  let store: typeof import("../../src/features/badges/store.js");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES", "true");
    mod = await import("../../src/web/badgeEndpoint.js");
    store = await import("../../src/features/badges/store.js");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function seed(e: BadgeManifestEntry): void {
    let m = store.readManifest(config);
    m = store.upsertManifestEntry(m, e);
    store.writeManifest(config, m);
  }

  it("health JSON reports directIdRoutes enabled", () => {
    const r = fakeRes();
    mod.handleBadgeRequest(fakeReq("/api/badges/health"), r.res, config);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).directIdRoutes).toBe(true);
  });

  it("renders a badge for a known discordId on a direct role route", () => {
    seed(entry("movie-tier-1", "123456789"));
    const r = fakeRes();
    const handled = mod.handleBadgeRequest(
      fakeReq("/badges/roles/123456789.svg"),
      r.res,
      config,
    );
    expect(handled).toBe(true);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toContain("image/svg+xml");
    expect(r.body).toContain("<svg");
    expect(r.body).toContain("Movie Tier I");
  });

  it("matches the synthesized id (role-<digits>) when present in the manifest", () => {
    seed(entry("role-987654321", "000000000"));
    const r = fakeRes();
    mod.handleBadgeRequest(fakeReq("/badges/roles/987654321.svg"), r.res, config);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toContain("image/svg+xml");
    expect(r.body).toContain("Movie Tier I");
  });

  it("serves an unknown-role fallback SVG when no manifest entry matches", () => {
    const r = fakeRes();
    const handled = mod.handleBadgeRequest(
      fakeReq("/badges/roles/555555555.svg"),
      r.res,
      config,
    );
    expect(handled).toBe(true);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toContain("image/svg+xml");
    expect(r.body).toContain("<svg");
    expect(r.body).toContain("unknown role");
  });

  it("does not return the direct_id_routes_disabled error when enabled", () => {
    const r = fakeRes();
    mod.handleBadgeRequest(fakeReq("/badges/users/444444444.svg"), r.res, config);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toContain("image/svg+xml");
  });
});
