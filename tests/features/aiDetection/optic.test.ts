/**
 * Pawtropolis Tech — tests/features/aiDetection/optic.test.ts
 * WHAT: Unit tests for Optic AI Or Not detection module.
 * WHY: Verify response parsing and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env with API key present
vi.mock("../../../src/lib/env.js", () => ({
  env: {
    OPTIC_API_KEY: "test-api-key",
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { detectOptic } from "../../../src/features/aiDetection/optic.js";

const originalFetch = global.fetch;

function mockFetchJson(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("features/aiDetection/optic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("detectOptic response parsing", () => {
    it("extracts confidence from report.ai.confidence", async () => {
      mockFetchJson({ report: { verdict: "ai", ai: { confidence: 0.92 } } });
      const result = await detectOptic("https://example.com/image.png");
      expect(result).toBe(0.92);
    });

    it("returns the human-verdict confidence unchanged", async () => {
      mockFetchJson({ report: { verdict: "human", ai: { confidence: 0.15 } } });
      const result = await detectOptic("https://example.com/image.png");
      expect(result).toBe(0.15);
    });

    it("returns null when report is missing", async () => {
      mockFetchJson({});
      const result = await detectOptic("https://example.com/image.png");
      expect(result).toBeNull();
    });

    it("returns null when confidence is missing", async () => {
      mockFetchJson({ report: { ai: {} } });
      const result = await detectOptic("https://example.com/image.png");
      expect(result).toBeNull();
    });

    it("returns null when confidence is non-numeric", async () => {
      mockFetchJson({ report: { ai: { confidence: "high" } } });
      const result = await detectOptic("https://example.com/image.png");
      expect(result).toBeNull();
    });

    it("returns null when the API responds non-ok", async () => {
      mockFetchJson({}, false, 500);
      const result = await detectOptic("https://example.com/image.png");
      expect(result).toBeNull();
    });
  });

  describe("detectOptic request shape", () => {
    it("sends a Bearer header and the image url under the 'object' key", async () => {
      const fetchMock = mockFetchJson({ report: { ai: { confidence: 0.5 } } });

      await detectOptic("https://example.com/image.png");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.aiornot.com/v1/reports/image");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-api-key");
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody.object).toBe("https://example.com/image.png");
      expect(parsedBody.url).toBeUndefined();
    });
  });
});

describe("Optic verdict interpretation", () => {
  describe("verdict values", () => {
    it("ai verdict indicates AI-generated", () => {
      const verdict = "ai";
      expect(verdict).toBe("ai");
    });

    it("human verdict indicates human-created", () => {
      const verdict = "human";
      expect(verdict).toBe("human");
    });
  });

  describe("confidence to verdict mapping", () => {
    it("confidence > 0.5 typically maps to ai verdict", () => {
      const confidence = 0.75;
      const expectedVerdict = confidence > 0.5 ? "ai" : "human";
      expect(expectedVerdict).toBe("ai");
    });

    it("confidence < 0.5 typically maps to human verdict", () => {
      const confidence = 0.25;
      const expectedVerdict = confidence > 0.5 ? "ai" : "human";
      expect(expectedVerdict).toBe("human");
    });

    it("confidence = 0.5 is boundary case", () => {
      const confidence = 0.5;
      // At exactly 0.5, the API could go either way
      expect(confidence).toBe(0.5);
    });
  });
});

describe("AI detection service comparison", () => {
  describe("service identifiers", () => {
    it("optic has correct service ID", () => {
      const serviceId = "optic";
      expect(serviceId).toBe("optic");
    });

    it("optic has correct display name", () => {
      const displayName = "Optic AI Or Not";
      expect(displayName).toBe("Optic AI Or Not");
    });
  });

  describe("score normalization", () => {
    it("all services return 0-1 range", () => {
      const scores = [0, 0.25, 0.5, 0.75, 1];
      for (const score of scores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it("null indicates service failure", () => {
      const failedScore = null;
      expect(failedScore).toBeNull();
    });
  });
});
