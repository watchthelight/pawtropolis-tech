// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { refreshAllBadges } from "../../src/scheduler/badgeRefreshScheduler.js";
import { readManifest } from "../../src/features/badges/store.js";
import type { BadgeStoreConfig } from "../../src/features/badges/types.js";

let dir: string;
let config: BadgeStoreConfig;
const ORIGINAL_GUILD_ID = process.env.GUILD_ID;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "badges-sched-"));
  config = {
    manifestPath: path.join(dir, "manifest.json"),
    generatedDir: path.join(dir, "generated"),
    baseUrl: "https://example.test",
  };
  process.env.GUILD_ID = "guild-1";
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (ORIGINAL_GUILD_ID === undefined) delete process.env.GUILD_ID;
  else process.env.GUILD_ID = ORIGINAL_GUILD_ID;
});

function makeClient(roleData: Map<string, { name: string; color: number }>, channelData: Map<string, { name: string }>) {
  const guild = {
    roles: { cache: roleData, fetch: vi.fn() },
    channels: { cache: channelData, fetch: vi.fn(async () => null) },
  };
  return {
    isReady: () => true,
    users: { fetch: vi.fn(async () => ({ globalName: "x", username: "x" })) },
    guilds: { cache: { get: () => guild }, fetch: vi.fn(async () => guild) },
  };
}

// Real SVG rendering for ~80 badges (sharp/canvas first-init) routinely
// runs >5s on slow CI runners; a 20s budget keeps the test honest while
// avoiding flakes.
describe("refreshAllBadges", { timeout: 20_000 }, () => {
  it("writes SVGs and manifest for resolvable badges", async () => {
    const client = makeClient(
      new Map([
        ["1388676461657063505", { name: "Movie Tier I", color: 0xffaa00 }],
        ["1388676662337736804", { name: "Movie Tier II", color: 0xff8800 }],
        ["1388675577778802748", { name: "Movie Tier III", color: 0xff5500 }],
        ["1388677466993987677", { name: "Movie Tier IV", color: 0xff0000 }],
        ["1201395606455562341", { name: "Server Artist", color: 0x77eeff }],
      ]),
      new Map([
        ["1446602187655610461", { name: "writing" }],
        ["1393507326865969152", { name: "yapping-space" }],
        ["896070889462976610", { name: "memes" }],
      ]),
    );
    const result = await refreshAllBadges(client as never, config);
    expect(result.resolved).toBeGreaterThan(0);
    const m = readManifest(config);
    expect(Object.keys(m.entries).length).toBeGreaterThan(0);
    expect(m.entries["movie-tier-1"].displayName).toBe("Movie Tier I");
    expect(fs.existsSync(path.join(config.generatedDir, "movie-tier-1.svg"))).toBe(true);
  });

  it("marks badges stale when guild lookup fails", async () => {
    const client = {
      isReady: () => true,
      users: { fetch: vi.fn(async () => null) },
      guilds: { cache: { get: () => undefined }, fetch: vi.fn(async () => { throw new Error("boom"); }) },
    };
    const result = await refreshAllBadges(client as never, config);
    expect(result.stale).toBeGreaterThan(0);
    expect(result.resolved).toBe(0);
  });

  it("no-ops when GUILD_ID missing", async () => {
    delete process.env.GUILD_ID;
    const client = { isReady: () => true } as never;
    const r = await refreshAllBadges(client, config);
    expect(r.resolved + r.stale).toBe(0);
  });
});
