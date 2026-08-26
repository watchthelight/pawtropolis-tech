import { json, error, type RequestHandler } from "@sveltejs/kit";
import {
  adoptBookmarks,
  deleteBookmark,
  listBookmarks,
  putBookmark,
} from "$lib/server/handbook/bookmarksDb";
import { normalizeBookmarks, type HandbookBookmark } from "$lib/handbook-bookmarks";

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    error(400, "Invalid request body");
  }
}

function readEntry(body: Record<string, unknown>): HandbookBookmark {
  const [entry] = normalizeBookmarks([
    {
      docSlug: body.docSlug,
      headingSlug: body.headingSlug,
      label: body.label,
      docTitle: body.docTitle,
      addedAt: Math.floor(Date.now() / 1000),
    },
  ]);
  if (!entry) {
    error(400, "docSlug and headingSlug are required");
  }
  return entry;
}

export const PUT: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    error(401, "Not authenticated");
  }
  const body = await readBody(request);
  return json({ bookmarks: putBookmark(locals.user.id, readEntry(body)) });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    error(401, "Not authenticated");
  }
  const body = await readBody(request);
  const docSlug = body.docSlug;
  const headingSlug = body.headingSlug;
  if (typeof docSlug !== "string" || typeof headingSlug !== "string") {
    error(400, "docSlug and headingSlug are required");
  }
  return json({ bookmarks: deleteBookmark(locals.user.id, docSlug, headingSlug) });
};

/** Bulk adopt: carries a signed-out visitor's local bookmarks into their account. */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    error(401, "Not authenticated");
  }
  const body = await readBody(request);
  if (!Array.isArray(body.bookmarks)) {
    error(400, "bookmarks array is required");
  }
  const entries = normalizeBookmarks(body.bookmarks);
  if (entries.length === 0) {
    return json({ bookmarks: listBookmarks(locals.user.id) });
  }
  return json({ bookmarks: adoptBookmarks(locals.user.id, entries) });
};
