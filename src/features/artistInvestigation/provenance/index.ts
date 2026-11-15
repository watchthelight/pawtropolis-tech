/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/index.ts
 * WHAT: Runs every submitted image through the lookup services and turns the
 *       raw hits into matches labeled against the applicant.
 * WHY: Services run side by side, each at its own pace, and each failure stays
 *      inside its own service: a dead site, a missing key or a spent quota is
 *      reported by name and the rest of the run carries on.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../../../lib/logger.js";
import { LIMITS, type InvestigationSettings } from "../config.js";
import { classifyOwnership } from "../handles.js";
import type {
  ClaimedHandle,
  ImageVariant,
  PreparedImage,
  ProvenanceMatch,
  ProvenanceResult,
  RawMatch,
  ServiceReport,
} from "../types.js";
import { readCache, writeCache } from "./cache.js";
import { e621 } from "./e621.js";
import { fluffle } from "./fluffle.js";
import { googleWeb } from "./googleWeb.js";
import { saucenao } from "./saucenao.js";
import { LookupError, OutOfTimeError, Pacer, type LookupService, type Sleep } from "./shared.js";

export const LOOKUP_SERVICES: readonly LookupService[] = [fluffle, e621, saucenao, googleWeb];

export interface ProvenanceContext {
  settings: InvestigationSettings;
  handles: ClaimedHandle[];
  /** When the applicant's Discord account was created. Null when unknown. */
  accountCreatedAtMs: number | null;
}

export interface ProvenanceDeps {
  db: Database;
  services?: readonly LookupService[];
  sleep?: Sleep;
  now?: () => number;
}

interface Hit {
  imageKey: string;
  variant: ImageVariant;
  match: RawMatch;
}

const BASE_WORDS =
  /\b(?:bases?|f2u|p2u|ych|your[ _]character[ _]here|template|line[ _]?art|adopt(?:able)?s?|free[ _]to[ _]use|pay[ _]to[ _]use)\b/i;

/** Signs in a match's own title and tags that the artwork is, or is built on, a base. */
export function baseHints(match: RawMatch): string[] {
  const hints: string[] = [];
  if (match.title && BASE_WORDS.test(match.title))
    hints.push(`source title mentions a base: "${match.title.slice(0, 80)}"`);
  const tagged = match.tags.filter((tag) => BASE_WORDS.test(tag.replace(/_/g, " ")));
  if (tagged.length > 0) hints.push(`source is tagged ${tagged.slice(0, 4).join(", ")}`);
  return hints;
}

export function annotateMatch(hit: Hit, context: ProvenanceContext): ProvenanceMatch {
  const { ownership, matchedHandle } = classifyOwnership(hit.match, context.handles);
  const postedMs = hit.match.postedAt ? Date.parse(hit.match.postedAt) : Number.NaN;
  const hints = baseHints(hit.match);
  if (hit.variant === "mirrored")
    hints.push("found only when the image was mirrored, so the submission may be a flipped copy");

  return {
    ...hit.match,
    imageKey: hit.imageKey,
    variant: hit.variant,
    ownership,
    matchedHandle,
    predatesAccount:
      Number.isNaN(postedMs) || context.accountCreatedAtMs === null
        ? null
        : postedMs < context.accountCreatedAtMs,
    baseHints: hints,
  };
}

const canonicalUrl = (url: string) =>
  url
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.|mobile\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

const QUALITY_RANK = { exact: 0, probable: 1, unlikely: 2 } as const;

const isGoogle = (hit: Hit) => hit.match.service === "google";

/** One entry per source per image, best first, originals ahead of mirrored copies. */
function dedupeAndRank(hits: Hit[]): { kept: Hit[]; omitted: number } {
  const best = new Map<string, Hit>();
  for (const hit of hits) {
    const key = `${hit.imageKey}|${canonicalUrl(hit.match.sourceUrl)}`;
    const current = best.get(key);
    // When Google and an art archive find the same page, the archive's entry
    // stays: it names the artist, and it knows whether only the mirrored copy matched.
    const better =
      !current ||
      (isGoogle(current) && !isGoogle(hit)) ||
      (isGoogle(current) === isGoogle(hit) &&
        ((current.variant === "mirrored" && hit.variant === "original") ||
          (current.variant === hit.variant &&
            !current.match.postedAt &&
            hit.match.postedAt !== null)));
    if (better) best.set(key, hit);
  }
  const rank = (hit: Hit) => (hit.match.quality ? QUALITY_RANK[hit.match.quality] : 1);
  const byStrength = [...best.values()].sort(
    (a, b) => rank(a) - rank(b) || (b.match.similarity ?? 0) - (a.match.similarity ?? 0)
  );

  // Google names no artist, and a picture that is all over the web brings a page
  // for every copy. Past its first few matches for an image the rest go behind
  // everything else, so they cannot push the art archives' matches off the list.
  const googleCount = new Map<string, number>();
  const front: Hit[] = [];
  const back: Hit[] = [];
  for (const hit of byStrength) {
    if (!isGoogle(hit)) {
      front.push(hit);
      continue;
    }
    const count = (googleCount.get(hit.imageKey) ?? 0) + 1;
    googleCount.set(hit.imageKey, count);
    (count > LIMITS.googleMatchesPerImage ? back : front).push(hit);
  }
  const ranked = [...front, ...back];

  const perImage = new Map<string, number>();
  const kept = ranked.filter((hit) => {
    const count = perImage.get(hit.imageKey) ?? 0;
    perImage.set(hit.imageKey, count + 1);
    return count < LIMITS.matchesPerQuery;
  });
  return { kept, omitted: ranked.length - kept.length };
}

async function runService(
  service: LookupService,
  images: PreparedImage[],
  context: ProvenanceContext,
  deps: Required<Pick<ProvenanceDeps, "db" | "sleep" | "now">>,
  deadlineMs: number
): Promise<{ report: ServiceReport; hits: Hit[] }> {
  const report: ServiceReport = {
    service: service.name,
    status: "ok",
    detail: null,
    queries: 0,
    cacheHits: 0,
    matches: 0,
  };
  const hits: Hit[] = [];

  const unavailable = service.unavailableReason(context.settings);
  if (unavailable) return { report: { ...report, status: "skipped", detail: unavailable }, hits };

  const pacer = new Pacer(service.gapMs, deadlineMs, deps.sleep, deps.now);
  const variants: ImageVariant[] = service.mirrored ? ["original", "mirrored"] : ["original"];
  const plan = variants.flatMap((variant) => images.map((image) => ({ image, variant })));

  let completed = 0;
  let failuresInARow = 0;
  let problem: string | null = null;

  for (const { image, variant } of plan) {
    const cached = readCache(deps.db, image.sha256, service.name, variant, deps.now());
    if (cached) {
      report.cacheHits++;
      completed++;
      hits.push(...cached.map((match) => ({ imageKey: image.key, variant, match })));
      continue;
    }
    try {
      const matches = await service.search(
        {
          bytes: variant === "original" ? image.lookupBytes : image.lookupMirroredBytes,
          mediaType: image.lookupMediaType,
        },
        { settings: context.settings, pace: () => pacer.wait() }
      );
      report.queries++;
      completed++;
      failuresInARow = 0;
      writeCache(deps.db, image.sha256, service.name, variant, matches, deps.now());
      hits.push(...matches.map((match) => ({ imageKey: image.key, variant, match })));
    } catch (err) {
      if (err instanceof OutOfTimeError) {
        problem = "ran out of time";
        break;
      }
      const fatal = err instanceof LookupError && err.fatal;
      problem = err instanceof LookupError ? err.message : "unexpected error";
      failuresInARow++;
      logger.warn({ service: service.name, problem, fatal }, "[investigate-artist] lookup failed");
      if (fatal || failuresInARow >= 2) break;
    }
  }

  if (completed < plan.length) {
    report.status = completed === 0 ? "failed" : "partial";
    report.detail = `${completed} of ${plan.length} lookups finished${problem ? `: ${problem}` : ""}`;
  }
  return { report, hits };
}

export async function runProvenance(
  images: PreparedImage[],
  context: ProvenanceContext,
  deps: ProvenanceDeps
): Promise<ProvenanceResult> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadlineMs = now() + LIMITS.provenanceBudgetMs;

  const results = await Promise.all(
    (deps.services ?? LOOKUP_SERVICES).map((service) =>
      runService(service, images, context, { db: deps.db, sleep, now }, deadlineMs)
    )
  );

  const { kept, omitted } = dedupeAndRank(results.flatMap((r) => r.hits));
  const matches = kept.map((hit) => annotateMatch(hit, context));

  // The same source turning up under two different submissions is worth a look:
  // duplicates, or two "characters" on one base.
  const imagesBySource = new Map<string, Set<string>>();
  for (const match of matches) {
    const key = canonicalUrl(match.sourceUrl);
    imagesBySource.set(key, (imagesBySource.get(key) ?? new Set()).add(match.imageKey));
  }
  for (const match of matches) {
    const others = [...(imagesBySource.get(canonicalUrl(match.sourceUrl)) ?? [])].filter(
      (k) => k !== match.imageKey
    );
    if (others.length > 0)
      match.baseHints.push(`the same source also matches ${others.join(", ")}`);
  }

  const services = results.map(({ report }) => ({
    ...report,
    matches: matches.filter((m) => m.service === report.service).length,
  }));
  return { matches, services, omitted };
}
