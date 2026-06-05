/**
 * Server-side preference cookie reader.
 * Used in hooks.server.ts to inject theme attributes into SSR HTML so the first
 * paint already matches the user's chosen Sage Observatory mode (zero flash).
 */

import type { Cookies } from "@sveltejs/kit";

const VALID_MODES = ["observatory-dark", "observatory-light", "legacy"] as const;
export type ThemeMode = (typeof VALID_MODES)[number];

const VALID_FONTS = ["figtree", "quicksand", "hanken", "fredoka"] as const;

const FONT_STACKS: Record<string, string> = {
  figtree: '"Figtree Variable", system-ui, sans-serif',
  quicksand: '"Quicksand Variable", system-ui, sans-serif',
  hanken: '"Hanken Grotesk Variable", system-ui, sans-serif',
  fredoka: '"Fredoka Variable", system-ui, sans-serif',
};

export interface Preferences {
  mode: ThemeMode;
  hue: string | null;
  sageH: string | null;
  sageC: string | null;
  fontStack: string | null;
}

export function getPreferences(cookies: Cookies): Preferences {
  const rawMode = cookies.get("paw-theme") ?? null;
  const rawHue = cookies.get("paw-hue") ?? null;
  const rawSageH = cookies.get("paw-sage-h") ?? null;
  const rawSageC = cookies.get("paw-sage-c") ?? null;
  const rawFont = cookies.get("paw-font") ?? null;

  const mode = VALID_MODES.includes(rawMode as ThemeMode)
    ? (rawMode as ThemeMode)
    : "observatory-dark";

  const hue = rawHue && /^\d{1,3}$/.test(rawHue) && Number(rawHue) <= 360 ? rawHue : null;
  const sageH = rawSageH && /^\d{1,3}$/.test(rawSageH) && Number(rawSageH) <= 360 ? rawSageH : null;
  const sageC = rawSageC && /^0?\.\d{1,4}$/.test(rawSageC) ? rawSageC : null;
  const fontStack =
    rawFont && VALID_FONTS.includes(rawFont as (typeof VALID_FONTS)[number])
      ? FONT_STACKS[rawFont]
      : null;

  return { mode, hue, sageH, sageC, fontStack };
}
