/**
 * Sage Observatory appearance model.
 *
 * One mode axis (observatory-dark | observatory-light | legacy) plus a small set
 * of personalisation knobs (heading font, sage hue/intensity, starfield density
 * and drift). The chosen mode drives `data-theme` on <html>; the SSR hook mirrors
 * the same cookie so first paint is correct (see hooks.server.ts).
 *
 * Persistence: cookie (consent-gated, read by the server) plus localStorage
 * (always, read by the inline bootstrap in app.html before hydration).
 */

import { setPreferenceCookie, getPreferenceCookie, deleteCookie } from "./consent";

export type ThemeMode = "observatory-dark" | "observatory-light" | "legacy";

export const DEFAULT_MODE: ThemeMode = "observatory-dark";

const VALID_MODES: Set<string> = new Set([
  "observatory-dark",
  "observatory-light",
  "legacy",
]);

export type HeadFont = "figtree" | "quicksand" | "hanken" | "fredoka";

export const HEAD_FONTS: { id: HeadFont; label: string; stack: string }[] = [
  { id: "figtree", label: "Figtree", stack: '"Figtree Variable", system-ui, sans-serif' },
  { id: "quicksand", label: "Quicksand", stack: '"Quicksand Variable", system-ui, sans-serif' },
  { id: "hanken", label: "Hanken Grotesk", stack: '"Hanken Grotesk Variable", system-ui, sans-serif' },
  { id: "fredoka", label: "Fredoka", stack: '"Fredoka Variable", system-ui, sans-serif' },
];

export interface Appearance {
  mode: ThemeMode;
  headFont: HeadFont;
  sageH: number; // sage hue, default 152
  sageC: number; // sage chroma, default 0.075
  starDensity: number; // 0.4 .. 1.6 multiplier, default 1
  starSpeed: number; // 0.4 .. 1.8 multiplier, default 1
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: DEFAULT_MODE,
  headFont: "figtree",
  sageH: 152,
  sageC: 0.075,
  starDensity: 1,
  starSpeed: 1,
};

// ── localStorage mirror (read by the app.html bootstrap) ──

function lsGet(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / quota — cookie + SSR still cover first paint
  }
}

function persist(key: string, value: string): void {
  setPreferenceCookie(key, value);
  lsSet(key, value);
}

// ── Mode ──

export function getStoredMode(): ThemeMode {
  const v = getPreferenceCookie("paw-theme") ?? lsGet("paw-theme");
  if (v && VALID_MODES.has(v)) return v as ThemeMode;
  return DEFAULT_MODE;
}

export function applyMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", mode);
  persist("paw-theme", mode);
}

export function isLegacy(mode: ThemeMode): boolean {
  return mode === "legacy";
}

export function isLight(mode: ThemeMode): boolean {
  return mode === "observatory-light";
}

/** Flip the floating Legacy switch. Remembers the last Observatory mode. */
export function setLegacy(on: boolean): ThemeMode {
  const next: ThemeMode = on ? "legacy" : (getLastObservatory());
  applyMode(next);
  return next;
}

let _lastObservatory: ThemeMode = DEFAULT_MODE;
function getLastObservatory(): ThemeMode {
  const stored = lsGet("paw-theme-obs");
  if (stored === "observatory-dark" || stored === "observatory-light") return stored;
  return _lastObservatory;
}

/** Toggle Night/Day within Observatory. No-op semantics in legacy: returns dark. */
export function toggleNightDay(current: ThemeMode): ThemeMode {
  const next: ThemeMode =
    current === "observatory-light" ? "observatory-dark" : "observatory-light";
  _lastObservatory = next;
  lsSet("paw-theme-obs", next);
  applyMode(next);
  return next;
}

// ── Personalisation knobs ──

export function getStoredAppearance(): Appearance {
  const mode = getStoredMode();
  const headFont = (getPreferenceCookie("paw-font") ?? lsGet("paw-font")) as HeadFont | null;
  const sageH = numPref("paw-sage-h", DEFAULT_APPEARANCE.sageH);
  const sageC = numPref("paw-sage-c", DEFAULT_APPEARANCE.sageC);
  const starDensity = numPref("paw-star-density", DEFAULT_APPEARANCE.starDensity);
  const starSpeed = numPref("paw-star-speed", DEFAULT_APPEARANCE.starSpeed);
  return {
    mode,
    headFont: headFont && HEAD_FONTS.some((f) => f.id === headFont) ? headFont : "figtree",
    sageH,
    sageC,
    starDensity,
    starSpeed,
  };
}

function numPref(key: string, fallback: number): number {
  const raw = getPreferenceCookie(key) ?? lsGet(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function applyHeadFont(id: HeadFont): void {
  if (typeof document === "undefined") return;
  const font = HEAD_FONTS.find((f) => f.id === id) ?? HEAD_FONTS[0];
  document.documentElement.style.setProperty("--font-head", font.stack);
  persist("paw-font", id);
}

export function applySageHue(h: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--sage-h", String(Math.round(h)));
  persist("paw-sage-h", String(Math.round(h)));
}

export function applySageChroma(c: number): void {
  if (typeof document === "undefined") return;
  const v = c.toFixed(4);
  document.documentElement.style.setProperty("--sage-c", v);
  persist("paw-sage-c", v);
}

export function setStarDensity(v: number): void {
  persist("paw-star-density", String(v));
}

export function setStarSpeed(v: number): void {
  persist("paw-star-speed", String(v));
}

/** Apply persisted personalisation (not mode — mode comes from SSR/bootstrap). */
export function applyStoredAppearance(): Appearance {
  const a = getStoredAppearance();
  if (typeof document !== "undefined") {
    const font = HEAD_FONTS.find((f) => f.id === a.headFont) ?? HEAD_FONTS[0];
    document.documentElement.style.setProperty("--font-head", font.stack);
    // sageH/sageC are also driven by Discord accent (stores/theme.ts); only pin
    // them here if the user explicitly chose a non-default value.
    if (getPreferenceCookie("paw-sage-h") ?? lsGet("paw-sage-h")) {
      document.documentElement.style.setProperty("--sage-h", String(Math.round(a.sageH)));
    }
    if (getPreferenceCookie("paw-sage-c") ?? lsGet("paw-sage-c")) {
      document.documentElement.style.setProperty("--sage-c", a.sageC.toFixed(4));
    }
  }
  return a;
}

/** Forget appearance overrides (used when consent is withdrawn). */
export function clearAppearance(): void {
  for (const k of [
    "paw-theme",
    "paw-font",
    "paw-sage-h",
    "paw-sage-c",
    "paw-star-density",
    "paw-star-speed",
  ]) {
    deleteCookie(k);
  }
}
