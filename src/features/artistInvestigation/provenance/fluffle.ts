/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/fluffle.ts
 * WHAT: Reverse image lookup through Fluffle (fluffle.xyz).
 * WHY: Fluffle indexes the galleries this community's artists post to
 *      (FurAffinity, Twitter/X, e621, Weasyl, DeviantArt and more) and offers a
 *      free API with no key. It asks for a descriptive User-Agent and one
 *      request at a time, which the pacer enforces.
 * DOCS:
 *  - https://fluffle.xyz/api (response shape checked live 2026-11-14)
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
  readJson,
  tweetDate,
  type LookupService,
} from "./shared.js";

const ENDPOINT = "https://api.fluffle.xyz/exact-search-by-file";

function toMatch(raw: unknown): RawMatch | null {
  const result = asRecord(raw);
  const label = asString(result.match);
  // "unlikely" results are Fluffle's own noise floor.
  if (label !== "exact" && label !== "probable") return null;
  if (!isHttpUrl(result.url)) return null;

  const platform = asString(result.platform)?.toLowerCase() ?? null;
  const authors = asArray(result.authors)
    .map((a) => asString(asRecord(a).name))
    .filter((name): name is string => name !== null);
  const distance = typeof result.distance === "number" ? result.distance : null;

  return {
    service: "fluffle",
    sourceUrl: result.url,
    platform,
    uploader: platform === "e621" ? null : (authors[0] ?? null),
    artists: authors,
    postedAt: tweetDate(result.url),
    // Fluffle reports closeness as 0 to 1, higher is closer.
    similarity: distance === null ? null : Math.round(distance * 1000) / 10,
    quality: label,
    title: null,
    tags: [],
    relatedUrls: [],
  };
}

export const fluffle: LookupService = {
  name: "fluffle",
  gapMs: 1_500,
  mirrored: true,
  unavailableReason: () => null,

  async search(image, { settings, pace }) {
    await pace();
    const form = multipartImage("File", image);
    form.append("Limit", "16");
    const res = await lookupFetch(ENDPOINT, {
      method: "POST",
      headers: { "User-Agent": settings.userAgent },
      body: form,
    });
    if (!res.ok) throw httpError(res);

    const body = asRecord(await readJson(res));
    return asArray(body.results)
      .map(toMatch)
      .filter((m): m is RawMatch => m !== null);
  },
};
