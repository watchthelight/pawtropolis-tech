/**
 * Handbook bookmark state.
 * Server is authoritative when signed in; localStorage is the offline cache and
 * the whole store for signed-out visitors. List arithmetic lives in the pure
 * `$lib/handbook-bookmarks` module so it stays testable outside the browser.
 */

import {
  BOOKMARKS_OWNER_KEY,
  BOOKMARKS_STORAGE_KEY,
  addBookmark,
  bookmarkId,
  hasBookmark,
  mergeBookmarks,
  normalizeBookmarks,
  parseBookmarks,
  removeBookmark,
  serializeBookmarks,
  type HandbookBookmark,
} from "$lib/handbook-bookmarks";

const ENDPOINT = "/api/handbook/bookmarks";

let _bookmarks = $state<HandbookBookmark[]>([]);
let ownerId: string | null = null;

export function getBookmarks(): HandbookBookmark[] {
  return _bookmarks;
}

export function isBookmarked(docSlug: string, headingSlug: string): boolean {
  return hasBookmark(_bookmarks, bookmarkId(docSlug, headingSlug));
}

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
    // private mode or quota: the server copy still covers signed-in users
  }
}

function commit(items: HandbookBookmark[]): void {
  _bookmarks = items;
  lsSet(BOOKMARKS_STORAGE_KEY, serializeBookmarks(items));
}

async function send(method: "PUT" | "DELETE" | "POST", body: unknown): Promise<void> {
  if (!ownerId) return;
  try {
    const res = await fetch(ENDPOINT, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { bookmarks?: unknown };
    if (Array.isArray(data.bookmarks)) commit(normalizeBookmarks(data.bookmarks));
  } catch {
    // Offline or a transient 5xx: the optimistic local copy stands and the
    // next page load re-seeds from the server.
  }
}

/**
 * Seed the store on mount. `serverList` comes from the handbook layout load and
 * is empty for signed-out visitors.
 */
export function initBookmarks(serverList: HandbookBookmark[], userId: string | null): void {
  const local = parseBookmarks(lsGet(BOOKMARKS_STORAGE_KEY));
  ownerId = userId;

  if (!userId) {
    commit(local);
    return;
  }

  if (lsGet(BOOKMARKS_OWNER_KEY) !== userId) {
    const merged = mergeBookmarks(local, serverList);
    commit(merged);
    lsSet(BOOKMARKS_OWNER_KEY, userId);
    void send("POST", { bookmarks: merged });
    return;
  }

  commit(serverList);
}

export function toggle(entry: Omit<HandbookBookmark, "addedAt">): void {
  const id = bookmarkId(entry.docSlug, entry.headingSlug);
  if (hasBookmark(_bookmarks, id)) {
    commit(removeBookmark(_bookmarks, id));
    void send("DELETE", { docSlug: entry.docSlug, headingSlug: entry.headingSlug });
    return;
  }
  commit(addBookmark(_bookmarks, { ...entry, addedAt: Math.floor(Date.now() / 1000) }));
  void send("PUT", entry);
}

export function remove(docSlug: string, headingSlug: string): void {
  commit(removeBookmark(_bookmarks, bookmarkId(docSlug, headingSlug)));
  void send("DELETE", { docSlug, headingSlug });
}
