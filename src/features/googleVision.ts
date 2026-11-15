/**
 * Google Cloud Vision API integration for NSFW detection
 * Specifically handles cartoon/anime/furry content better than WD v3
 *
 * SafeSearch Detection is FREE when bundled with Label Detection
 * Pricing: First 1000 requests/month free, then $1.50 per 1000
 */

import { logger } from "../lib/logger.js";
import { classifyError, shouldReportToSentry, errorContext } from "../lib/errors.js";
import { captureException } from "../lib/sentry.js";

type SafeSearchLikelihood = "UNKNOWN" | "VERY_UNLIKELY" | "UNLIKELY" | "POSSIBLE" | "LIKELY" | "VERY_LIKELY";

type SafeSearchAnnotation = {
  adult: SafeSearchLikelihood;
  spoof: SafeSearchLikelihood;
  medical: SafeSearchLikelihood;
  violence: SafeSearchLikelihood;
  racy: SafeSearchLikelihood;
};

type VisionResult = {
  adultScore: number;      // 0-1 probability
  racyScore: number;       // 0-1 probability (suggestive content)
  violenceScore: number;   // 0-1 probability
  raw: SafeSearchAnnotation;
};

/** Google Vision API response shape */
type VisionAPIResponse = {
  responses?: Array<{
    safeSearchAnnotation?: SafeSearchAnnotation;
  }>;
};

export const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

// No key means this detection layer is skipped. The key is read on every call,
// so one set or removed with /service-keys counts from the next scan on.
function visionKey(): string | null {
  return process.env.GOOGLE_VISION_API_KEY?.trim() || null;
}

/**
 * Maps Google's categorical likelihood enum to numeric probability.
 * These mappings are somewhat arbitrary - Google doesn't publish exact percentages.
 * We use conservative estimates that err toward flagging suspicious content.
 *
 * POSSIBLE at 0.5 is the "maybe" threshold - warrants human review.
 */
function likelihoodToScore(likelihood: SafeSearchLikelihood): number {
  // These numbers are vibes. Google won't tell us what they actually mean.
  // If you're wondering why POSSIBLE is 0.5: coin flip. That's the logic.
  switch (likelihood) {
    case "VERY_UNLIKELY": return 0.0;
    case "UNLIKELY": return 0.2;
    case "POSSIBLE": return 0.5;
    case "LIKELY": return 0.8;
    case "VERY_LIKELY": return 1.0;
    default: return 0.0;  // UNKNOWN treated as safe - fail open
  }
}

/**
 * Detect NSFW content using Google Cloud Vision SafeSearch API
 * Works well with cartoon/anime/hentai/furry content
 *
 * @param imageUrl - Public URL to the image
 * @returns VisionResult with adult/racy/violence scores (0-1)
 */
// A 403 (billing disabled, key revoked) or 429 answers every image the same way for hours.
// Production logged 9,400 identical warnings in four months, one per member join, each
// after a full round trip. Pause the vendor after the first one instead.
const REJECTION_PAUSE_MS = 6 * 60 * 60 * 1000;
let pausedUntil = 0;

export async function detectNsfwVision(imageUrl: string): Promise<VisionResult | null> {
  const apiKey = visionKey();
  if (!apiKey) {
    return null;
  }
  if (Date.now() < pausedUntil) {
    return null;
  }

  try {
    // Direct REST API call - simpler than SDK for API key auth.
    // Security: API key passed via X-Goog-Api-Key header instead of URL query param
    // to prevent accidental exposure in logs, browser history, or referrer headers.
    const endpoint = VISION_ENDPOINT;

    // We request both SAFE_SEARCH_DETECTION and LABEL_DETECTION.
    // This is a pricing optimization: SafeSearch is FREE when bundled with
    // any other detection type. Label detection is the cheapest add-on.
    // Yes, we're paying for labels we throw away. Google's pricing is weird.
    const requestBody = {
      requests: [
        {
          image: {
            source: {
              imageUri: imageUrl  // Must be publicly accessible URL
            }
          },
          features: [
            {
              type: "SAFE_SEARCH_DETECTION",
              maxResults: 1
            },
            {
              type: "LABEL_DETECTION",
              maxResults: 1  // We don't use labels, just need it for free SafeSearch
            }
          ]
        }
      ]
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 403 || response.status === 429) {
        pausedUntil = Date.now() + REJECTION_PAUSE_MS;
        logger.warn(
          { status: response.status, error: errorText.slice(0, 400), pausedForMs: REJECTION_PAUSE_MS },
          "[googleVision] API rejected the request; avatar scans paused"
        );
      } else {
        logger.warn({ status: response.status, error: errorText }, "[googleVision] API request failed");
      }
      return null;
    }

    const data = await response.json() as VisionAPIResponse;

    if (!data.responses || !data.responses[0]) {
      logger.warn({ data }, "[googleVision] Unexpected response format");
      return null;
    }

    const safeSearch = data.responses[0].safeSearchAnnotation;

    if (!safeSearch) {
      logger.warn("[googleVision] No SafeSearch annotation in response");
      return null;
    }

    const result: VisionResult = {
      adultScore: likelihoodToScore(safeSearch.adult),
      racyScore: likelihoodToScore(safeSearch.racy),
      violenceScore: likelihoodToScore(safeSearch.violence),
      raw: safeSearch
    };

    logger.debug({
      imageUrl,
      adult: safeSearch.adult,
      racy: safeSearch.racy,
      violence: safeSearch.violence,
      scores: {
        adult: result.adultScore,
        racy: result.racyScore,
        violence: result.violenceScore
      }
    }, "[googleVision] SafeSearch result");

    return result;

  } catch (err) {
    const classified = classifyError(err);

    logger.warn({
      err,
      imageUrl: imageUrl.substring(0, 100), // Truncate for logs
      errorKind: classified.kind,
      ...errorContext(classified)
    }, "[googleVision] Detection failed");

    // Only report to Sentry if not a transient network error
    if (shouldReportToSentry(classified)) {
      captureException(err instanceof Error ? err : new Error(String(err)), {
        feature: "googleVision",
        imageUrl: imageUrl.substring(0, 100),
      });
    }

    return null;
  }
}

/** When scans resume after Google refused a request, in ms. 0 when they are not paused. */
export function visionPausedUntil(): number {
  return Date.now() < pausedUntil ? pausedUntil : 0;
}

/** Lift the pause. For a test call that Google accepted. */
export function resumeVision(): void {
  pausedUntil = 0;
}

/**
 * One annotate call that shows whether Google takes this key. The image goes
 * inline, so Google fetches nothing. HTTP 200 means the key is known and the
 * project behind it may call the API. Anything else comes back with Google's
 * own message, which can name the project: show it to the owner only.
 */
export async function testVisionKey(
  apiKey: string,
  imageBase64: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetch(VISION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: "LABEL_DETECTION", maxResults: 1 }],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    // Never the error's own text: a rejected header value is quoted in it.
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false,
      reason:
        name === "TimeoutError" || name === "AbortError"
          ? "no answer in 15 seconds"
          : "no answer (network error)",
    };
  }
  if (response.ok) {
    return { ok: true };
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  const message = typeof body?.error?.message === "string" ? body.error.message.slice(0, 300) : "";
  return { ok: false, reason: `HTTP ${response.status}${message ? `: ${message}` : ""}` };
}

/**
 * Calculate combined NSFW score from Vision API results.
 *
 * Design decision: We use max() instead of weighted average because a single
 * strong signal (e.g., adult=0.9) should trigger review regardless of other
 * scores. Averaging would dilute clear violations.
 *
 * Weight rationale:
 * - Adult (1.0x): explicit content, always flag
 * - Racy (0.6x): suggestive but not explicit, might be fine for furry server
 * - Violence (0.3x): less relevant here, but gore avatars are still a concern
 *
 * @param result - VisionResult from detectNsfwVision
 * @returns Combined score 0-1, where >0.5 typically warrants review
 */
export function calculateVisionScore(result: VisionResult): number {
  // If you're thinking "why not use weighted average?" - read the docblock.
  // We tried that. It made obviously-NSFW images look borderline. Bad times.
  const adultWeight = result.adultScore;
  const racyWeight = result.racyScore * 0.6;
  const violenceWeight = result.violenceScore * 0.3;

  return Math.max(adultWeight, racyWeight, violenceWeight);
}
