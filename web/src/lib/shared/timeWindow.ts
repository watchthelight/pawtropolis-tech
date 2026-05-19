// Shared TimeWindow spec — used by both server queries and UI picker.
//
// Wire format (URL params):
//   ?window=7d | 30d | 90d | all       (preset)
//   ?window=custom&from=<ISO>&to=<ISO> (custom range, inclusive from, exclusive to)
//
// `custom` dates are ISO-8601 (YYYY-MM-DD accepted, full timestamps accepted).
// `to` defaults to now when absent. `from` required for custom.

export type PresetWindow = "7d" | "30d" | "90d" | "all";
export const PRESET_WINDOWS: readonly PresetWindow[] = ["7d", "30d", "90d", "all"] as const;

export interface TimeWindowPreset {
  kind: "preset";
  preset: PresetWindow;
}

export interface TimeWindowCustom {
  kind: "custom";
  fromS: number; // unix seconds, inclusive
  toS: number; // unix seconds, exclusive
}

export type TimeWindowSpec = TimeWindowPreset | TimeWindowCustom;

export interface ResolvedRange {
  /** inclusive start, unix seconds — 0 means "all time" */
  startS: number;
  /** exclusive end, unix seconds */
  endS: number;
  /** approximate span in days (for queries that still expect days). "all" → 36500. */
  days: number;
  /** previous-period comparison origin — startS shifted back by (endS - startS). null for 'all'. */
  prevStartS: number | null;
  spec: TimeWindowSpec;
}

const ALL_DAYS = 36_500;

function nowS(): number {
  // Dashboard windows do not need second precision. Snapping to the minute keeps
  // preset ranges stable long enough for server-side and browser caches to hit.
  return Math.floor(Date.now() / 60_000) * 60;
}

function parseIsoSeconds(raw: string): number | null {
  // Accept YYYY-MM-DD (treated as UTC midnight) or full ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(raw + "T00:00:00Z");
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function presetDays(p: PresetWindow): number {
  if (p === "all") return ALL_DAYS;
  return p === "7d" ? 7 : p === "30d" ? 30 : 90;
}

/**
 * Parse a TimeWindowSpec from URLSearchParams. Falls back to `defaultPreset` on any problem.
 */
export function parseTimeWindowSpec(
  params: URLSearchParams,
  defaultPreset: PresetWindow = "all"
): TimeWindowSpec {
  const w = params.get("window");
  if (w === "custom") {
    const fromRaw = params.get("from");
    if (!fromRaw) return { kind: "preset", preset: defaultPreset };
    const fromS = parseIsoSeconds(fromRaw);
    if (fromS == null) return { kind: "preset", preset: defaultPreset };
    const toRaw = params.get("to");
    const toS = toRaw ? parseIsoSeconds(toRaw) : nowS();
    if (toS == null || toS <= fromS) return { kind: "preset", preset: defaultPreset };
    return { kind: "custom", fromS, toS };
  }
  if (w && (PRESET_WINDOWS as readonly string[]).includes(w)) {
    return { kind: "preset", preset: w as PresetWindow };
  }
  return { kind: "preset", preset: defaultPreset };
}

/**
 * Resolve a spec to a concrete {startS, endS, days, prevStartS}.
 * For 'all': startS=0 (no filter), prevStartS=null.
 */
export function resolveRange(spec: TimeWindowSpec): ResolvedRange {
  if (spec.kind === "preset") {
    if (spec.preset === "all") {
      return { startS: 0, endS: nowS(), days: ALL_DAYS, prevStartS: null, spec };
    }
    const days = presetDays(spec.preset);
    const endS = nowS();
    const startS = endS - days * 86_400;
    return { startS, endS, days, prevStartS: startS - days * 86_400, spec };
  }
  const span = spec.toS - spec.fromS;
  const days = Math.max(1, Math.round(span / 86_400));
  return { startS: spec.fromS, endS: spec.toS, days, prevStartS: spec.fromS - span, spec };
}

/** Human-readable label for the range, e.g. "Last 7 days", "All time", "Mar 1 – Apr 24, 2026". */
export function formatWindowLabel(spec: TimeWindowSpec): string {
  if (spec.kind === "preset") {
    if (spec.preset === "all") return "All time";
    const n = presetDays(spec.preset);
    return `Last ${n} days`;
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(new Date(spec.fromS * 1000))} – ${fmt.format(new Date(spec.toS * 1000))}`;
}

/** Short label used in trend comparison strings, e.g. "the previous 7 days" / "the previous period". */
export function comparisonLabel(spec: TimeWindowSpec): string {
  if (spec.kind === "preset") {
    if (spec.preset === "all") return "";
    return `the previous ${presetDays(spec.preset)} days`;
  }
  return "the previous period";
}

/** Canonicalize a spec → URLSearchParams entries (does not mutate input). */
export function windowToParams(spec: TimeWindowSpec, existing?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(existing);
  if (spec.kind === "preset") {
    out.set("window", spec.preset);
    out.delete("from");
    out.delete("to");
  } else {
    out.set("window", "custom");
    out.set("from", new Date(spec.fromS * 1000).toISOString().slice(0, 10));
    out.set("to", new Date(spec.toS * 1000).toISOString().slice(0, 10));
  }
  return out;
}

export function isPresetEqual(spec: TimeWindowSpec, preset: PresetWindow): boolean {
  return spec.kind === "preset" && spec.preset === preset;
}

/**
 * Stable key parts for cached server loads. Preset windows are bucketed by end
 * time so rapid reloads/window toggles reuse the same cache entry; custom
 * ranges are already explicit and stable.
 */
export function rangeCacheKeyParts(
  range: ResolvedRange,
  bucketSeconds?: number
): (string | number)[] {
  if (range.spec.kind === "custom") {
    return ["custom", range.spec.fromS, range.spec.toS];
  }
  const bucket = bucketSeconds ?? presetBucketSeconds(range.spec);
  return [range.spec.preset, Math.floor(range.endS / Math.max(1, bucket))];
}

/**
 * Cache-bucket size matched to how fast each preset shifts. Short windows
 * (7d) reroll every 5 min; long windows (90d, all) survive an hour or a day
 * because their endpoint barely moves.
 */
export function presetBucketSeconds(spec: TimeWindowSpec): number {
  if (spec.kind === "custom") return 60;
  switch (spec.preset) {
    case "7d":
      return 300;
    case "30d":
      return 1800;
    case "90d":
      return 3600;
    case "all":
      return 86400;
  }
}
