// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  manifestEntryUrl,
  readBadgeSvg,
  readManifest,
  svgPathFor,
  upsertManifestEntry,
  writeBadgeSvg,
  writeManifest,
} from "../../../src/features/badges/store.js";
import type {
  BadgeManifestEntry,
  BadgeStoreConfig,
} from "../../../src/features/badges/types.js";

let dir: string;
let config: BadgeStoreConfig;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "badges-test-"));
  config = {
    manifestPath: path.join(dir, "manifest.json"),
    generatedDir: path.join(dir, "generated"),
    baseUrl: "https://example.test",
  };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(id: string): BadgeManifestEntry {
  return {
    id,
    kind: "role",
    guildId: "g",
    discordId: "1",
    displayName: "Test",
    prefix: "@",
    colorHex: "#5865F2",
    backgroundHex: "#3A3A3A",
    foregroundHex: "#FFFFFF",
    stale: false,
    resolvedAt: new Date().toISOString(),
    style: "discord-role",
    url: "https://example.test/badges/" + id + ".svg",
    generatedAt: new Date().toISOString(),
  };
}

describe("svgPathFor", () => {
  it("rejects unsafe ids", () => {
    expect(() => svgPathFor(config, "../etc")).toThrow();
    expect(() => svgPathFor(config, "a/b")).toThrow();
    expect(() => svgPathFor(config, "")).toThrow();
  });
  it("joins under generated dir", () => {
    const p = svgPathFor(config, "movie-tier-1");
    expect(p.startsWith(path.resolve(config.generatedDir))).toBe(true);
    expect(p.endsWith("movie-tier-1.svg")).toBe(true);
  });
});

describe("writeBadgeSvg + readBadgeSvg", () => {
  it("round-trips an SVG string", () => {
    writeBadgeSvg(config, "movie-tier-1", "<svg/>");
    expect(readBadgeSvg(config, "movie-tier-1")).toBe("<svg/>");
  });
  it("returns null for missing files", () => {
    expect(readBadgeSvg(config, "movie-tier-1")).toBeNull();
  });
});

describe("manifest IO", () => {
  it("returns an empty manifest when file missing", () => {
    const m = readManifest(config);
    expect(m.schemaVersion).toBe(1);
    expect(m.entries).toEqual({});
  });

  it("upserts entries and round-trips", () => {
    let m = readManifest(config);
    m = upsertManifestEntry(m, entry("movie-tier-1"));
    writeManifest(config, m);
    const m2 = readManifest(config);
    expect(m2.entries["movie-tier-1"].displayName).toBe("Test");
  });
});

describe("manifestEntryUrl", () => {
  it("builds a stable url under baseUrl", () => {
    expect(manifestEntryUrl(config, "movie-tier-1")).toBe(
      "https://example.test/badges/movie-tier-1.svg",
    );
  });
  it("strips trailing slash on baseUrl", () => {
    const c = { ...config, baseUrl: "https://example.test/" };
    expect(manifestEntryUrl(c, "x")).toBe("https://example.test/badges/x.svg");
  });
});
