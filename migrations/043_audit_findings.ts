/**
 * Pawtropolis Tech — migrations/043_audit_findings.ts
 * WHAT: Create audit_findings table for tracking command audit results
 * WHY: Enable systematic tracking of command functionality, documentation accuracy,
 *      and permission verification across audit runs
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
 * CONTEXT: The audit system tracks findings from command audits.
 * Each audit run generates multiple findings - one per command tested.
 * Findings include:
 * 1. Test status (pass/fail/skip)
 * 2. Issues discovered (severity, category, description)
 * 3. Documentation accuracy
 * 4. Permission verification
 * 5. API usage tracking
 */

/**
 * Migration: Create audit_findings table
 *
 * @param db - better-sqlite3 Database instance
 * @throws if migration fails (transaction will rollback)
 */
export function migrate043AuditFindings(db: Database): void {
  logger.info("[migration 043] Starting: create audit_findings table");

  enableForeignKeys(db);

  if (!tableExists(db, "audit_findings")) {
    logger.info("[migration 043] Creating audit_findings table");

    /*
     * The audit_findings table stores results from systematic command audits.
     * Each row represents one command/subcommand test result.
     *
     * Key design decisions:
     * - audit_run_id groups findings from a single audit session
     * - test_status and test_type use CHECK constraints for data integrity
     * - issue_* fields are nullable (not all findings have issues)
     * - api_* fields track external API usage and costs
     * - doc_* fields track documentation verification
     * - permission_* fields track permission matrix verification
     */
    db.exec(`
      CREATE TABLE audit_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Audit session identification
        audit_run_id TEXT NOT NULL,

        -- Command identification
        command_name TEXT NOT NULL,
        subcommand TEXT,

        -- Test execution results
        test_status TEXT NOT NULL CHECK(test_status IN (
          'pass',
          'fail',
          'error',
          'skipped',
          'not_tested'
        )),
        test_type TEXT NOT NULL CHECK(test_type IN (
          'live',
          'mock',
          'manual',
          'api_limited'
        )),

        -- Issue tracking (nullable - not all tests find issues)
        issue_severity TEXT CHECK(issue_severity IN (
          'critical',
          'high',
          'medium',
          'low',
          'info'
        )),
        issue_category TEXT,
        issue_title TEXT,
        issue_description TEXT,

        -- Response timing
        response_time_ms INTEGER,

        -- API usage tracking
        api_calls_made INTEGER NOT NULL DEFAULT 0,
        api_cost_estimate REAL NOT NULL DEFAULT 0.0,

        -- Documentation verification
        doc_file TEXT,
        doc_accurate INTEGER,
        doc_issue TEXT,

        -- Permission verification
        expected_permission TEXT,
        actual_permission TEXT,
        permission_match INTEGER,

        -- Additional context
        notes TEXT,

        -- Timestamp
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Index for fetching findings by audit run
    db.exec(`CREATE INDEX idx_audit_findings_run ON audit_findings(audit_run_id)`);

    // Index for querying by command
    db.exec(`CREATE INDEX idx_audit_findings_cmd ON audit_findings(command_name, subcommand)`);

    // Index for filtering by status
    db.exec(`CREATE INDEX idx_audit_findings_status ON audit_findings(test_status)`);

    // Index for filtering by severity
    db.exec(`CREATE INDEX idx_audit_findings_severity ON audit_findings(issue_severity)`);

    logger.info("[migration 043] audit_findings table created");
  } else {
    logger.info("[migration 043] audit_findings table already exists, skipping");
  }

  recordMigration(db, "043", "audit_findings");

  logger.info("[migration 043] Complete");
}
