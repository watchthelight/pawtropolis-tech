/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/e621.ts
 * WHAT: Reverse image lookup through e621's own similarity search, then a post
 *       lookup for artist tags, sources and upload dates.
 * WHY: e621 is the largest tagged archive of furry art. Its posts carry artist
 *      tags, original source links and dates, which is what a provenance check
 *      needs. The API is free with an account: requests are signed in, carry
 *      the account name in the User-Agent as e621 asks, and stay under one
 *      request a second.
 * DOCS:
 *  - https://e621.net/help/api (response shapes checked live 2026-11-14)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { RawMatch } from "../types.js";
import {
  asArray,
  asRecord,
  asString,
  httpError,
  isHttpUrl,
  lookupFetch,
  multipartImage,
  qualityFromScore,
  readJson,
  type LookupContext,
  type LookupService,
} from "./shared.js";

const BASE = "https://e621.net";
const MIN_SCORE = 70;
const MAX_POSTS = 6;

/** Artist-category tags that are bookkeeping, not people. */
const NOT_ARTISTS = new Set([
  "unknown_artist",
  "unknown_artist_signature",
  "anonymous_artist",
  "conditional_dnp",
  "avoid_posting",
  "third-party_edit",
  "sound_warning",
  "epilepsy_warning",
  "jumpscare_warning",
]);

/** Tags that matter for the base, edit and AI questions. Everything else is left out. */
const RELEVANT_TAG =
  /base|ych|template|adopt|lineart|line_art|edit|trace|recolor|ai_generated|ai_assisted|commission|collaboration|sketch|wip|unfinished/;

function headers({ settings }: LookupContext): Record<string, string> {
  const login = settings.e621Login ?? "";
  const token = Buffer.from(`${login}:${settings.e621ApiKey ?? ""}`).toString("base64");
  return {
    "User-Agent": `${settings.userAgent} (by ${login} on e621)`,
    Authorization: `Basic ${token}`,
  };
}

interface Hit {
  id: string;
  score: number;
  /** Fallback fields from the similarity answer, used when the post lookup fails. */
  createdAt: string | null;
  sources: string[];
}

function toHit(raw: unknown): Hit | null {
  const entry = asRecord(raw);
  const id = asString(entry.post_id);
  const score = typeof entry.score === "number" ? entry.score : Number(entry.score);
  if (!id || !Number.isFinite(score) || score < MIN_SCORE) return null;
  const post = asRecord(asRecord(entry.post).posts);
  return {
    id,
    score,
    createdAt: asString(post.created_at),
    sources: (asString(post.source) ?? "").split(/\s+/).filter(isHttpUrl),
  };
}

function toMatch(hit: Hit, rawPost: unknown): RawMatch {
  const post = asRecord(rawPost);
  const tags = asRecord(post.tags);
  const tagList = (category: string) =>
    asArray(tags[category]).filter((t): t is string => typeof t === "string");
  const sources = asArray(post.sources).filter(isHttpUrl);

  return {
    service: "e621",
    sourceUrl: `${BASE}/posts/${hit.id}`,
    platform: "e621",
    uploader: asString(post.uploader_name),
    artists: tagList("artist").filter((t) => !NOT_ARTISTS.has(t)),
    postedAt: asString(post.created_at) ?? hit.createdAt,
    similarity: Math.round(hit.score * 10) / 10,
    quality: qualityFromScore(hit.score),
    title: null,
    tags: [...tagList("general"), ...tagList("meta"), ...tagList("lore")]
      .filter((t) => RELEVANT_TAG.test(t))
      .slice(0, 12),
    relatedUrls: (sources.length > 0 ? sources : hit.sources).slice(0, 6),
  };
}

export const e621: LookupService = {
  name: "e621",
  gapMs: 1_100,
  mirrored: true,
  unavailableReason: (settings) =>
    settings.e621Login && settings.e621ApiKey
      ? null
      : "no account name and API key stored, set them with /service-keys",

  async search(image, context) {
    await context.pace();
    const similar = await lookupFetch(`${BASE}/iqdb_queries.json`, {
      method: "POST",
      headers: headers(context),
      body: multipartImage("search[file]", image),
    });
    if (!similar.ok) throw httpError(similar);

    // An array of hits when there are any; an object when there are none.
    const hits = asArray(await readJson(similar))
      .map(toHit)
      .filter((h): h is Hit => h !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_POSTS);
    if (hits.length === 0) return [];

    // The similarity answer has no artist tags or uploader name, so read the posts themselves.
    let posts: unknown[] = [];
    try {
      await context.pace();
      const lookup = await lookupFetch(
        `${BASE}/posts.json?limit=${MAX_POSTS}&tags=${encodeURIComponent(`id:${hits.map((h) => h.id).join(",")}`)}`,
        { headers: headers(context) }
      );
      if (lookup.ok) posts = asArray(asRecord(await readJson(lookup)).posts);
    } catch {
      // Keep the hits. They still carry a link, a score, a date and source links.
    }

    return hits.map((hit) =>
      toMatch(
        hit,
        posts.find((p) => asString(asRecord(p).id) === hit.id)
      )
    );
  },
};
