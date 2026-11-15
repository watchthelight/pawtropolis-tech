/**
 * Pawtropolis Tech -- src/features/artistInvestigation/provenance/googleWeb.ts
 * WHAT: Reverse image lookup through Google's web detection (Cloud Vision,
 *       feature WEB_DETECTION).
 * WHY: Fluffle, e621 and SauceNAO only know the art archives they index.
 *      Google searches the open web, so it also finds a copy on a shop page, a
 *      forum or a pin board, and it lists pages that hold only a part of the
 *      image, which is how a crop or an edited copy turns up.
 *      It runs on the Google Vision key of the avatar scan. Google bills this
 *      feature per image, so mirrored copies are not searched and the report
 *      says how many images were sent.
 * NOTE: Google refused the production key when this was written (HTTP 403), so
 *       the success path follows Google's published response format and has
 *       not been run against the live service. The refusal has been.
 * DOCS:
 *  - https://cloud.google.com/vision/docs/detecting-web
 *  - https://cloud.google.com/vision/docs/reference/rest/v1/AnnotateImageResponse#WebDetection
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { VISION_ENDPOINT } from "../../googleVision.js";
import type { RawMatch } from "../types.js";
import {
  LookupError,
  asArray,
  asRecord,
  asString,
  httpError,
  isHttpUrl,
  lookupFetch,
  plainText,
  platformOf,
  readJson,
  tweetDate,
  type LookupService,
} from "./shared.js";

/** Pages asked for, and read, per image. */
const MAX_RESULTS = 10;
/** Copies of the file that are on none of the listed pages. A bare file link says little. */
const MAX_LOOSE_IMAGES = 4;

const imageUrls = (list: unknown): string[] =>
  asArray(list)
    .map((entry) => asRecord(entry).url)
    .filter(isHttpUrl);

/** Google names no artist and no date. The name check reads what the address gives away. */
function toMatch(sourceUrl: string, quality: "exact" | "probable", title: string | null): RawMatch {
  return {
    service: "google",
    sourceUrl,
    platform: platformOf(sourceUrl),
    uploader: null,
    artists: [],
    postedAt: tweetDate(sourceUrl),
    similarity: null,
    quality,
    title,
    tags: [],
    relatedUrls: [],
  };
}

/** A page with the whole image is "exact". One with a part of it or an edited copy is "probable". */
function pageMatch(raw: unknown): RawMatch | null {
  const page = asRecord(raw);
  if (!isHttpUrl(page.url)) return null;
  const whole = imageUrls(page.fullMatchingImages).length > 0;
  const title = plainText(asString(page.pageTitle) ?? "");
  return toMatch(page.url, whole ? "exact" : "probable", title || null);
}

/** The reason codes in a Google error body, such as ACCESS_DENIED. */
function reasonCodes(body: unknown): string[] {
  return asArray(asRecord(asRecord(body).error).details)
    .map((detail) => asRecord(detail).reason)
    .filter(
      (reason): reason is string =>
        typeof reason === "string" && /^[A-Z][A-Z0-9_]{2,48}$/.test(reason)
    );
}

export const googleWeb: LookupService = {
  name: "google",
  gapMs: 1_000,
  // A second query per image would double what Google bills.
  mirrored: false,
  unavailableReason: (settings) =>
    settings.googleVisionApiKey ? null : "no Google Vision key stored, set one with /service-keys",

  async search(image, { settings, pace }) {
    await pace();
    const res = await lookupFetch(VISION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.googleVisionApiKey ?? "",
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: image.bytes.toString("base64") },
            features: [{ type: "WEB_DETECTION", maxResults: MAX_RESULTS }],
          },
        ],
      }),
    });
    if (!res.ok) {
      // Google's own message can name the project behind the key. Only the
      // reason code is passed on: it is one of a fixed list of words.
      const reasons = reasonCodes(await res.json().catch(() => null));
      if (reasons.includes("API_KEY_INVALID"))
        throw new LookupError(`the API key is not valid (HTTP ${res.status})`, true);
      throw httpError(
        res,
        reasons.length > 0 ? `Google's reason: ${reasons.join(", ")}` : undefined
      );
    }

    const answer = asRecord(asArray(asRecord(await readJson(res)).responses)[0]);
    // A request can be accepted and the one image in it still fail.
    if (answer.error !== undefined) throw new LookupError("Google could not read the image");

    const web = asRecord(answer.webDetection);
    const pages = asArray(web.pagesWithMatchingImages).slice(0, MAX_RESULTS);
    const onPages = new Set(
      pages.flatMap((page) => [
        ...imageUrls(asRecord(page).fullMatchingImages),
        ...imageUrls(asRecord(page).partialMatchingImages),
      ])
    );
    const loose = imageUrls(web.fullMatchingImages)
      .filter((url) => !onPages.has(url))
      .slice(0, MAX_LOOSE_IMAGES);

    return [
      ...pages.map(pageMatch).filter((m): m is RawMatch => m !== null),
      ...loose.map((url) => toMatch(url, "exact", null)),
    ];
  },
};
