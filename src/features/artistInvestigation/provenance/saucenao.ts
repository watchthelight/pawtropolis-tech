/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/saucenao.ts
 * WHAT: Reverse image lookup through SauceNAO.
 * WHY: The mod handbook names SauceNAO as a supporting verification method. It
 *      covers Pixiv, DeviantArt, FurAffinity, Twitter/X and the booru sites in
 *      one query. The API needs an account key (anonymous calls get HTTP 403).
 *      The free tier is limited per 30 seconds and per day, so requests are
 *      spaced 8 seconds apart and mirrored copies are not searched.
 * NOTE: No key existed when this was written, so the success path follows
 *       SauceNAO's published JSON format and has not been run against the live
 *       service. Every field is read defensively for that reason.
 * DOCS:
 *  - https://saucenao.com/user.php?page=search-api
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { handleFromUrl } from "../handles.js";
import type { RawMatch } from "../types.js";
import {
  LookupError,
  asArray,
  asRecord,
  asString,
  httpError,
  isHttpUrl,
  lookupFetch,
  multipartImage,
  qualityFromScore,
  readJson,
  tweetDate,
  type LookupService,
} from "./shared.js";

const ENDPOINT = "https://saucenao.com/search.php";
const MIN_SIMILARITY = 65;

const stripHtml = (text: string) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

function platformOf(url: string): string | null {
  const known = handleFromUrl(url)?.platform;
  if (known) return known;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function toMatch(raw: unknown): RawMatch | null {
  const result = asRecord(raw);
  const header = asRecord(result.header);
  const data = asRecord(result.data);

  const similarity = Number(header.similarity);
  if (!Number.isFinite(similarity) || similarity < MIN_SIMILARITY) return null;

  const urls = asArray(data.ext_urls).filter(isHttpUrl);
  if (isHttpUrl(data.source)) urls.push(data.source);
  const [sourceUrl, ...relatedUrls] = [...new Set(urls)];
  if (!sourceUrl) return null;

  const creators = Array.isArray(data.creator) ? data.creator : [data.creator];
  const names = [
    data.member_name,
    data.author_name,
    data.twitter_user_handle,
    data.user_name,
    data.creator_name,
    data.artist,
    ...creators,
  ]
    .map(asString)
    .filter((name): name is string => name !== null);
  const artists = [...new Set(names)];

  return {
    service: "saucenao",
    sourceUrl,
    platform: platformOf(sourceUrl),
    uploader: artists[0] ?? null,
    artists,
    postedAt: isoDate(data.created_at) ?? isoDate(data.published) ?? tweetDate(sourceUrl),
    similarity: Math.round(similarity * 10) / 10,
    quality: qualityFromScore(similarity),
    title: asString(data.title) ?? asString(header.index_name),
    tags: [],
    relatedUrls: relatedUrls.slice(0, 6),
  };
}

export const saucenao: LookupService = {
  name: "saucenao",
  gapMs: 8_000,
  // A second query per image would spend the daily allowance twice as fast.
  mirrored: false,
  unavailableReason: (settings) =>
    settings.sauceNaoApiKey ? null : "no API key stored, set one with /service-keys",

  async search(image, { settings, pace }) {
    await pace();
    const query = new URLSearchParams({
      output_type: "2",
      db: "999",
      numres: "8",
      api_key: settings.sauceNaoApiKey ?? "",
    });
    const res = await lookupFetch(`${ENDPOINT}?${query}`, {
      method: "POST",
      headers: { "User-Agent": settings.userAgent },
      body: multipartImage("file", image),
    });
    if (!res.ok) throw httpError(res);

    const body = asRecord(await readJson(res));
    const header = asRecord(body.header);
    const status = Number(header.status ?? 0);
    // Below zero is a problem with the request or the account. Above zero means
    // some indexes were offline and the results that did come back are still good.
    if (status < 0)
      throw new LookupError(stripHtml(asString(header.message) ?? "request was refused"), true);

    return asArray(body.results)
      .map(toMatch)
      .filter((m): m is RawMatch => m !== null);
  },
};
