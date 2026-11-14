// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/images.test.ts
 * WHAT: Which image links the bot will download, the download limits, what the
 *       metadata scan reports, and the downscaled copies sent onward.
 * WHY: An applicant controls the links in a ticket, so the bot must only ever
 *      request Discord's own media hosts. Full-size uploads would waste the API
 *      budget, and a file that is not an image must fail by itself, not the run.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../../src/features/artistInvestigation/config.js";
import {
  fetchImageBytes,
  isDiscordMediaUrl,
  prepareImage,
  scanMetadata,
} from "../../../src/features/artistInvestigation/images.js";

const CDN_URL = "https://cdn.discordapp.com/attachments/1/2/sketch.png?ex=abc";

describe("isDiscordMediaUrl", () => {
  it.each([
    "https://cdn.discordapp.com/attachments/1/2/sketch.png?ex=abc",
    "https://media.discordapp.net/attachments/1/2/sketch.png",
    "https://images-ext-1.discordapp.net/external/abc/https/example.com/a.png",
    "https://CDN.DISCORDAPP.COM/attachments/1/2/a.png",
  ])("accepts %s", (url) => {
    expect(isDiscordMediaUrl(url)).toBe(true);
  });

  it.each([
    ["plain http", "http://cdn.discordapp.com/attachments/1/2/a.png"],
    ["a look-alike host", "https://cdn.discordapp.com.evil.example/a.png"],
    ["the Discord host as a path", "https://evil.example/cdn.discordapp.com/a.png"],
    ["the Discord host as a username", "https://cdn.discordapp.com@evil.example/a.png"],
    ["another Discord host", "https://discord.com/api/webhooks/1/abc"],
    ["an internal address", "https://169.254.169.254/latest/meta-data/"],
    ["an arbitrary site", "https://example.com/art.png"],
    ["text that is not a URL", "cdn.discordapp.com/attachments/1/2/a.png"],
  ])("refuses %s", (_label, url) => {
    expect(isDiscordMediaUrl(url)).toBe(false);
  });
});

describe("fetchImageBytes", () => {
  it("never requests a link that is not on a Discord media host", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchImageBytes("https://example.com/art.png")).rejects.toThrow("not hosted on Discord");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("downloads the bytes, refusing redirects and setting a timeout", async () => {
    const fetchSpy = vi.fn(async () => new Response(Buffer.from("image-bytes"), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const bytes = await fetchImageBytes(CDN_URL);

    expect(bytes.toString()).toBe("image-bytes");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CDN_URL);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an expired or missing file by its HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    await expect(fetchImageBytes(CDN_URL)).rejects.toThrow("download failed (HTTP 404)");
  });

  it("stops at the declared size without reading the body", async () => {
    const arrayBuffer = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(LIMITS.maxImageBytes + 1) }),
        arrayBuffer,
      }))
    );

    await expect(fetchImageBytes(CDN_URL)).rejects.toThrow("larger than the download limit");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("checks the real size when no size was declared", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(LIMITS.maxImageBytes + 1),
      }))
    );
    await expect(fetchImageBytes(CDN_URL)).rejects.toThrow("larger than the download limit");
  });

  it("rejects an empty download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(0), { status: 200 })));
    await expect(fetchImageBytes(CDN_URL)).rejects.toThrow("download was empty");
  });
});

/** A PNG-shaped buffer: signature, header chunk, the given chunks, end chunk. Not decodable. */
function pngWith(chunks: Array<{ type: string; data: Buffer }>): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.alloc(13)),
    ...chunks.map((c) => chunk(c.type, c.data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const textChunk = (keyword: string, text: string) => ({
  type: "tEXt",
  data: Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]),
});

describe("scanMetadata", () => {
  it("reports a Stable Diffusion parameters chunk with the start of its text", () => {
    const notes = scanMetadata(pngWith([textChunk("parameters", "masterpiece, fox, detailed fur\nSteps: 28, Sampler: Euler a")]));
    expect(notes).toEqual([
      'PNG text chunk "parameters" (written by Stable Diffusion web front ends): "masterpiece, fox, detailed fur Steps: 28, Sampler: Euler a"',
    ]);
  });

  it("reports ComfyUI chunks stored as international text", () => {
    const data = Buffer.concat([
      Buffer.from("prompt", "latin1"),
      Buffer.from([0, 0, 0, 0, 0]),
      Buffer.from('{"3":{"class_type":"KSampler"}}', "utf8"),
    ]);
    const notes = scanMetadata(pngWith([{ type: "iTXt", data }]));
    expect(notes).toEqual(['PNG text chunk "prompt" (written by ComfyUI): "{"3":{"class_type":"KSampler"}}"']);
  });

  it("reports the software tag and names known art programs", () => {
    const notes = scanMetadata(pngWith([textChunk("Software", "Adobe Photoshop 25.0 (Windows)")]));
    expect(notes).toEqual([
      'PNG "Software" tag: "Adobe Photoshop 25.0 (Windows)"',
      "File metadata names art software: Adobe Photoshop",
    ]);
  });

  it("finds generator names anywhere in a file that is not a PNG", () => {
    const jpegLike = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from("...Midjourney...trainedAlgorithmicMedia..."), Buffer.alloc(32)]);
    const notes = scanMetadata(jpegLike);
    expect(notes).toContain("File metadata contains the name Midjourney");
    expect(notes).toContain("File metadata contains a Content Credentials manifest that declares AI-generated media");
  });

  it("returns nothing for a file with no metadata of interest", () => {
    expect(scanMetadata(pngWith([textChunk("Author", "someone")]))).toEqual([]);
    expect(scanMetadata(Buffer.from([1, 2, 3]))).toEqual([]);
  });

  it("survives a truncated chunk", () => {
    const whole = pngWith([textChunk("parameters", "fox")]);
    expect(() => scanMetadata(whole.subarray(0, whole.length - 20))).not.toThrow();
  });
});

async function twoTone(width: number, height: number): Promise<Buffer> {
  // Left half red, right half blue, so a mirrored copy can be told apart.
  const blueHalf = await sharp({ create: { width: Math.floor(width / 2), height, channels: 3, background: "#0000ff" } })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "#ff0000" } })
    .composite([{ input: blueHalf, left: Math.ceil(width / 2), top: 0 }])
    .png()
    .toBuffer();
}

async function pixel(bytes: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
}

describe("prepareImage", () => {
  it("downscales a large image for the model and for the lookup services", async () => {
    const bytes = await twoTone(3000, 1500);
    const prepared = await prepareImage("img1", bytes);

    expect(prepared).toMatchObject({
      key: "img1",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      modelMediaType: "image/jpeg",
      modelWidth: LIMITS.modelLongEdge,
      modelHeight: LIMITS.modelLongEdge / 2,
      lookupMediaType: "image/jpeg",
      originalWidth: 3000,
      originalHeight: 1500,
      metadataNotes: [],
    });
    const lookup = await sharp(prepared.lookupBytes).metadata();
    expect([lookup.format, lookup.width, lookup.height]).toEqual(["jpeg", LIMITS.lookupLongEdge, LIMITS.lookupLongEdge / 2]);
    const model = await sharp(prepared.modelBytes).metadata();
    expect([model.format, model.width, model.height]).toEqual(["jpeg", prepared.modelWidth, prepared.modelHeight]);
  });

  it("does not enlarge a small image", async () => {
    const prepared = await prepareImage("img1", await twoTone(200, 100));
    expect([prepared.modelWidth, prepared.modelHeight]).toEqual([200, 100]);
    const lookup = await sharp(prepared.lookupBytes).metadata();
    expect([lookup.width, lookup.height]).toEqual([200, 100]);
  });

  it("makes a mirrored lookup copy", async () => {
    const prepared = await prepareImage("img1", await twoTone(200, 100));

    const [leftRed, , leftBlue] = await pixel(prepared.lookupBytes, 20, 50);
    expect(leftRed).toBeGreaterThan(200);
    expect(leftBlue).toBeLessThan(60);

    const [mirroredRed, , mirroredBlue] = await pixel(prepared.lookupMirroredBytes, 20, 50);
    expect(mirroredRed).toBeLessThan(60);
    expect(mirroredBlue).toBeGreaterThan(200);
  });

  it("puts transparent art on a white background", async () => {
    const transparent = await sharp({ create: { width: 60, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const prepared = await prepareImage("img1", transparent);
    const [r, g, b] = await pixel(prepared.modelBytes, 30, 30);
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
  });

  it("gives the same hash for the same file and a different one for a different file", async () => {
    const first = await twoTone(200, 100);
    const second = await twoTone(100, 200);
    expect((await prepareImage("a", first)).sha256).toBe((await prepareImage("b", first)).sha256);
    expect((await prepareImage("a", first)).sha256).not.toBe((await prepareImage("b", second)).sha256);
  });

  it("carries metadata notes found in the file", async () => {
    const withSoftware = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#808080" } })
      .png()
      .toBuffer();
    // Append a generator name after the image data: still a readable PNG, and the byte scan sees it.
    const prepared = await prepareImage("img1", Buffer.concat([withSoftware, Buffer.from("NovelAI")]));
    expect(prepared.metadataNotes).toContain("File metadata contains the name NovelAI");
  });

  it("rejects bytes that are not an image", async () => {
    await expect(prepareImage("img1", Buffer.from("this is a text file, not a picture"))).rejects.toThrow();
  });
});
