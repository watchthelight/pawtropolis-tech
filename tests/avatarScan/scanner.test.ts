// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Jimp from "jimp";
import { scanAvatar } from "../../src/features/avatarScan/scanner.js";

const originalFetch = global.fetch;

describe("scanAvatar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null nsfw score when ML unavailable", async () => {
    const image = await new Jimp(8, 8, 0xff0000ff);
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const result = await scanAvatar("https://cdn.discordapp.com/avatar.png", {
      nsfwThreshold: 0.6,
      skinEdgeThreshold: 0.5,
    });

    expect(result.nsfw_score).toBeNull();
    expect(result.flagged).toBe(false);
  });

  it("flags avatars with skin-dense edges", async () => {
    const size = 16;
    const image = new Jimp(size, size, 0x000000ff);
    const skin = Jimp.rgbaToInt(205, 160, 130, 255);
    const border = Math.max(1, Math.round(size * 0.1));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const edge = x < border || x >= size - border || y < border || y >= size - border;
        if (edge) image.setPixelColor(skin, x, y);
      }
    }
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const result = await scanAvatar("https://cdn.discordapp.com/avatar.png", {
      nsfwThreshold: 0.9,
      skinEdgeThreshold: 0.2,
    });

    expect(result.skin_edge_score).toBeGreaterThan(0.2);
    expect(result.flagged).toBe(true);
    expect(result.reason).toBe("skin_edge");
  });
});
