// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/store.ts
 * WHAT: Filesystem persistence for the badge manifest and generated SVGs.
 * WHY: We pre-render SVG on the daily refresh and serve them straight from
 *      disk. The manifest is the source of truth for what we know about
 *      each badge; the generated SVGs are cache files we can rebuild on
 *      demand from the manifest.
 *
 * Safety: badge ids are validated by isSafeBadgeId before being used as
 * filenames; the joined path is always re-checked against the configured
 * generated directory to refuse traversal attempts.
 */

import fs from "node:fs";
import path from "node:path";
import { isSafeBadgeId } from "./svgEscape.js";
import type { BadgeManifest, BadgeManifestEntry } from "./types.js";

export type BadgeStoreConfig = {
  manifestPath: string;
  generatedDir: string;
  baseUrl: string;
};

const DEFAULT_BASE_URL = "https://status.pawtropolis.tech";

export function defaultStoreConfig(): BadgeStoreConfig {
  return {
    manifestPath:
      process.env.BADGE_MANIFEST_PATH || "data/badges/manifest.json",
    generatedDir:
      process.env.BADGE_GENERATED_DIR || "data/badges/generated",
    baseUrl: process.env.PUBLIC_BADGE_BASE_URL || DEFAULT_BASE_URL,
  };
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function safePathJoin(rootDir: string, fileName: string): string {
  const resolved = path.resolve(rootDir, fileName);
  const root = path.resolve(rootDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("badge path escapes generated directory");
  }
  return resolved;
}

export function svgPathFor(config: BadgeStoreConfig, badgeId: string): string {
  if (!isSafeBadgeId(badgeId)) {
    throw new Error(`unsafe badge id: ${badgeId}`);
  }
  return safePathJoin(config.generatedDir, `${badgeId}.svg`);
}

export function writeBadgeSvg(
  config: BadgeStoreConfig,
  badgeId: string,
  svg: string,
): void {
  ensureDir(config.generatedDir);
  const target = svgPathFor(config, badgeId);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, svg, "utf8");
  fs.renameSync(tmp, target);
}

export function readBadgeSvg(
  config: BadgeStoreConfig,
  badgeId: string,
): string | null {
  try {
    const p = svgPathFor(config, badgeId);
    return fs.readFileSync(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function readManifest(config: BadgeStoreConfig): BadgeManifest {
  try {
    const raw = fs.readFileSync(config.manifestPath, "utf8");
    const parsed = JSON.parse(raw) as BadgeManifest;
    if (parsed && parsed.schemaVersion === 1 && parsed.entries) return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // fall through to empty manifest; do not crash callers
    }
  }
  return {
    schemaVersion: 1,
    baseUrl: config.baseUrl,
    generatedAt: new Date(0).toISOString(),
    entries: {},
  };
}

export function writeManifest(
  config: BadgeStoreConfig,
  manifest: BadgeManifest,
): void {
  ensureDir(path.dirname(config.manifestPath));
  const tmp = `${config.manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmp, config.manifestPath);
}

export function manifestEntryUrl(
  config: BadgeStoreConfig,
  badgeId: string,
): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  return `${base}/badges/${badgeId}.svg`;
}

/** Fields that move on every run whether or not the badge itself changed. */
const VOLATILE_FIELDS = new Set(["generatedAt", "resolvedAt"]);

/** JSON with object keys sorted, so key order from disk cannot fake a difference. */
function stableShape(value: unknown): string {
  return JSON.stringify(value, (key, val) => {
    if (VOLATILE_FIELDS.has(key)) return undefined;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return val;
  });
}

/**
 * Add or replace one badge, leaving the manifest untouched when nothing real changed.
 *
 * The two timestamps move on every run, so writing them unconditionally made the
 * manifest a new file each time. The nightly refresh workflow then always had a diff to
 * commit, for badges that were byte-identical.
 */
export function upsertManifestEntry(
  manifest: BadgeManifest,
  entry: BadgeManifestEntry,
): BadgeManifest {
  const existing = manifest.entries[entry.id];
  if (existing && stableShape(existing) === stableShape(entry)) return manifest;

  return {
    ...manifest,
    generatedAt: new Date().toISOString(),
    entries: { ...manifest.entries, [entry.id]: entry },
  };
}
