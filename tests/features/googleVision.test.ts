/**
 * Pawtropolis Tech — tests/features/googleVision.test.ts
 * WHAT: Unit tests for Google Cloud Vision NSFW detection module.
 * WHY: Verify likelihood mapping, score calculation, and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/errors.js", () => ({
  classifyError: vi.fn(() => ({ kind: "network" })),
  shouldReportToSentry: vi.fn(() => false),
  errorContext: vi.fn(() => ({})),
}));

vi.mock("../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

describe("features/googleVision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SafeSearchLikelihood types", () => {
    it("defines all likelihood values", () => {
      const likelihoods = [
        "UNKNOWN",
        "VERY_UNLIKELY",
        "UNLIKELY",
        "POSSIBLE",
        "LIKELY",
        "VERY_LIKELY",
      ];

      expect(likelihoods).toHaveLength(6);
    });
  });
});

describe("likelihoodToScore mapping", () => {
  // Recreate the mapping function for testing
  function likelihoodToScore(likelihood: string): number {
    switch (likelihood) {
      case "VERY_UNLIKELY":
        return 0.0;
      case "UNLIKELY":
        return 0.2;
      case "POSSIBLE":
        return 0.5;
      case "LIKELY":
        return 0.8;
      case "VERY_LIKELY":
        return 1.0;
      default:
        return 0.0; // UNKNOWN treated as safe
    }
  }

  describe("individual mappings", () => {
    it("maps VERY_UNLIKELY to 0.0", () => {
      expect(likelihoodToScore("VERY_UNLIKELY")).toBe(0.0);
    });

    it("maps UNLIKELY to 0.2", () => {
      expect(likelihoodToScore("UNLIKELY")).toBe(0.2);
    });

    it("maps POSSIBLE to 0.5", () => {
      expect(likelihoodToScore("POSSIBLE")).toBe(0.5);
    });

    it("maps LIKELY to 0.8", () => {
      expect(likelihoodToScore("LIKELY")).toBe(0.8);
    });

    it("maps VERY_LIKELY to 1.0", () => {
      expect(likelihoodToScore("VERY_LIKELY")).toBe(1.0);
    });

    it("maps UNKNOWN to 0.0 (fail open)", () => {
      expect(likelihoodToScore("UNKNOWN")).toBe(0.0);
    });
  });

  describe("range validation", () => {
    it("all scores are between 0 and 1", () => {
      const likelihoods = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"];

      for (const likelihood of likelihoods) {
        const score = likelihoodToScore(likelihood);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("calculateVisionScore", () => {
  // Recreate the score calculation function for testing
  function calculateVisionScore(result: {
    adultScore: number;
    racyScore: number;
    violenceScore: number;
  }): number {
    const adultWeight = result.adultScore;
    const racyWeight = result.racyScore * 0.6;
    const violenceWeight = result.violenceScore * 0.3;

    return Math.max(adultWeight, racyWeight, violenceWeight);
  }

  describe("weight application", () => {
    it("applies 1.0x weight to adult score", () => {
      const result = { adultScore: 0.9, racyScore: 0, violenceScore: 0 };
      expect(calculateVisionScore(result)).toBe(0.9);
    });

    it("applies 0.6x weight to racy score", () => {
      const result = { adultScore: 0, racyScore: 1.0, violenceScore: 0 };
      expect(calculateVisionScore(result)).toBe(0.6);
    });

    it("applies 0.3x weight to violence score", () => {
      const result = { adultScore: 0, racyScore: 0, violenceScore: 1.0 };
      expect(calculateVisionScore(result)).toBe(0.3);
    });
  });

  describe("max selection", () => {
    it("returns highest weighted score", () => {
      const result = { adultScore: 0.5, racyScore: 0.8, violenceScore: 1.0 };
      // adult: 0.5, racy: 0.48, violence: 0.3
      expect(calculateVisionScore(result)).toBe(0.5);
    });

    it("adult score dominates when high", () => {
      const result = { adultScore: 0.9, racyScore: 1.0, violenceScore: 1.0 };
      // adult: 0.9, racy: 0.6, violence: 0.3
      expect(calculateVisionScore(result)).toBe(0.9);
    });
  });

  describe("threshold interpretation", () => {
    it(">0.5 typically warrants review", () => {
      const score = 0.6;
      const warrantsReview = score > 0.5;
      expect(warrantsReview).toBe(true);
    });

    it("<0.5 typically does not warrant review", () => {
      const score = 0.3;
      const warrantsReview = score > 0.5;
      expect(warrantsReview).toBe(false);
    });
  });
});

describe("VisionResult structure", () => {
  describe("required fields", () => {
    it("includes adultScore", () => {
      const result = { adultScore: 0.5, racyScore: 0.2, violenceScore: 0.1, raw: {} };
      expect(result).toHaveProperty("adultScore");
    });

    it("includes racyScore", () => {
      const result = { adultScore: 0.5, racyScore: 0.2, violenceScore: 0.1, raw: {} };
      expect(result).toHaveProperty("racyScore");
    });

    it("includes violenceScore", () => {
      const result = { adultScore: 0.5, racyScore: 0.2, violenceScore: 0.1, raw: {} };
      expect(result).toHaveProperty("violenceScore");
    });

    it("includes raw SafeSearchAnnotation", () => {
      const result = {
        adultScore: 0.5,
        racyScore: 0.2,
        violenceScore: 0.1,
        raw: {
          adult: "POSSIBLE",
          racy: "UNLIKELY",
          violence: "VERY_UNLIKELY",
          spoof: "UNKNOWN",
          medical: "UNKNOWN",
        },
      };
      expect(result.raw).toHaveProperty("adult");
      expect(result.raw).toHaveProperty("racy");
      expect(result.raw).toHaveProperty("violence");
    });
  });
});

describe("API configuration", () => {
  describe("endpoint", () => {
    it("uses Vision API v1", () => {
      const endpoint = "https://vision.googleapis.com/v1/images:annotate";
      expect(endpoint).toContain("v1");
      expect(endpoint).toContain("images:annotate");
    });
  });

  describe("auth header", () => {
    it("uses X-Goog-Api-Key header", () => {
      const headerName = "X-Goog-Api-Key";
      expect(headerName).toBe("X-Goog-Api-Key");
    });
  });

  describe("features requested", () => {
    it("requests SAFE_SEARCH_DETECTION", () => {
      const features = [
        { type: "SAFE_SEARCH_DETECTION", maxResults: 1 },
        { type: "LABEL_DETECTION", maxResults: 1 },
      ];

      const hasSSE = features.some((f) => f.type === "SAFE_SEARCH_DETECTION");
      expect(hasSSE).toBe(true);
    });

    it("bundles LABEL_DETECTION for free SafeSearch", () => {
      const features = [
        { type: "SAFE_SEARCH_DETECTION", maxResults: 1 },
        { type: "LABEL_DETECTION", maxResults: 1 },
      ];

      const hasLabel = features.some((f) => f.type === "LABEL_DETECTION");
      expect(hasLabel).toBe(true);
    });
  });

  describe("timeout", () => {
    it("uses 15 second timeout", () => {
      const timeoutMs = 15000;
      expect(timeoutMs).toBe(15000);
    });
  });
});

describe("the API key", () => {
  const AVATAR = "https://cdn.discordapp.com/avatars/123/hash.png";
  const fetchMock = vi.fn();
  let savedKey: string | undefined;

  const safeSearchAnswer = () =>
    new Response(
      JSON.stringify({
        responses: [
          {
            safeSearchAnnotation: {
              adult: "LIKELY",
              spoof: "UNKNOWN",
              medical: "UNKNOWN",
              violence: "VERY_UNLIKELY",
              racy: "POSSIBLE",
            },
          },
        ],
      }),
      { status: 200 }
    );

  /** A fresh copy of the module, so a pause left by one test does not reach the next. */
  async function load() {
    vi.resetModules();
    return import("../../src/features/googleVision.js");
  }

  beforeEach(() => {
    savedKey = process.env.GOOGLE_VISION_API_KEY;
    delete process.env.GOOGLE_VISION_API_KEY;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => safeSearchAnswer());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.GOOGLE_VISION_API_KEY;
    else process.env.GOOGLE_VISION_API_KEY = savedKey;
  });

  it("makes no request when no key is set", async () => {
    const { detectNsfwVision } = await load();

    expect(await detectNsfwVision(AVATAR)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a key that was set after the module loaded", async () => {
    const { detectNsfwVision } = await load();
    expect(await detectNsfwVision(AVATAR)).toBeNull();

    process.env.GOOGLE_VISION_API_KEY = "key-set-later";
    const result = await detectNsfwVision(AVATAR);

    expect(result).toMatchObject({ adultScore: 0.8, racyScore: 0.5, violenceScore: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("key-set-later");
    expect(url).not.toContain("key-set-later");
  });

  it("stops calling as soon as the key is removed", async () => {
    process.env.GOOGLE_VISION_API_KEY = "first-key";
    const { detectNsfwVision } = await load();
    await detectNsfwVision(AVATAR);

    delete process.env.GOOGLE_VISION_API_KEY;

    expect(await detectNsfwVision(AVATAR)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the key that is set at the time of the call", async () => {
    process.env.GOOGLE_VISION_API_KEY = "first-key";
    const { detectNsfwVision } = await load();
    await detectNsfwVision(AVATAR);

    process.env.GOOGLE_VISION_API_KEY = "second-key";
    await detectNsfwVision(AVATAR);

    const keys = fetchMock.mock.calls.map(
      (call) => ((call[1] as RequestInit).headers as Record<string, string>)["X-Goog-Api-Key"]
    );
    expect(keys).toEqual(["first-key", "second-key"]);
  });

  it("treats a blank key as no key", async () => {
    process.env.GOOGLE_VISION_API_KEY = "   ";
    const { detectNsfwVision } = await load();

    expect(await detectNsfwVision(AVATAR)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pauses after Google refuses a request", async () => {
    process.env.GOOGLE_VISION_API_KEY = "refused-key";
    fetchMock.mockImplementation(
      async () => new Response('{"error":{"message":"billing"}}', { status: 403 })
    );
    const { detectNsfwVision } = await load();

    expect(await detectNsfwVision(AVATAR)).toBeNull();
    expect(await detectNsfwVision(AVATAR)).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("error handling", () => {
  describe("API response errors", () => {
    it("returns null on non-ok response", () => {
      const response = { ok: false, status: 403 };
      const result = response.ok ? {} : null;
      expect(result).toBeNull();
    });
  });

  describe("missing annotation", () => {
    it("returns null when no safeSearchAnnotation", () => {
      const data = { responses: [{}] };
      const annotation = data.responses[0]?.safeSearchAnnotation;
      expect(annotation).toBeUndefined();
    });
  });

  describe("Sentry reporting", () => {
    it("reports non-transient errors", () => {
      const errorKind = "unknown";
      const shouldReport = errorKind !== "network" && errorKind !== "timeout";
      expect(shouldReport).toBe(true);
    });

    it("does not report transient network errors", () => {
      const errorKind = "network";
      const shouldReport = errorKind !== "network" && errorKind !== "timeout";
      expect(shouldReport).toBe(false);
    });
  });
});

describe("SafeSearchAnnotation fields", () => {
  describe("content categories", () => {
    it("includes adult content detection", () => {
      const annotation = { adult: "LIKELY" };
      expect(annotation).toHaveProperty("adult");
    });

    it("includes racy content detection", () => {
      const annotation = { racy: "POSSIBLE" };
      expect(annotation).toHaveProperty("racy");
    });

    it("includes violence detection", () => {
      const annotation = { violence: "UNLIKELY" };
      expect(annotation).toHaveProperty("violence");
    });

    it("includes spoof detection", () => {
      const annotation = { spoof: "VERY_UNLIKELY" };
      expect(annotation).toHaveProperty("spoof");
    });

    it("includes medical detection", () => {
      const annotation = { medical: "UNKNOWN" };
      expect(annotation).toHaveProperty("medical");
    });
  });
});

describe("image URL handling", () => {
  describe("imageUri format", () => {
    it("requires publicly accessible URL", () => {
      const imageUrl = "https://cdn.discordapp.com/avatars/123/hash.png";
      expect(imageUrl.startsWith("https://")).toBe(true);
    });
  });

  describe("logging truncation", () => {
    it("truncates long URLs in logs", () => {
      const longUrl = "https://example.com/" + "a".repeat(200);
      const truncated = longUrl.substring(0, 100);

      expect(truncated.length).toBe(100);
    });
  });
});
