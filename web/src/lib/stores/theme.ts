import { formatHex, clampChroma } from "culori";
import { setPreferenceCookie } from "./consent";

export const FALLBACK_HUE = 250;

/**
 * Convert sRGB to oklch chroma and hue.
 * Uses Bjorn Ottosson's Oklab color space for perceptually uniform hue extraction.
 */
function rgbToChromaAndHue(
  r: number,
  g: number,
  b: number
): { chroma: number; hue: number } | null {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2220049256 * lg + 0.6696926125 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  if (chroma < 0.01) return null;

  const hue = (Math.atan2(okB, okA) * (180 / Math.PI) + 360) % 360;
  return { chroma, hue };
}

function rgbToHue(r: number, g: number, b: number): number | null {
  const result = rgbToChromaAndHue(r, g, b);
  return result && result.chroma >= 0.02 ? result.hue : null;
}

function accentColorToHue(accentColor: number): number | null {
  const r = (accentColor >> 16) & 0xff;
  const g = (accentColor >> 8) & 0xff;
  const b = accentColor & 0xff;
  return rgbToHue(r, g, b);
}

/**
 * Extract dominant hue from an image URL.
 * Samples pixels and picks the most chromatic (colorful) ones,
 * ignoring dark/grey background pixels that would wash out the average.
 */
function extractImageHue(imageUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Find the most chromatic pixels and compute circular mean hue
        let sinSum = 0;
        let cosSum = 0;
        let weightSum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          // Skip near-black pixels (background)
          if (r + g + b < 60) continue;

          const result = rgbToChromaAndHue(r, g, b);
          if (result && result.chroma > 0.03) {
            // Weight by chroma squared — strongly favor saturated pixels
            const w = result.chroma * result.chroma;
            const rad = result.hue * (Math.PI / 180);
            sinSum += Math.sin(rad) * w;
            cosSum += Math.cos(rad) * w;
            weightSum += w;
          }
        }

        if (weightSum > 0) {
          const avgHue = (Math.atan2(sinSum, cosSum) * (180 / Math.PI) + 360) % 360;
          resolve(avgHue);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl.includes("?")
      ? imageUrl.replace(/size=\d+/, "size=64")
      : imageUrl + "?size=64";
  });
}

let _activeUserId: string | null = null;

/**
 * Generate a gamut-safe hex color from OKLCH values using culori's clampChroma.
 * This ensures colors are displayable in sRGB without ugly clipping.
 */
function safeOklchHex(l: number, c: number, h: number): string {
  return formatHex(clampChroma({ mode: "oklch", l, c, h }, "oklch")) ?? "#000000";
}

/**
 * Triadic palette generation using culori + OKLCH.
 *
 * From one seed hue, generates two companion hues at +120° and +240° (triadic).
 * OKLCH is perceptually uniform, so equal angular distance = equal visual difference.
 *
 * Examples of genuinely different palettes:
 *   green (145°) → warm=265° (violet), cool=25° (warm coral)
 *   blue (220°)  → warm=340° (rose),   cool=100° (lime)
 *   red (25°)    → warm=145° (green),   cool=265° (violet)
 *
 * Also generates pre-computed accent hex colors at key lightness stops
 * for CSS consumption, ensuring gamut safety via culori's clampChroma.
 */
function generatePalette(seed: number) {
  const warm = Math.round((seed + 120) % 360); // triadic companion 1
  const cool = Math.round((seed + 240) % 360); // triadic companion 2
  const complement = Math.round((seed + 180) % 360);

  // Pre-compute key accent colors at gamut-safe chroma values
  // These are injected as CSS custom properties for components that need hex
  return {
    warm,
    cool,
    complement,
    // Accent swatches (seed hue)
    accentHex: safeOklchHex(0.72, 0.18, seed),
    accentDimHex: safeOklchHex(0.4, 0.1, seed),
    // Warm swatches (triadic +120°)
    warmHex: safeOklchHex(0.68, 0.12, warm),
    warmDimHex: safeOklchHex(0.38, 0.06, warm),
    // Cool swatches (triadic +240°)
    coolHex: safeOklchHex(0.65, 0.1, cool),
    coolDimHex: safeOklchHex(0.36, 0.05, cool),
  };
}

export function applyPalette(hue: number): void {
  if (typeof document === "undefined") return;
  const rounded = String(Math.round(hue));
  const p = generatePalette(hue);
  const root = document.documentElement.style;

  // Hue seeds (consumed by oklch() in CSS custom properties)
  root.setProperty("--hue", rounded);
  root.setProperty("--hue-warm", String(p.warm));
  root.setProperty("--hue-cool", String(p.cool));
  root.setProperty("--hue-complement", String(p.complement));

  // Pre-computed gamut-safe hex colors (for SVG fills, canvas, etc.)
  root.setProperty("--accent-hex", p.accentHex);
  root.setProperty("--warm-hex", p.warmHex);
  root.setProperty("--cool-hex", p.coolHex);

  // Persist hue to cookie (if consent accepted)
  setPreferenceCookie("paw-hue", rounded);
}

/**
 * Apply theme from Discord accent color.
 * Falls back to avatar color extraction when accent_color is 0/null.
 */
export function applyTheme(
  accentColor: number | null,
  avatarUrl?: string | null,
  userId?: string
): void {
  if (userId) _activeUserId = userId;

  // Clear stale theme cache from previous sessions
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("theme-last-uid");
      if (userId) localStorage.removeItem(`theme-hue-${userId}`);
    } catch {}
  }

  // Try accent color first (skip 0 = black, which Discord returns when theme isn't in API)
  if (accentColor && accentColor !== 0) {
    const hue = accentColorToHue(accentColor);
    if (hue != null) {
      applyPalette(hue);
      return;
    }
  }

  // Fallback: extract from avatar image
  if (avatarUrl && typeof document !== "undefined") {
    extractImageHue(avatarUrl).then((hue) => {
      if (hue != null) {
        applyPalette(hue);
      } else {
        applyPalette(FALLBACK_HUE);
      }
    });
    return;
  }

  applyPalette(FALLBACK_HUE);
}
