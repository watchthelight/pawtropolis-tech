// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  attachBadgeLiveListeners,
  _resetForTests,
} from "../../../src/features/badges/liveUpdates.js";
import { readManifest } from "../../../src/features/badges/store.js";
import type { BadgeStoreConfig } from "../../../src/features/badges/types.js";

let dir: string;
let config: BadgeStoreConfig;
const ORIGINAL_GUILD_ID = process.env.GUILD_ID;

beforeEach(() => {
  vi.useFakeTimers();
  _resetForTests();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "badges-live-"));
  config = {
    manifestPath: path.join(dir, "manifest.json"),
    generatedDir: path.join(dir, "generated"),
    baseUrl: "https://example.test",
  };
  process.env.GUILD_ID = "guild-1";
});

afterEach(() => {
  vi.useRealTimers();
  _resetForTests();
  fs.rmSync(dir, { recursive: true, force: true });
  if (ORIGINAL_GUILD_ID === undefined) delete process.env.GUILD_ID;
  else process.env.GUILD_ID = ORIGINAL_GUILD_ID;
});

function makeClient(roleData: Map<string, { name: string; color: number }>) {
  const ee = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const guild = {
    roles: { cache: roleData, fetch: vi.fn() },
    channels: { cache: new Map(), fetch: vi.fn(async () => null) },
  };
  Object.assign(ee, {
    isReady: () => true,
    users: { fetch: vi.fn() },
    guilds: { cache: { get: () => guild }, fetch: vi.fn(async () => guild) },
  });
  return ee;
}

describe("attachBadgeLiveListeners", () => {
  it("debounces and refreshes a single badge on roleUpdate", async () => {
    const roles = new Map([
      ["1388676461657063505", { name: "Red Carpet Guest Renamed", color: 0xff00aa }],
    ]);
    const client = makeClient(roles);
    attachBadgeLiveListeners(client as never, config);
    client.emit("roleUpdate", { id: "1388676461657063505" }, { id: "1388676461657063505" });
    client.emit("roleUpdate", { id: "1388676461657063505" }, { id: "1388676461657063505" });
    await vi.advanceTimersByTimeAsync(2000);
    const m = readManifest(config);
    expect(m.entries["movie-tier-1"]?.displayName).toBe("Red Carpet Guest Renamed");
    expect(m.entries["movie-tier-1"]?.colorHex).toBe("#FF00AA");
  });

  it("ignores events for non-registered IDs", async () => {
    const client = makeClient(new Map());
    attachBadgeLiveListeners(client as never, config);
    client.emit("roleUpdate", { id: "9999" }, { id: "9999" });
    await vi.advanceTimersByTimeAsync(2000);
    const m = readManifest(config);
    expect(Object.keys(m.entries)).toHaveLength(0);
  });
});
