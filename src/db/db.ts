/**
 * Pawtropolis Tech — src/db/db.ts
 * WHAT: SQLite connection bootstrap and minimal schema creation for review/gate features.
 * WHY: Centralizes better‑sqlite3 setup, PRAGMAs, and basic tables so consumers can just import `db`.
 * FLOWS:
 *  - Open DB → set PRAGMAs → wrap prepare to trace → create core tables → handle shutdown
 * DOCS:
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - SQLite UPSERT: https://sqlite.org/lang_UPSERT.html
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 *  - Node ESM modules: https://nodejs.org/api/esm.html
 *
 * NOTE: better‑sqlite3 is synchronous by design; keep statements small and quick.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const DB_BUSY_TIMEOUT_MS = 15000;
const DB_DEFAULT_PATH = "data/data.db";

const dbPath = env.DB_PATH || DB_DEFAULT_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath, { fileMustExist: false });
// PRAGMAs: see https://sqlite.org/pragma.html — tuned for bot workload
// WAL journaling improves concurrency for readers/writers
db.pragma("journal_mode = WAL");
// Reduce fsync frequency vs FULL for performance in this context
db.pragma("synchronous = NORMAL");
// Enforce referential integrity where declared
db.pragma("foreign_keys = ON");
// Busy timeout to fail-soft during brief contention rather than throwing immediately
db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
// Cache 32MB of pages in-process. Default ~8MB is too small for a 3GB DB but
// 128MB+ blew memory on this 2GB-RAM box (RSS jumped to 1GB, host swapping).
// 32MB strikes the balance: modMetrics + guildSnapshot hot pages stay resident
// without crowding out the rest of the process.
db.pragma("cache_size = -32768");
// Temp tables in RAM keeps large GROUP BY / ORDER BY off disk.
db.pragma("temp_store = MEMORY");
const dbTraceEnabled = process.env.DB_TRACE === "1";
logger.info({ dbPath, dbTraceEnabled }, "SQLite opened");

const legacyRe = /__old|ALTER\s+TABLE\s+.+\s+RENAME/i;
const originalPrepare = db.prepare.bind(db);

// Statement cache. Preparing a statement is a full SQL parse and planner run plus a native
// allocation, and most call sites prepare on every call. Statements handed out by
// db.prepare are therefore shared: never call .pluck/.raw/.expand/.safeIntegers/.bind on
// one, those mutate it for every other caller. Bounded so dynamically built SQL (IN lists,
// interpolated LIMITs) cannot grow it without limit.
const STMT_CACHE_MAX = 1024;
const stmtCache = new Map<string, Database.Statement>();

function wrapStatement(statement: Database.Statement, sql: string): Database.Statement {
  for (const method of ["run", "get", "all"] as const) {
    const base = (statement as any)[method];
    if (typeof base !== "function") continue;
    (statement as any)[method] = function wrappedMethod(this: unknown, ...args: any[]) {
      try {
        if (dbTraceEnabled) {
          logger.debug({ evt: "db_call", m: method, sql }, "db call");
        }
        return base.apply(statement, args);
      } catch (err) {
        logger.error(
          {
            evt: "db_error",
            m: method,
            sql,
            err: err instanceof Error
              ? { name: err.name, code: (err as { code?: string }).code, message: err.message, stack: err.stack }
              : { name: String(err) },
          },
          "db error"
        );
        throw err;
      }
    };
  }
  return statement;
}

(db as any).prepare = function cachedPrepare(sql: string) {
  const hit = stmtCache.get(sql);
  if (hit) return hit;

  if (legacyRe.test(sql)) {
    const err = new Error(`Legacy SQL detected in prepare(): ${sql.slice(0, 180)}`);
    logger.error(
      {
        evt: "db_legacy_sql",
        sql,
        err: { name: err.name, message: err.message, stack: err.stack },
      },
      "blocked legacy SQL"
    );
    throw err;
  }

  const statement = wrapStatement(originalPrepare(sql), sql);
  if (stmtCache.size >= STMT_CACHE_MAX) {
    const oldest = stmtCache.keys().next().value;
    if (oldest !== undefined) stmtCache.delete(oldest);
  }
  stmtCache.set(sql, statement);
  return statement;
};

// Slow transaction diagnostics — logs any transaction taking over 50ms.
// Tagged with evt:"slow_transaction" so jq pipelines can grep cleanly.
const SLOW_TX_THRESHOLD_MS = 50;
const originalTransaction = db.transaction.bind(db);
(db as any).transaction = function timedTransaction<T>(fn: (...args: any[]) => T) {
  const wrapped = originalTransaction((...args: any[]) => {
    const start = performance.now();
    const result = fn(...args);
    const elapsed = performance.now() - start;
    if (elapsed > SLOW_TX_THRESHOLD_MS) {
      logger.warn(
        { evt: "slow_transaction", elapsedMs: Math.round(elapsed), fn: fn.name || "(anonymous)" },
        "[db] Slow transaction detected"
      );
    }
    return result;
  });
  return wrapped;
};

// Bootstrap schema (M6-M9)
// review_card: tracks where the staff-facing review message lives
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS review_card (
    app_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`
).run();

// review_claim: prevents two reviewers from acting on the same application simultaneously
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS review_claim (
    app_id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  )
`
).run();

// vote_out: tracks individual moderator votes for consensus rejection
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS vote_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(app_id, voter_id)
  )
`
).run();

// Idempotent backfill for older DBs that pre-date the reason column.
const voteOutCols = db.prepare(`PRAGMA table_info(vote_out)`).all() as Array<{ name: string }>;
if (!voteOutCols.some((c) => c.name === "reason")) {
  db.prepare(`ALTER TABLE vote_out ADD COLUMN reason TEXT`).run();
}

db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_vote_out_app ON vote_out(app_id)`
).run();

// transcript: simple audit trail for messages/actions related to an application
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    author_id TEXT NOT NULL,
    source TEXT NOT NULL,
    content TEXT NOT NULL
  )
`
).run();

// modmail_ticket: tracks modmail threads for staff-applicant communication
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS modmail_ticket (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    app_code TEXT,
    review_message_id TEXT,
    thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  )
`
).run();

// Ensure only one open ticket per user per guild
db.prepare(
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_modmail_open_unique
  ON modmail_ticket(guild_id, user_id, status)
  WHERE status = 'open'
`
).run();

// MODMAIL MESSAGE MAPPING TABLE
// Maps thread <-> DM message IDs to preserve "reply" threading in both directions.
// MessageReference docs: https://discord.js.org/#/docs/discord.js/main/typedef/MessageReference
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS modmail_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('to_user','to_staff')),
    thread_message_id TEXT,
    dm_message_id TEXT,
    reply_to_thread_message_id TEXT,
    reply_to_dm_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(thread_message_id),
    UNIQUE(dm_message_id)
  )
`
).run();

// Ensure guild_config has new avatar scan columns (migration helper)
// Migration helper: probe schema and add a column if absent.
// Uses PRAGMA table_info to introspect: https://sqlite.org/pragma.html#pragma_table_info
// SECURITY: table/column names validated to prevent SQL injection.
// Validation + ALTER logic now lives in src/db/columnUtil.ts so it can be
// unit-tested without booting the live SQLite handle. The wrapper below
// preserves the previous warn/debug logging shape on failures.

import { addColumnIfMissing as addColumnIfMissingImpl } from "./columnUtil.js";

const addColumnIfMissing = (table: string, column: string, definition: string) => {
  try {
    addColumnIfMissingImpl(db as unknown as Parameters<typeof addColumnIfMissingImpl>[0], table, column, definition, {
      onAdded: (t, c) => logger.info({ table: t, column: c }, "Added missing column"),
      onNoTable: (t, c) =>
        logger.debug(
          { table: t, column: c },
          "Table doesn't exist yet, skipping column migration",
        ),
    });
  } catch (err) {
    logger.warn({ err, table, column }, "Failed to add column (non-fatal)");
  }
};

addColumnIfMissing("guild_config", "avatar_scan_weight_model", "REAL NOT NULL DEFAULT 0.7");
addColumnIfMissing("guild_config", "avatar_scan_weight_edge", "REAL NOT NULL DEFAULT 0.3");
addColumnIfMissing("avatar_scan", "final_pct", "INTEGER NOT NULL DEFAULT 0");

// Guild permission system: mod roles and gatekeeper role
// mod_role_ids: CSV of role IDs that can run all commands alongside owners
// gatekeeper_role_id: role ID for gatekeepers (future use)
// modmail_log_channel_id: channel ID where modmail logs are posted (future use)
// DOCS:
//  - Discord roles: https://discord.js.org/#/docs/discord.js/main/class/GuildMember?scrollTo=roles
//  - Permissions: https://discord.js.org/#/docs/discord.js/main/class/PermissionsBitField
addColumnIfMissing("guild_config", "mod_role_ids", "TEXT");
addColumnIfMissing("guild_config", "gatekeeper_role_id", "TEXT");
addColumnIfMissing("guild_config", "modmail_log_channel_id", "TEXT");

// Review card display settings
// review_roles_mode: Controls how roles are displayed in review cards
//   'none' = hide roles entirely
//   'level_only' = show only highest "level" role (e.g., "Level 2", "Level 3")
//   'all' = show all roles (current behavior)
// WHY: Reduces clutter and highlights important level/verification roles
addColumnIfMissing("guild_config", "review_roles_mode", "TEXT NOT NULL DEFAULT 'level_only'");

// MODMAIL: where we persist the Discord message ID of the transcript/log message.
// Used to link from the review card after the ticket is closed.
addColumnIfMissing("modmail_ticket", "thread_channel_id", "TEXT");
addColumnIfMissing("modmail_ticket", "log_channel_id", "TEXT");
addColumnIfMissing("modmail_ticket", "log_message_id", "TEXT");

// Analytics index: optimize /modstats queries that filter by guild + action + time
// Query pattern: WHERE guild_id = ? AND action IN (...) AND created_at_s >= ?
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_action_log_guild_action_created
     ON action_log(guild_id, action, created_at_s)`
  ).run();
} catch (err) {
  // Table may not exist yet if action_log schema hasn't been created
  logger.debug({ err }, "action_log index creation skipped (table may not exist yet)");
}

// NOTE: sync_marker table is created by migration 026_sync_marker.ts
// Do not add schema creation here - migrations are the single source of truth

// Artist rotation queue: tracks Server Artists and their position in the assignment queue
// Used by /redeemreward and /artistqueue commands
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS artist_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    assignments_count INTEGER DEFAULT 0,
    last_assigned_at TEXT,
    skipped INTEGER DEFAULT 0,
    skip_reason TEXT,
    UNIQUE(guild_id, user_id)
  )
`
).run();

// Index for efficient queue lookups by guild and position
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_artist_queue_guild_position ON artist_queue(guild_id, position)`
).run();

// Artist assignment log: audit trail for all art reward assignments
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS artist_assignment_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    ticket_role_id TEXT,
    assigned_by TEXT NOT NULL,
    assigned_at TEXT DEFAULT (datetime('now')),
    channel_id TEXT,
    override INTEGER DEFAULT 0
  )
`
).run();

// Indexes for assignment log queries
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_artist_assignment_log_guild ON artist_assignment_log(guild_id)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_artist_assignment_log_artist ON artist_assignment_log(artist_id)`
).run();

// Art job tracking: tracks individual art jobs for Server Artists
// Used by /art jobs, /art bump, /art finish commands
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS art_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    job_number INTEGER NOT NULL,
    artist_id TEXT NOT NULL,
    artist_job_number INTEGER NOT NULL,
    recipient_id TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'assigned',
    assigned_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    notes TEXT,
    assignment_log_id INTEGER,
    UNIQUE(guild_id, job_number)
  )
`
).run();

// Indexes for art job queries
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_art_job_guild_status ON art_job(guild_id, status)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_art_job_artist ON art_job(artist_id, status)`
).run();
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_art_job_artist_number ON art_job(guild_id, artist_id, artist_job_number)`
).run();

// Single-use ledger for confirmation-button clicks (reentrancy guard). Keyed by
// the random confirmId in the customId so a double-click of a shared, non-ephemeral
// confirmation cannot run the side effects twice. Also created by migration 080.
db.prepare(
  `CREATE TABLE IF NOT EXISTS consumed_confirmations (
    confirm_id TEXT PRIMARY KEY,
    consumed_at_s INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`
).run();

// Movie night qualification threshold: per-guild configurable threshold
// Default 30 minutes preserves backward compatibility
// WHY: Allows guilds to customize the threshold for short films vs feature films
addColumnIfMissing("guild_movie_config", "qualification_threshold_minutes", "INTEGER DEFAULT 30");

// Audit session tracking: stores audit progress for resume functionality
// Allows interrupted audits (bot restart, errors) to be resumed where they left off
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS audit_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    audit_type TEXT NOT NULL,
    scope TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_by TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    total_to_scan INTEGER NOT NULL DEFAULT 0,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    flagged_count INTEGER NOT NULL DEFAULT 0,
    api_calls INTEGER NOT NULL DEFAULT 0,
    channel_id TEXT NOT NULL
  )
`
).run();

db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_audit_sessions_active ON audit_sessions(guild_id, audit_type, status)`
).run();

// Track which users have been scanned in each audit session (for resume)
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS audit_scanned_users (
    session_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, user_id)
  )
`
).run();

db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_audit_scanned_session ON audit_scanned_users(session_id)`
).run();

// NOTE: Database shutdown is handled by the coordinated graceful shutdown in index.ts
// which ensures proper ordering (stop schedulers → cleanup features → close DB)
// Do NOT add SIGTERM/SIGINT handlers here - they would conflict with the coordinated shutdown
