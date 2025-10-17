// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Jimp from "jimp";
import { logger } from "../../lib/logger.js";

type ScanOptions = {
  nsfwThreshold: number;
  skinEdgeThreshold: number;
};

type ScanResult = {
  nsfw_score: number | null;
  skin_edge_score: number;
  flagged: boolean;
  reason: "both" | "nsfw" | "skin_edge" | "none";
};

let nsfwModelPromise: Promise<unknown | null> | null = null;
let tfModulePromise: Promise<{ node: { decodeImage: (buffer: Uint8Array, channels: number) => unknown }; dispose: () => void } | null> | null =
  null;

async function loadNsfwModel() {
  if (!nsfwModelPromise) {
    nsfwModelPromise = (async () => {
      try {
        const tf = await import("@tensorflow/tfjs-node");
        tfModulePromise = Promise.resolve(tf);
        const nsfw = await import("nsfwjs");
        return await nsfw.load();
      } catch (err) {
        logger.debug({ err }, "NSFW model unavailable, falling back to heuristics");
        return null;
      }
    })();
  }
  return nsfwModelPromise;
}

async function getTfModule() {
  if (!tfModulePromise) {
    try {
      const tf = await import("@tensorflow/tfjs-node");
      tfModulePromise = Promise.resolve(tf);
    } catch (err) {
      tfModulePromise = Promise.resolve(null);
      logger.debug({ err }, "tfjs-node unavailable");
    }
  }
  return tfModulePromise;
}

function isSkinTone(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    diff > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b &&
    !(r > 250 && g > 250 && b > 250)
  );
}

export async function scanAvatar(avatarUrl: string, options: ScanOptions): Promise<ScanResult> {
  const defaultResult: ScanResult = {
    nsfw_score: null,
    skin_edge_score: 0,
    flagged: false,
    reason: "none",
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(avatarUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      logger.warn({ status: response.status }, "Avatar fetch failed");
      return defaultResult;
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    let nsfwScore: number | null = null;
    try {
      const model = (await loadNsfwModel()) as { classify: (img: unknown, topK?: number) => Promise<Array<{ className: string; probability: number }>> } | null;
      const tf = await getTfModule();
      if (model && tf) {
        const tensor = (tf as unknown as { node: { decodeImage: (buffer: Uint8Array, channels: number) => unknown } }).node.decodeImage(
          buffer,
          3
        );
        const predictions = await model.classify(tensor, 5);
        const porn = predictions.find((p) => p.className.toLowerCase() === "porn")?.probability ?? 0;
        const hentai = predictions.find((p) => p.className.toLowerCase() === "hentai")?.probability ?? 0;
        nsfwScore = Math.max(porn, hentai);
        if ("dispose" in tensor && typeof (tensor as { dispose: () => void }).dispose === "function") {
          (tensor as { dispose: () => void }).dispose();
        }
      }
    } catch (err) {
      logger.debug({ err }, "NSFW classification skipped");
    }

    let skinEdgeScore = 0;
    try {
      const image = await Jimp.read(buffer);
      const { width, height } = image.bitmap;
      if (width > 0 && height > 0) {
        const edgeThickness = Math.max(1, Math.round(Math.min(width, height) * 0.08));
        let totalEdgePixels = 0;
        let skinEdgePixels = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const edge =
              x < edgeThickness ||
              x >= width - edgeThickness ||
              y < edgeThickness ||
              y >= height - edgeThickness;
            if (!edge) continue;
            const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(x, y));
            totalEdgePixels++;
            if (isSkinTone(r, g, b)) {
              skinEdgePixels++;
            }
          }
        }

        skinEdgeScore = totalEdgePixels > 0 ? skinEdgePixels / totalEdgePixels : 0;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to analyze avatar edges");
    }

    const nsfwTriggered = nsfwScore !== null && nsfwScore >= options.nsfwThreshold;
    const skinEdgeTriggered = skinEdgeScore >= options.skinEdgeThreshold;

    let reason: ScanResult["reason"] = "none";
    if (nsfwTriggered && skinEdgeTriggered) {
      reason = "both";
    } else if (nsfwTriggered) {
      reason = "nsfw";
    } else if (skinEdgeTriggered) {
      reason = "skin_edge";
    }

    return {
      nsfw_score: nsfwScore,
      skin_edge_score: skinEdgeScore,
      flagged: nsfwTriggered || skinEdgeTriggered,
      reason,
    };
  } catch (err) {
    logger.warn({ err }, "Avatar scan failed");
    return defaultResult;
  }
}
