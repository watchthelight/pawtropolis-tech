/**
 * Pawtropolis Tech — migrations/075_message_archive.ts
 * WHAT: Full-content message archive + reactor lists + backfill progress tracking.
 * WHY: Long-term audit/search; live-stream + paginated backfill of every message.
 * TABLES:
 *  - messages_archive: every message ever sent (humans + bots), full content
 *  - message_reactions_archive: one row per (message, emoji, user)
 *  - backfill_progress: per-channel resumable cursor
 *  - backfill_stats: single-row heartbeat for live dashboard
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *
 * SAFETY:
 *  - Idempotent: tableExists / indexExists guards
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, indexExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

export function migrate075MessageArchive(db: Database): void {
  logger.info("[migration 075] Starting: message_archive");

  enableForeignKeys(db);

  if (!tableExists(db, "messages_archive")) {
    logger.info("[migration 075] Creating messages_archive");
    db.exec(`
      CREATE TABLE messages_archive (
        message_id        TEXT PRIMARY KEY,
        guild_id          TEXT NOT NULL,
        channel_id        TEXT NOT NULL,
        thread_id         TEXT,
        author_id         TEXT NOT NULL,
        author_name       TEXT NOT NULL,
        author_is_bot     INTEGER NOT NULL DEFAULT 0,
        content           TEXT NOT NULL DEFAULT '',
        attachments_json  TEXT,
        embeds_json       TEXT,
        reply_to_id       TEXT,
        is_edited         INTEGER NOT NULL DEFAULT 0,
        is_deleted        INTEGER NOT NULL DEFAULT 0,
        created_at_s      INTEGER NOT NULL,
        edited_at_s       INTEGER,
        deleted_at_s      INTEGER,
        ingested_at_s     INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        ingest_source     TEXT NOT NULL DEFAULT 'live'
      )
    `);
  }

  if (!indexExists(db, "idx_msgarc_channel_time")) {
    db.exec(`CREATE INDEX idx_msgarc_channel_time ON messages_archive(channel_id, created_at_s)`);
  }
  if (!indexExists(db, "idx_msgarc_author_time")) {
    db.exec(`CREATE INDEX idx_msgarc_author_time ON messages_archive(author_id, created_at_s)`);
  }
  if (!indexExists(db, "idx_msgarc_guild_time")) {
    db.exec(`CREATE INDEX idx_msgarc_guild_time ON messages_archive(guild_id, created_at_s)`);
  }

  if (!tableExists(db, "message_reactions_archive")) {
    logger.info("[migration 075] Creating message_reactions_archive");
    db.exec(`
      CREATE TABLE message_reactions_archive (
        message_id     TEXT NOT NULL,
        emoji          TEXT NOT NULL,
        user_id        TEXT NOT NULL,
        reacted_at_s   INTEGER,
        ingest_source  TEXT NOT NULL DEFAULT 'live',
        PRIMARY KEY (message_id, emoji, user_id)
      )
    `);
  }
  if (!indexExists(db, "idx_react_user")) {
    db.exec(`CREATE INDEX idx_react_user ON message_reactions_archive(user_id)`);
  }
  if (!indexExists(db, "idx_react_emoji")) {
    db.exec(`CREATE INDEX idx_react_emoji ON message_reactions_archive(emoji)`);
  }

  if (!tableExists(db, "backfill_progress")) {
    logger.info("[migration 075] Creating backfill_progress");
    db.exec(`
      CREATE TABLE backfill_progress (
        channel_id        TEXT PRIMARY KEY,
        guild_id          TEXT NOT NULL,
        channel_name      TEXT NOT NULL,
        oldest_seen_id    TEXT,
        oldest_seen_ts    INTEGER,
        newest_seen_id    TEXT,
        newest_seen_ts    INTEGER,
        messages_fetched  INTEGER NOT NULL DEFAULT 0,
        reactions_fetched INTEGER NOT NULL DEFAULT 0,
        status            TEXT NOT NULL DEFAULT 'pending',
        last_error        TEXT,
        started_at_s      INTEGER,
        completed_at_s    INTEGER,
        updated_at_s      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);
  }
  if (!indexExists(db, "idx_bfp_status")) {
    db.exec(`CREATE INDEX idx_bfp_status ON backfill_progress(status)`);
  }

  if (!tableExists(db, "backfill_stats")) {
    logger.info("[migration 075] Creating backfill_stats");
    db.exec(`
      CREATE TABLE backfill_stats (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),
        started_at_s        INTEGER,
        last_heartbeat_s    INTEGER,
        current_channel_id  TEXT,
        current_channel_name TEXT,
        messages_total      INTEGER NOT NULL DEFAULT 0,
        reactions_total     INTEGER NOT NULL DEFAULT 0,
        channels_total      INTEGER NOT NULL DEFAULT 0,
        channels_completed  INTEGER NOT NULL DEFAULT 0,
        msgs_per_sec        REAL NOT NULL DEFAULT 0,
        eta_seconds         INTEGER,
        disk_used_bytes     INTEGER,
        disk_total_bytes    INTEGER,
        iops_read           INTEGER,
        iops_write          INTEGER,
        process_state       TEXT NOT NULL DEFAULT 'idle'
      )
    `);
    db.exec(`INSERT INTO backfill_stats (id) VALUES (1)`);
  }

  recordMigration(db, "075", "message_archive");
  logger.info("[migration 075] Complete");
}
