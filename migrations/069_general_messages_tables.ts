/**
 * Migration 069: General-channel quality scoring tables
 * WHAT: Creates the 9 tables that back the chat-quality dashboard:
 *       general_messages_raw, _ctx, _embed, _effort, _resonance, _score,
 *       _label, _gold, plus user_names.
 * WHY: Locally these were created on first run by individual scripts in
 *      scripts/. Formalizing them as a migration so deploys recreate them
 *      reliably and the schema is documented in one place.
 * SAFETY: All CREATE TABLE / CREATE INDEX statements use IF NOT EXISTS, so
 *         the migration is fully idempotent and safe to run on a host that
 *         already has the tables (e.g. our local dev DB).
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { recordMigration } from "./lib/helpers.js";

export function migrate069GeneralMessagesTables(db: Database): void {
  logger.info("[migration 069] Starting: general_messages_* + user_names tables");

  db.exec(`
    -- raw text + metadata for messages in #general (and any channel we later
    -- widen the live capture to). Discord snowflake is the PK so re-running
    -- backfills + concurrent live writes are safe via INSERT OR IGNORE.
    CREATE TABLE IF NOT EXISTS general_messages_raw (
      id            TEXT PRIMARY KEY,
      created_at_s  INTEGER NOT NULL,
      author_id     TEXT NOT NULL,
      is_bot        INTEGER NOT NULL,
      content       TEXT NOT NULL,
      attachments   INTEGER NOT NULL,
      embeds        INTEGER NOT NULL,
      reply_to      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gmr_time ON general_messages_raw(created_at_s);

    -- 3-message conversational context for each row, stored as a JSON array
    -- of {ts, author_id, content}. Materialized incrementally by
    -- scripts/build-context-incremental.mjs.
    CREATE TABLE IF NOT EXISTS general_messages_ctx (
      id        TEXT PRIMARY KEY,
      ctx_json  TEXT NOT NULL
    );

    -- 384-dim sentence-transformer embeddings (Xenova/all-MiniLM-L6-v2),
    -- L2-normalized. target_vec = embedding of message text; ctx_vec =
    -- embedding of the concatenated 3-msg context. Each BLOB is 1536 bytes
    -- (384 × float32).
    CREATE TABLE IF NOT EXISTS general_messages_embed (
      id            TEXT PRIMARY KEY,
      target_vec    BLOB NOT NULL,
      ctx_vec       BLOB NOT NULL,
      embedded_at_s INTEGER NOT NULL
    );

    -- Distilled effort score 0..1 produced by models/effort_v1.json applied
    -- to general_messages_raw + general_messages_embed.
    CREATE TABLE IF NOT EXISTS general_messages_effort (
      id            TEXT PRIMARY KEY,
      created_at_s  INTEGER NOT NULL,
      score         REAL NOT NULL,
      model         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gme_time ON general_messages_effort(created_at_s);

    -- Reply-graph engagement score 0..1, log1p(reply_count) / log1p(P95).
    CREATE TABLE IF NOT EXISTS general_messages_resonance (
      id            TEXT PRIMARY KEY,
      created_at_s  INTEGER NOT NULL,
      reply_count   INTEGER NOT NULL,
      score         REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gmres_time ON general_messages_resonance(created_at_s);

    -- Heuristic v0 score (length, lowlist, repeat penalty, etc.). Kept as a
    -- side-by-side comparison metric for the dashboard.
    CREATE TABLE IF NOT EXISTS general_messages_score (
      id            TEXT PRIMARY KEY,
      created_at_s  INTEGER NOT NULL,
      score         REAL NOT NULL,
      features      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gms_time ON general_messages_score(created_at_s);

    -- Haiku 4.5 rubric labels for the gold set.
    CREATE TABLE IF NOT EXISTS general_messages_label (
      id            TEXT PRIMARY KEY,
      density       REAL NOT NULL,
      specificity   REAL NOT NULL,
      sincerity     REAL NOT NULL,
      relevance     REAL NOT NULL,
      effort        REAL NOT NULL,
      rationale     TEXT NOT NULL,
      model         TEXT NOT NULL,
      in_tokens     INTEGER NOT NULL,
      out_tokens    INTEGER NOT NULL,
      cached_in     INTEGER NOT NULL DEFAULT 0,
      labeled_at_s  INTEGER NOT NULL
    );

    -- Stratified-sample selection for the gold set (5 length × 4 score bins).
    CREATE TABLE IF NOT EXISTS general_messages_gold (
      id             TEXT PRIMARY KEY,
      stratum_len    INTEGER NOT NULL,
      stratum_score  INTEGER NOT NULL,
      selected_at_s  INTEGER NOT NULL
    );

    -- Resolved Discord display names for authors who pass a min-message
    -- threshold. Populated by scripts/resolve-authors.mjs and refreshed
    -- periodically.
    CREATE TABLE IF NOT EXISTS user_names (
      id            TEXT PRIMARY KEY,
      username      TEXT,
      global_name   TEXT,
      nickname      TEXT,
      display       TEXT NOT NULL,
      in_guild      INTEGER NOT NULL,
      fetched_at_s  INTEGER NOT NULL
    );
  `);

  logger.info("[migration 069] All 9 tables + indexes ready");
  recordMigration(db, "069", "general_messages_tables");
  logger.info("[migration 069] Complete");
}
