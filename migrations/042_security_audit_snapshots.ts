/**
 * Pawtropolis Tech — migrations/042_security_audit_snapshots.ts
 * WHAT: Create tables for security audit snapshots, history tracking, and bot permission docs
 * WHY: Enable diff tracking between audits, historical trends, and bot permission auditing
 * DOCS:
 *  - SQLite CREATE TABLE: https://sqlite.org/lang_createtable.html
 *
 * SAFETY:
 *  - Idempotent: safe to run multiple times (uses IF NOT EXISTS)
 *  - Additive only: no data loss
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { tableExists, recordMigration, enableForeignKeys } from "./lib/helpers.js";

/*
 * CONTEXT: The security audit system generates snapshots of server state.
 * Storing these snapshots enables:
 * 1. Diff tracking - detect permission changes between audits
 * 2. Historical trends - track issue counts over time
 * 3. Change alerts - notify when dangerous permissions are added
 *
 * The bot_permission_requirements table allows staff to document what
 * permissions each bot actually needs, enabling excess permission detection.
 */

/**
 * Migration: Create security audit snapshot and history tables
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate042SecurityAuditSnapshots(db: Database): void {
  logger.info("[migration 042] Starting: create security audit snapshot tables");

  enableForeignKeys(db);

  // Table 1: security_audit_snapshots - Store complete audit state for diff tracking
  if (!tableExists(db, "security_audit_snapshots")) {
    logger.info("[migration 042] Creating security_audit_snapshots table");

    /*
     * roles_snapshot and channels_snapshot are JSON blobs containing full
     * permission data for each entity. This allows detailed diff computation
     * without re-fetching from Discord.
     *
     * content_hash is MD5 of roles+channels for quick "did anything change?" checks.
     * If hash matches previous snapshot, we can skip expensive diff computation.
     */
    db.exec(`
      CREATE TABLE security_audit_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

        -- Summary counts for quick comparison
        role_count INTEGER NOT NULL,
        channel_count INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        critical_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        medium_count INTEGER NOT NULL DEFAULT 0,
        low_count INTEGER NOT NULL DEFAULT 0,

        -- JSON blobs of full state
        roles_snapshot TEXT NOT NULL,
        channels_snapshot TEXT NOT NULL,
        issues_snapshot TEXT NOT NULL,

        -- Hash for quick change detection
        content_hash TEXT NOT NULL
      )
    `);

    // Index for fetching latest snapshots by guild
    db.exec(`CREATE INDEX idx_security_snapshots_guild ON security_audit_snapshots(guild_id)`);
    db.exec(`CREATE INDEX idx_security_snapshots_created ON security_audit_snapshots(guild_id, created_at DESC)`);

    logger.info("[migration 042] security_audit_snapshots table created");
  } else {
    logger.info("[migration 042] security_audit_snapshots table already exists, skipping");
  }

  // Table 2: security_issue_history - Track issue counts over time for trends
  if (!tableExists(db, "security_issue_history")) {
    logger.info("[migration 042] Creating security_issue_history table");

    /*
     * This table records a row for each audit run, enabling trend charts.
     * The category breakdown (role_issues, channel_issues, etc.) helps
     * identify which areas are improving or degrading over time.
     */
    db.exec(`
      CREATE TABLE security_issue_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        recorded_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

        -- Counts by severity
        critical_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        medium_count INTEGER NOT NULL DEFAULT 0,
        low_count INTEGER NOT NULL DEFAULT 0,
        acknowledged_count INTEGER NOT NULL DEFAULT 0,

        -- Counts by category
        role_issues INTEGER NOT NULL DEFAULT 0,
        channel_issues INTEGER NOT NULL DEFAULT 0,
        hierarchy_issues INTEGER NOT NULL DEFAULT 0,
        verification_issues INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.exec(`CREATE INDEX idx_issue_history_guild_time ON security_issue_history(guild_id, recorded_at DESC)`);

    logger.info("[migration 042] security_issue_history table created");
  } else {
    logger.info("[migration 042] security_issue_history table already exists, skipping");
  }

  // Table 3: bot_permission_requirements - Document expected bot permissions
  if (!tableExists(db, "bot_permission_requirements")) {
    logger.info("[migration 042] Creating bot_permission_requirements table");

    /*
     * Staff can document what permissions each bot actually needs.
     * The audit system then compares actual permissions to documented
     * requirements, flagging any excess permissions.
     *
     * expected_permissions is a JSON array of permission names, e.g.:
     * ["ManageMessages", "BanMembers", "KickMembers"]
     */
    db.exec(`
      CREATE TABLE bot_permission_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        bot_user_id TEXT NOT NULL,
        bot_name TEXT NOT NULL,
        expected_permissions TEXT NOT NULL,
        documented_by TEXT NOT NULL,
        documented_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        notes TEXT,
        UNIQUE(guild_id, bot_user_id)
      )
    `);

    db.exec(`CREATE INDEX idx_bot_perms_guild ON bot_permission_requirements(guild_id)`);

    logger.info("[migration 042] bot_permission_requirements table created");
  } else {
    logger.info("[migration 042] bot_permission_requirements table already exists, skipping");
  }

  recordMigration(db, "042", "security_audit_snapshots");

  logger.info("[migration 042] Complete");
}
