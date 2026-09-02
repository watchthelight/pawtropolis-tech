// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/web/badgeEndpoint.ts
 * WHAT: Public HTTP endpoint that serves pre-rendered Discord badge SVGs and
 *       a JSON manifest. Designed to sit behind status.pawtropolis.tech.
 * WHY: GitHub Markdown can embed SVG via <img>. We render badges off-line on
 *      a daily refresh and stream the SVG file from disk; a fallback render
 *      runs on cache misses.
 *
 * Routes:
 *   GET /badges/:badgeId.svg                   public, cacheable
 *   GET /badges/roles/:roleId.svg              direct ID; off by default
 *   GET /badges/channels/:channelId.svg        direct ID; off by default
 *   GET /badges/users/:userId.svg              direct ID; off by default
 *   GET /api/badges/manifest.json              public listing
 *   GET /api/badges/health                     liveness JSON
 *
 * The handler is exported separately from server boot so it can be unit-tested
 * without binding a port.
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { logger } from "../lib/logger.js";
import {
  BADGE_REGISTRY,
  defaultStoreConfig,
  getBadgeDefinition,
  isSafeBadgeId,
  readBadgeSvg,
  readManifest,
  renderBadgeSvg,
  renderUnknownBadgeSvg,
  svgPathFor,
} from "../features/badges/index.js";
import type { BadgeManifest, BadgeStoreConfig } from "../features/badges/index.js";

// Rendered files are served from memory and revalidated with one stat() per request
// instead of a full read plus a SHA-256 per request. The daily refresh and the live
// listeners rewrite the files in place, which moves the mtime and refills the entry.
const svgCache = new Map<string, { mtimeMs: number; body: string; etag: string }>();
let manifestCache: { mtimeMs: number; manifest: BadgeManifest } | null = null;

function cachedSvg(
  config: BadgeStoreConfig,
  badgeId: string,
): { body: string; etag: string } | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(svgPathFor(config, badgeId)).mtimeMs;
  } catch {
    return null;
  }
  const hit = svgCache.get(badgeId);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  const body = readBadgeSvg(config, badgeId);
  if (!body) return null;
  const entry = { mtimeMs, body, etag: etagFor(body) };
  svgCache.set(badgeId, entry);
  return entry;
}

function cachedManifest(config: BadgeStoreConfig): BadgeManifest {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(config.manifestPath).mtimeMs;
  } catch {
    // Missing manifest: readManifest returns the empty shape; do not cache it.
    return readManifest(config);
  }
  if (manifestCache && manifestCache.mtimeMs === mtimeMs) return manifestCache.manifest;
  const manifest = readManifest(config);
  manifestCache = { mtimeMs, manifest };
  return manifest;
}

const BADGE_PORT = parseInt(process.env.BADGE_PORT ?? "3004", 10);
const BADGE_ENDPOINT_ENABLED =
  (process.env.BADGE_ENDPOINT_ENABLED ?? "true").toLowerCase() !== "false";
const ALLOW_DIRECT_ID_ROUTES =
  (process.env.BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES ?? "false").toLowerCase() ===
  "true";

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
};
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
};

function etagFor(body: string): string {
  return '"' + crypto.createHash("sha256").update(body).digest("hex").slice(0, 16) + '"';
}

function sendSvg(
  res: http.ServerResponse,
  body: string,
  status = 200,
  ifNoneMatch?: string,
  precomputedEtag?: string,
): void {
  const etag = precomputedEtag ?? etagFor(body);
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(status, { ...SVG_HEADERS, ETag: etag });
  res.end(body);
}

function sendJson(
  res: http.ServerResponse,
  payload: unknown,
  status = 200,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, JSON_HEADERS);
  res.end(body);
}

function fallbackSvgFor(label: string): string {
  return renderUnknownBadgeSvg(label);
}

function tryServeRegistryBadge(
  config: BadgeStoreConfig,
  badgeId: string,
  ifNoneMatch: string | undefined,
  res: http.ServerResponse,
): boolean {
  const def = getBadgeDefinition(badgeId);
  if (!def) return false;
  const cached = cachedSvg(config, badgeId);
  if (cached) {
    sendSvg(res, cached.body, 200, ifNoneMatch, cached.etag);
    return true;
  }
  const manifest = cachedManifest(config);
  const entry = manifest.entries[badgeId];
  if (entry) {
    const svg = renderBadgeSvg(entry);
    sendSvg(res, svg, 200, ifNoneMatch);
    return true;
  }
  sendSvg(res, fallbackSvgFor(badgeId), 200, ifNoneMatch);
  return true;
}

export function handleBadgeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: BadgeStoreConfig = defaultStoreConfig(),
): boolean {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return true;
  }
  if (req.method !== "GET") return false;

  const url = new URL(req.url ?? "/", `http://localhost:${BADGE_PORT}`);
  const pathname = url.pathname;
  const ifNoneMatch = req.headers["if-none-match"] as string | undefined;

  if (pathname === "/api/badges/health") {
    sendJson(res, {
      status: "ok",
      enabled: BADGE_ENDPOINT_ENABLED,
      directIdRoutes: ALLOW_DIRECT_ID_ROUTES,
      registrySize: BADGE_REGISTRY.length,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (pathname === "/api/badges/manifest.json") {
    sendJson(res, cachedManifest(config));
    return true;
  }

  const registryMatch = /^\/badges\/([a-z0-9_-]+)\.svg$/.exec(pathname);
  if (registryMatch) {
    const badgeId = registryMatch[1]!;
    if (!isSafeBadgeId(badgeId)) {
      sendSvg(res, fallbackSvgFor("invalid id"), 200);
      return true;
    }
    if (tryServeRegistryBadge(config, badgeId, ifNoneMatch, res)) return true;
    if (!ALLOW_DIRECT_ID_ROUTES) {
      sendSvg(res, fallbackSvgFor(badgeId), 200);
      return true;
    }
  }

  const directMatch = /^\/badges\/(roles|channels|users)\/([0-9]{5,30})\.svg$/.exec(
    pathname,
  );
  if (directMatch) {
    if (!ALLOW_DIRECT_ID_ROUTES) {
      sendJson(res, { error: "direct_id_routes_disabled" }, 404);
      return true;
    }
    const [, kind, discordId] = directMatch;
    const synthId = `${kind === "roles" ? "role" : kind === "channels" ? "channel" : "user"}-${discordId}`;
    if (!isSafeBadgeId(synthId)) {
      sendSvg(res, fallbackSvgFor("invalid id"), 200);
      return true;
    }
    const manifest = cachedManifest(config);
    const entry =
      manifest.entries[synthId] ??
      Object.values(manifest.entries).find((e) => e.discordId === discordId);
    if (entry) {
      sendSvg(res, renderBadgeSvg(entry), 200, ifNoneMatch);
      return true;
    }
    sendSvg(res, fallbackSvgFor(`unknown ${kind!.slice(0, -1)}`), 200);
    return true;
  }

  return false;
}

let server: http.Server | null = null;

export function startBadgeServer(
  config: BadgeStoreConfig = defaultStoreConfig(),
): http.Server | null {
  if (!BADGE_ENDPOINT_ENABLED) {
    logger.info("[badges] endpoint disabled via BADGE_ENDPOINT_ENABLED=false");
    return null;
  }
  server = http.createServer((req, res) => {
    const handled = handleBadgeRequest(req, res, config);
    if (handled) return;
    res.writeHead(404, JSON_HEADERS);
    res.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(BADGE_PORT, () => {
    logger.info({ port: BADGE_PORT }, "[badges] endpoint started");
  });
  server.on("error", (err) => {
    logger.error({ err, port: BADGE_PORT }, "[badges] endpoint error");
  });
  return server;
}

export function stopBadgeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
}

export function getBadgePort(): number {
  return BADGE_PORT;
}
