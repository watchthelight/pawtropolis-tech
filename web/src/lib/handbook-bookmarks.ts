/**
 * Pawtropolis Tech -- web/src/lib/handbook-bookmarks.ts
 * WHAT: Pure bookmark list logic for the handbook. No DOM, no fetch, no SQLite.
 * WHY: The store (`$lib/stores/handbookBookmarks.svelte.ts`) owns localStorage
 *      and the network; the API route owns the database. Keeping the list
 *      arithmetic here means it is testable under Vitest's node environment
 *      and shared verbatim by both sides.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export type HandbookBookmark = {
  docSlug: string;
  headingSlug: string;
  label: string;
  docTitle: string;
  /** Epoch seconds, matching SQLite's unixepoch() on the server side. */
  addedAt: number;
};

export const MAX_BOOKMARKS = 100;

export const BOOKMARKS_STORAGE_KEY = "paw-hb-bookmarks";
export const BOOKMARKS_OWNER_KEY = "paw-hb-bookmarks-owner";

const STORAGE_VERSION = 1;

export function bookmarkId(docSlug: string, headingSlug: string): string {
  return `${docSlug}#${headingSlug}`;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Coerce one unknown row into a bookmark, or null if it is unusable. */
function coerce(row: unknown): HandbookBookmark | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (!isNonEmptyString(r.docSlug) || !isNonEmptyString(r.headingSlug)) return null;
  const addedAt = typeof r.addedAt === "number" && Number.isFinite(r.addedAt) ? r.addedAt : 0;
  return {
    docSlug: r.docSlug,
    headingSlug: r.headingSlug,
    label: isNonEmptyString(r.label) ? r.label : r.headingSlug,
    docTitle: isNonEmptyString(r.docTitle) ? r.docTitle : r.docSlug,
    addedAt,
  };
}

/**
 * Dedupe by id (first wins), sort oldest first, cap the list. The cap drops
 * the oldest entries rather than refusing the newest, so a mod at the limit
 * still sees the star they just clicked take effect.
 */
export function normalizeBookmarks(rows: readonly unknown[]): HandbookBookmark[] {
  const seen = new Set<string>();
  const out: HandbookBookmark[] = [];
  for (const row of rows) {
    const item = coerce(row);
    if (!item) continue;
    const id = bookmarkId(item.docSlug, item.headingSlug);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  out.sort((a, b) => a.addedAt - b.addedAt);
  return out.slice(-MAX_BOOKMARKS);
}

/** Read the localStorage payload. Anything unreadable degrades to an empty list. */
export function parseBookmarks(raw: string | null | undefined): HandbookBookmark[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return normalizeBookmarks(parsed);
  if (typeof parsed === "object" && parsed !== null) {
    const items = (parsed as Record<string, unknown>).items;
    if (Array.isArray(items)) return normalizeBookmarks(items);
  }
  return [];
}

export function serializeBookmarks(items: readonly HandbookBookmark[]): string {
  return JSON.stringify({ v: STORAGE_VERSION, items: normalizeBookmarks(items) });
}

export function hasBookmark(items: readonly HandbookBookmark[], id: string): boolean {
  return items.some((b) => bookmarkId(b.docSlug, b.headingSlug) === id);
}

export function addBookmark(
  items: readonly HandbookBookmark[],
  entry: HandbookBookmark
): HandbookBookmark[] {
  const id = bookmarkId(entry.docSlug, entry.headingSlug);
  if (hasBookmark(items, id)) return normalizeBookmarks(items);
  return normalizeBookmarks([...items, entry]);
}

export function removeBookmark(
  items: readonly HandbookBookmark[],
  id: string
): HandbookBookmark[] {
  return normalizeBookmarks(items.filter((b) => bookmarkId(b.docSlug, b.headingSlug) !== id));
}

/** Union by id. The earlier `addedAt` wins so adoption preserves save order. */
export function mergeBookmarks(
  a: readonly HandbookBookmark[],
  b: readonly HandbookBookmark[]
): HandbookBookmark[] {
  const byId = new Map<string, HandbookBookmark>();
  for (const item of [...normalizeBookmarks(a), ...normalizeBookmarks(b)]) {
    const id = bookmarkId(item.docSlug, item.headingSlug);
    const existing = byId.get(id);
    if (!existing || item.addedAt < existing.addedAt) byId.set(id, item);
  }
  return normalizeBookmarks([...byId.values()]);
}
