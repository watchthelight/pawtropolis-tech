/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/shared.ts
 * WHAT: What every reverse image lookup adapter shares: the service contract,
 *       request pacing, a fetch with a timeout, and one error type.
 * WHY: Each service has its own rate limit and its own way of failing. Pacing
 *      and error handling live here so an adapter is only "build the request,
 *      read the answer", and so one broken service cannot stall the others.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { LIMITS, type InvestigationSettings } from "../config.js";
import { handleFromUrl } from "../handles.js";
import type { ProvenanceServiceName, RawMatch } from "../types.js";

/** A lookup that did not produce an answer. `fatal` means retrying other images is pointless. */
export class LookupError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.name = "LookupError";
    this.fatal = fatal;
  }
}

/** The provenance stage's time allowance ran out before this request could start. */
export class OutOfTimeError extends Error {
  constructor() {
    super("ran out of time");
    this.name = "OutOfTimeError";
  }
}

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spaces requests to one service and stops handing out slots at the deadline. */
export class Pacer {
  private nextAt = 0;

  constructor(
    private readonly gapMs: number,
    private readonly deadlineMs: number,
    private readonly sleep: Sleep = realSleep,
    private readonly now: () => number = Date.now
  ) {}

  async wait(): Promise<void> {
    const slot = Math.max(this.now(), this.nextAt);
    if (slot >= this.deadlineMs) throw new OutOfTimeError();
    this.nextAt = slot + this.gapMs;
    const delay = slot - this.now();
    if (delay > 0) await this.sleep(delay);
  }
}

export interface LookupImage {
  bytes: Buffer;
  mediaType: string;
}

export interface LookupContext {
  settings: InvestigationSettings;
  /** Await before every HTTP request so the service's rate limit holds. */
  pace: () => Promise<void>;
}

export interface LookupService {
  name: ProvenanceServiceName;
  /** Shortest gap between requests, in milliseconds. */
  gapMs: number;
  /** Whether a mirrored copy gets its own query (finds flipped reposts). */
  mirrored: boolean;
  /** Why the service cannot run with these settings, or null when it can. */
  unavailableReason(settings: InvestigationSettings): string | null;
  search(image: LookupImage, context: LookupContext): Promise<RawMatch[]>;
}

/** fetch with a timeout. Network failures become LookupError with a short reason and no URL. */
export async function lookupFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(LIMITS.lookupTimeoutMs) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new LookupError(
      name === "TimeoutError" || name === "AbortError" ? "request timed out" : "network error"
    );
  }
}

/** Turn a non-2xx response into a LookupError. Auth and quota failures stop the service. */
export function httpError(res: Response, hint?: string): LookupError {
  const fatal = res.status === 401 || res.status === 403 || res.status === 429;
  const what =
    res.status === 401 || res.status === 403
      ? "credentials were rejected"
      : res.status === 429
        ? "rate limit reached"
        : res.status >= 500
          ? "service error"
          : "request was rejected";
  return new LookupError(`${what} (HTTP ${res.status})${hint ? `: ${hint}` : ""}`, fatal);
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new LookupError("answer was not valid JSON");
  }
}

export function multipartImage(field: string, image: LookupImage): FormData {
  const form = new FormData();
  form.append(
    field,
    new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }),
    "image.jpg"
  );
  return form;
}

/** Bucket a 0 to 100 similarity for services that do not label their own matches. */
export function qualityFromScore(score: number): "exact" | "probable" | "unlikely" {
  if (score >= 90) return "exact";
  if (score >= 70) return "probable";
  return "unlikely";
}

const TWITTER_EPOCH_MS = 1288834974657n;

/** Post time encoded in a Twitter/X status id. Null for other URLs and for pre-2010 ids. */
export function tweetDate(url: string): string | null {
  const id = url.match(
    /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/]+\/status\/(\d{15,20})/i
  )?.[1];
  if (!id) return null;
  const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH_MS);
  return ms < Date.now() + 86_400_000 ? new Date(ms).toISOString() : null;
}

/** Text a service sends with markup in it, as one short plain line. */
export const plainText = (text: string) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

/** The site a match sits on: a platform this command knows, else the host name. */
export function platformOf(url: string): string | null {
  const known = handleFromUrl(url)?.platform;
  if (known) return known;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : null;

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);
