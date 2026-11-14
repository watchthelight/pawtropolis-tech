/**
 * Pawtropolis Tech -- src/features/artistInvestigation/images.ts
 * WHAT: Downloads a submitted image at run time, hashes it, reads the metadata
 *       worth knowing about, and makes the downscaled copies sent onward.
 * WHY: Discord attachment links are signed and expire, so bytes are fetched fresh
 *      on every run. Full-size uploads would waste API budget and break lookup
 *      size limits. Only Discord's own media hosts are fetched: a link an
 *      applicant pastes must never make the bot request an arbitrary address.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { createHash } from "node:crypto";
import { LIMITS } from "./config.js";
import type { PreparedImage } from "./types.js";

const DISCORD_MEDIA_HOSTS =
  /^(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)$/i;

export function isDiscordMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && DISCORD_MEDIA_HOSTS.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Download one image. Errors carry a short reason that is safe to show in the report. */
export async function fetchImageBytes(url: string): Promise<Buffer> {
  if (!isDiscordMediaUrl(url)) throw new Error("not hosted on Discord, so it was not downloaded");

  const res = await fetch(url, {
    signal: AbortSignal.timeout(LIMITS.imageFetchTimeoutMs),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > LIMITS.maxImageBytes) {
    throw new Error("larger than the download limit");
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > LIMITS.maxImageBytes) throw new Error("larger than the download limit");
  if (bytes.length === 0) throw new Error("download was empty");
  return bytes;
}

/** Text chunk keywords that image generators write into PNG files. */
const GENERATOR_PNG_KEYS: Record<string, string> = {
  parameters: "written by Stable Diffusion web front ends",
  prompt: "written by ComfyUI",
  workflow: "written by ComfyUI",
  "sd-metadata": "written by InvokeAI",
  invokeai_metadata: "written by InvokeAI",
  dream: "written by InvokeAI",
  generation_data: "written by image generator front ends",
};

/** Byte strings that identify a generator or a provenance manifest wherever they sit in the file. */
const GENERATOR_MARKERS: ReadonlyArray<[marker: string, meaning: string]> = [
  ["trainedAlgorithmicMedia", "a Content Credentials manifest that declares AI-generated media"],
  ["NovelAI", "the name NovelAI"],
  ["Midjourney", "the name Midjourney"],
  ["Stable Diffusion", "the name Stable Diffusion"],
  ["ComfyUI", "the name ComfyUI"],
  ["DALL-E", "the name DALL-E"],
  ["Adobe Firefly", "the name Adobe Firefly"],
];

const ART_SOFTWARE_MARKERS: readonly string[] = [
  "Adobe Photoshop",
  "CLIP STUDIO",
  "Procreate",
  "Krita",
  "PaintTool SAI",
  "ibisPaint",
  "MediBang",
  "FireAlpaca",
  "Affinity Photo",
  "Created with GIMP",
];

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

function pngTextChunks(bytes: Buffer): Array<{ keyword: string; text: string }> {
  const chunks: Array<{ keyword: string; text: string }> = [];
  if (bytes.length < 16 || bytes.readUInt32BE(0) !== 0x89504e47) return chunks;

  let offset = 8;
  while (offset + 12 <= bytes.length && chunks.length < 40) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length || type === "IEND") break;

    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const data = bytes.subarray(start, Math.min(end, start + 2048));
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = data.toString("latin1", 0, nul);
        let text = "";
        if (type === "tEXt") {
          text = data.toString("latin1", nul + 1);
        } else if (type === "iTXt" && data[nul + 1] === 0) {
          const languageEnd = data.indexOf(0, nul + 3);
          const translatedEnd = languageEnd >= 0 ? data.indexOf(0, languageEnd + 1) : -1;
          if (translatedEnd >= 0) text = data.toString("utf8", translatedEnd + 1);
        }
        chunks.push({ keyword, text });
      }
    }
    offset = end + 4;
  }
  return chunks;
}

/**
 * Notes about what the file says of its own origin. Metadata is easy to strip
 * or fake, so these are leads: a generator tag is worth a question, and a clean
 * file proves nothing.
 */
export function scanMetadata(bytes: Buffer): string[] {
  const notes: string[] = [];

  for (const { keyword, text } of pngTextChunks(bytes)) {
    const meaning = GENERATOR_PNG_KEYS[keyword.toLowerCase()];
    if (meaning) {
      notes.push(
        `PNG text chunk "${keyword}" (${meaning})${text ? `: "${oneLine(text, 160)}"` : ""}`
      );
    } else if (/^(software|source|comment|description|title)$/i.test(keyword) && text) {
      notes.push(`PNG "${keyword}" tag: "${oneLine(text, 120)}"`);
    }
  }

  for (const [marker, meaning] of GENERATOR_MARKERS) {
    if (bytes.includes(marker)) notes.push(`File metadata contains ${meaning}`);
  }
  const software = ART_SOFTWARE_MARKERS.filter((marker) => bytes.includes(marker));
  if (software.length > 0) notes.push(`File metadata names art software: ${software.join(", ")}`);

  return [...new Set(notes)];
}

/** Decode, auto-orient and downscale. Throws when the bytes are not an image sharp can read. */
export async function prepareImage(key: string, bytes: Buffer): Promise<PreparedImage> {
  const { default: sharp } = await import("sharp");
  const open = () =>
    sharp(bytes, { limitInputPixels: LIMITS.maxInputPixels, failOn: "error" }).rotate();

  const meta = await sharp(bytes, {
    limitInputPixels: LIMITS.maxInputPixels,
    failOn: "error",
  }).metadata();
  if (!meta.width || !meta.height) throw new Error("could not be decoded as an image");
  const sideways = (meta.orientation ?? 1) >= 5;

  const fit = (edge: number) => ({
    width: edge,
    height: edge,
    fit: "inside" as const,
    withoutEnlargement: true,
  });
  const forModel = await open()
    .resize(fit(LIMITS.modelLongEdge))
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  const lookupBytes = await open()
    .resize(fit(LIMITS.lookupLongEdge))
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  const lookupMirroredBytes = await sharp(lookupBytes).flop().jpeg({ quality: 85 }).toBuffer();

  const metadataNotes = scanMetadata(bytes);
  if ((meta.pages ?? 1) > 1) metadataNotes.push("Animated file: only the first frame was analyzed");

  return {
    key,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    modelBytes: forModel.data,
    modelMediaType: "image/jpeg",
    modelWidth: forModel.info.width,
    modelHeight: forModel.info.height,
    lookupBytes,
    lookupMirroredBytes,
    lookupMediaType: "image/jpeg",
    originalWidth: sideways ? meta.height : meta.width,
    originalHeight: sideways ? meta.width : meta.height,
    metadataNotes,
  };
}
