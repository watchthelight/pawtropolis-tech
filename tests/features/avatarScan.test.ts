// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db before importing the module so db.prepare doesn't blow up at load.
const mockGet = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({
  prepare: vi.fn(() => ({ get: mockGet, run: vi.fn() })),
}));
vi.mock("../../src/db/db.js", () => ({ db: mockDb }));

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { googleReverseImageUrl, getScan } from "../../src/features/avatarScan.js";

describe("googleReverseImageUrl", () => {
  it("returns a Google Lens URL for a simple image URL", () => {
    const out = googleReverseImageUrl("https://example.com/cat.png");
    expect(out).toBe("https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fexample.com%2Fcat.png");
  });

  it("URL-encodes query params correctly", () => {
    const out = googleReverseImageUrl("https://cdn.discordapp.com/avatars/123?size=512&format=webp");
    expect(out).toContain("https%3A%2F%2Fcdn.discordapp.com");
    expect(out).toContain("%3F");
    expect(out).toContain("%3D");
  });

  it("never throws on empty string", () => {
    expect(() => googleReverseImageUrl("")).not.toThrow();
  });

  it("handles unicode in URL", () => {
    const out = googleReverseImageUrl("https://example.com/猫.png");
    expect(out).toContain("https%3A%2F%2Fexample.com%2F");
    expect(out).toContain("%E7%8C%AB"); // U+732B encoded
  });
});

describe("getScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns safe default when no row exists", () => {
    mockGet.mockReturnValue(undefined);
    const res = getScan("app-missing");
    expect(res).toEqual({
      avatarUrl: null,
      finalPct: 0,
      reason: "none",
      nsfwScore: null,
      edgeScore: 0,
      furryScore: 0,
      scalieScore: 0,
      evidence: { hard: [], soft: [], safe: [] },
    });
  });

  it("hydrates fields from a complete row", () => {
    mockGet.mockReturnValue({
      avatar_url: "https://example.com/a.png",
      nsfw_score: 0.42,
      edge_score: 0.15,
      final_pct: 35,
      furry_score: 0.8,
      scalie_score: 0.1,
      reason: "soft_evidence",
      evidence_hard: null,
      evidence_soft: null,
      evidence_safe: null,
    });
    const res = getScan("app-1");
    expect(res.avatarUrl).toBe("https://example.com/a.png");
    expect(res.nsfwScore).toBe(0.42);
    expect(res.finalPct).toBe(35);
    expect(res.reason).toBe("soft_evidence");
  });

  it("falls back to safe default when db.prepare throws", () => {
    mockGet.mockImplementation(() => {
      throw new Error("db kaboom");
    });
    const res = getScan("app-error");
    expect(res.reason).toBe("none");
    expect(res.finalPct).toBe(0);
    expect(res.evidence).toEqual({ hard: [], soft: [], safe: [] });
  });

  it("handles partial row (null/missing optional fields) without throwing", () => {
    mockGet.mockReturnValue({ avatar_url: null });
    const res = getScan("app-sparse");
    expect(res.avatarUrl).toBeNull();
    expect(res.finalPct).toBe(0);
    expect(res.reason).toBe("none");
  });
});
