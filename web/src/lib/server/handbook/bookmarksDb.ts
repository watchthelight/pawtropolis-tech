/**
 * Pawtropolis Tech -- web/src/lib/server/handbook/bookmarksDb.ts
 * WHAT: Writable SQLite store for per-user handbook bookmarks.
 * WHY: The main data.db handle is opened `query_only = ON` in the web process
 *      (see $lib/server/db.ts), so dashboard writes cannot go through it. This
 *      follows the push-db.ts pattern: a separate file with an auto-created
 *      schema, which also keeps the change out of migrations/ and lets the fix
 *      ship on a scoped web deploy.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import path from "node:path";
import { MAX_BOOKMARKS, type HandbookBookmark } from "$lib/handbook-bookmarks";

const DB_BUSY_TIMEOUT_MS = 5000;

const dbPath =
  process.env.BOOKMARKS_DB_PATH ||
  path.resolve(path.dirname(process.env.DB_PATH || path.join("data", "data.db")), "bookmarks.db");

let _db: Database.Database | undefined;

function db(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);

    _db.exec(`
			CREATE TABLE IF NOT EXISTS handbook_bookmarks (
				user_id      TEXT NOT NULL,
				doc_slug     TEXT NOT NULL,
				heading_slug TEXT NOT NULL,
				label        TEXT NOT NULL,
				doc_title    TEXT NOT NULL,
				added_at     INTEGER NOT NULL DEFAULT (unixepoch()),
				PRIMARY KEY (user_id, doc_slug, heading_slug)
			);
			CREATE INDEX IF NOT EXISTS idx_hb_bookmarks_user ON handbook_bookmarks(user_id);
		`);
  }
  return _db;
}

interface BookmarkRow {
  doc_slug: string;
  heading_slug: string;
  label: string;
  doc_title: string;
  added_at: number;
}

function toBookmark(row: BookmarkRow): HandbookBookmark {
  return {
    docSlug: row.doc_slug,
    headingSlug: row.heading_slug,
    label: row.label,
    docTitle: row.doc_title,
    addedAt: row.added_at,
  };
}

export function listBookmarks(userId: string): HandbookBookmark[] {
  const rows = db()
    .prepare(
      `SELECT doc_slug, heading_slug, label, doc_title, added_at
       FROM handbook_bookmarks
       WHERE user_id = ?
       ORDER BY added_at ASC
       LIMIT ${MAX_BOOKMARKS}`
    )
    .all(userId) as BookmarkRow[];
  return rows.map(toBookmark);
}

function insert(userId: string, entry: HandbookBookmark): void {
  db()
    .prepare(
      `INSERT INTO handbook_bookmarks (user_id, doc_slug, heading_slug, label, doc_title, added_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, doc_slug, heading_slug) DO NOTHING`
    )
    .run(
      userId,
      entry.docSlug,
      entry.headingSlug,
      entry.label,
      entry.docTitle,
      entry.addedAt || Math.floor(Date.now() / 1000)
    );
}

/** Drop the oldest rows once a user is over the cap. */
function trim(userId: string): void {
  db()
    .prepare(
      `DELETE FROM handbook_bookmarks
       WHERE user_id = ?
         AND rowid NOT IN (
           SELECT rowid FROM handbook_bookmarks
           WHERE user_id = ?
           ORDER BY added_at DESC
           LIMIT ${MAX_BOOKMARKS}
         )`
    )
    .run(userId, userId);
}

export function putBookmark(userId: string, entry: HandbookBookmark): HandbookBookmark[] {
  insert(userId, entry);
  trim(userId);
  return listBookmarks(userId);
}

export function deleteBookmark(
  userId: string,
  docSlug: string,
  headingSlug: string
): HandbookBookmark[] {
  db()
    .prepare(
      `DELETE FROM handbook_bookmarks WHERE user_id = ? AND doc_slug = ? AND heading_slug = ?`
    )
    .run(userId, docSlug, headingSlug);
  return listBookmarks(userId);
}

export function adoptBookmarks(
  userId: string,
  entries: readonly HandbookBookmark[]
): HandbookBookmark[] {
  const run = db().transaction((rows: readonly HandbookBookmark[]) => {
    for (const row of rows) insert(userId, row);
  });
  run(entries);
  trim(userId);
  return listBookmarks(userId);
}
