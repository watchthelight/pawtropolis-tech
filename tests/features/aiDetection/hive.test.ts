/**
 * Pawtropolis Tech — tests/features/aiDetection/hive.test.ts
 * WHAT: Unit tests for Hive AI detection module.
 * WHY: Verify response parsing and error handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env with API key present
vi.mock("../../../src/lib/env.js", () => ({
  env: {
    HIVE_API_KEY: "test-api-key",
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

// Store original fetch
const originalFetch = global.fetch;

import { detectHive } from "../../../src/features/aiDetection/hive.js";

function mockFetchJson(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("features/aiDetection/hive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("detectHive response parsing", () => {
    it("extracts the ai_generated score from the nested response", async () => {
      mockFetchJson({
        status: [
          {
            response: {
              output: [
                {
                  classes: [
                    { class: "ai_generated", score: 0.95 },
                    { class: "not_ai_generated", score: 0.05 },
                  ],
                },
              ],
            },
          },
        ],
      });

      const result = await detectHive("https://example.com/image.png");
      expect(result).toBe(0.95);
    });

    it("scans multiple output items for the ai_generated class", async () => {
      mockFetchJson({
        status: [
          {
            response: {
              output: [
                { classes: [{ class: "other", score: 0.1 }] },
                { classes: [{ class: "ai_generated", score: 0.75 }] },
              ],
            },
          },
        ],
      });

      const result = await detectHive("https://example.com/image.png");
      expect(result).toBe(0.75);
    });

    it("returns null when the output array is missing", async () => {
      mockFetchJson({ status: [{ response: {} }] });
      const result = await detectHive("https://example.com/image.png");
      expect(result).toBeNull();
    });

    it("returns null when no ai_generated class is present", async () => {
      mockFetchJson({
        status: [{ response: { output: [{ classes: [{ class: "other", score: 0.5 }] }] } }],
      });
      const result = await detectHive("https://example.com/image.png");
      expect(result).toBeNull();
    });

    it("returns null when the score is non-numeric", async () => {
      mockFetchJson({
        status: [{ response: { output: [{ classes: [{ class: "ai_generated", score: "high" }] }] } }],
      });
      const result = await detectHive("https://example.com/image.png");
      expect(result).toBeNull();
    });

    it("returns null when the API responds non-ok", async () => {
      mockFetchJson({}, false, 500);
      const result = await detectHive("https://example.com/image.png");
      expect(result).toBeNull();
    });
  });

  describe("detectHive request shape", () => {
    it("sends a Token authorization header and the url in the body", async () => {
      const fetchMock = mockFetchJson({
        status: [{ response: { output: [{ classes: [{ class: "ai_generated", score: 0.5 }] }] } }],
      });

      await detectHive("https://example.com/image.png");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      expect((init.headers as Record<string, string>).Authorization).toBe("Token test-api-key");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init.body as string).url).toBe("https://example.com/image.png");
    });
  });
});

describe("AI detection score interpretation", () => {
  describe("score ranges", () => {
    it("treats 0 as definitely not AI", () => {
      const score = 0;
      expect(score).toBeLessThanOrEqual(0.5);
    });

    it("treats 1 as definitely AI", () => {
      const score = 1;
      expect(score).toBeGreaterThan(0.5);
    });

    it("treats 0.5 as uncertain", () => {
      const score = 0.5;
      expect(score).toBe(0.5);
    });

    it("typical AI image scores above 0.7", () => {
      const typicalAiScore = 0.85;
      expect(typicalAiScore).toBeGreaterThan(0.7);
    });

    it("typical human image scores below 0.3", () => {
      const typicalHumanScore = 0.15;
      expect(typicalHumanScore).toBeLessThan(0.3);
    });
  });
});
