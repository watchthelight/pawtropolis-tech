// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import {
  renderBadgeSvg,
  renderUnknownBadgeSvg,
} from "../../../src/features/badges/renderSvg.js";
import type { ResolvedBadge } from "../../../src/features/badges/types.js";

function role(overrides: Partial<ResolvedBadge> = {}): ResolvedBadge {
  return {
    id: "movie-tier-1",
    kind: "role",
    guildId: "g",
    discordId: "1",
    displayName: "Movie Tier I",
    prefix: "@",
    suffix: "1+ movies",
    colorHex: "#FFAA00",
    backgroundHex: "#3A3A3A",
    foregroundHex: "#FFFFFF",
    stale: false,
    resolvedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("renderBadgeSvg", () => {
  it("renders the role name with @ prefix", () => {
    const svg = renderBadgeSvg(role());
    expect(svg).toContain("@Movie Tier I");
    expect(svg).toContain("1+ movies");
  });

  it("escapes role names safely", () => {
    const svg = renderBadgeSvg(role({ displayName: `<script>x</script> & "y"` }));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
  });

  it("includes title and desc for accessibility", () => {
    const svg = renderBadgeSvg(role());
    expect(svg).toContain("<title>");
    expect(svg).toContain("<desc>");
  });

  it("never includes <script> or external image references", () => {
    const svg = renderBadgeSvg(role());
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/href=/i);
  });

  it("renders channel pill with # prefix", () => {
    const svg = renderBadgeSvg(
      role({ kind: "channel", prefix: "#", displayName: "memes", suffix: undefined }),
    );
    expect(svg).toContain("#memes");
  });

  it("renders stale pill in muted gray", () => {
    const svg = renderBadgeSvg(role({ stale: true }));
    expect(svg).toContain("#404249");
    expect(svg.toLowerCase()).toContain("stale cache");
  });

  it("falls back display name when empty", () => {
    const svg = renderBadgeSvg(role({ displayName: "", kind: "role" }));
    expect(svg).toContain("unknown role");
  });

  it("produces deterministic output for identical input", () => {
    const a = renderBadgeSvg(role());
    const b = renderBadgeSvg(role());
    expect(a).toBe(b);
  });
});

describe("renderUnknownBadgeSvg", () => {
  it("renders fallback safely", () => {
    const svg = renderUnknownBadgeSvg("badge-id");
    expect(svg).toContain("badge-id");
    expect(svg).toContain("<svg");
  });
  it("escapes label", () => {
    const svg = renderUnknownBadgeSvg(`<x>`);
    expect(svg).toContain("&lt;x&gt;");
  });
});
