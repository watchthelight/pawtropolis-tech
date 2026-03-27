/**
 * Pawtropolis Tech — src/features/review/queries.ts
 * WHAT: Query helpers for review card data (action history, claims, etc.).
 * WHY: Centralize prepared statements for review card rendering and analytics.
 * FLOWS: Fetch recent actions, moderator info, claim status for display.
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import type { ApplicationRow, ApplicationStatus } from "./types.js";

// ============================================================================
// Prepared Statements (cached at module load for performance)
// ============================================================================

const loadApplicationStmt = db.prepare(
  `SELECT id, guild_id, user_id, status
   FROM application
   WHERE id = ?`
);

const findPendingAppByUserIdStmt = db.prepare(
  `SELECT id, guild_id, user_id, status
   FROM application
   WHERE guild_id = ? AND user_id = ? AND status IN ('submitted', 'needs_info')
   ORDER BY created_at DESC
   LIMIT 1`
);

const updateReviewActionMetaStmt = db.prepare(
  `UPDATE review_action SET meta = json(?) WHERE id = ?`
);

const getRecentActionsForAppStmt = db.prepare(
  `SELECT action, moderator_id, reason, created_at
   FROM review_action
   WHERE app_id = ?
   ORDER BY created_at DESC
   LIMIT ?`
);

/**
 * WHAT: Row structure for recent review actions.
 * WHY: Type-safe results from getRecentActionsForApp query.
 */
export type RecentAction = {
  action: string;
  moderator_id: string;
  reason: string | null;
  created_at: number; // Unix epoch seconds
};

// ===== Application Queries =====

/**
 * loadApplication
 * WHAT: Fetch an application by ID.
 * WHY: Core query used throughout review flows.
 * @param appId - The application ID
 * @returns ApplicationRow or undefined if not found
 */
export function loadApplication(appId: string): ApplicationRow | undefined {
  return loadApplicationStmt.get(appId) as ApplicationRow | undefined;
}

/**
 * findPendingAppByUserId
 * WHAT: Finds a pending (submitted or needs_info) application for a user in a guild.
 * WHY: Enables UID-based targeting for /accept and /reject slash commands.
 * @param guildId - The guild ID
 * @param userId - The user ID
 * @returns ApplicationRow or null if not found
 */
export function findPendingAppByUserId(guildId: string, userId: string): ApplicationRow | null {
  return findPendingAppByUserIdStmt.get(guildId, userId) as ApplicationRow | null;
}

/**
 * updateReviewActionMeta
 * WHAT: Update the meta JSON field on a review_action row.
 * WHY: Store additional context (dmDelivered, roleApplied, etc.) for auditing.
 * @param id - The review_action row ID
 * @param meta - JSON-serializable object
 */
export function updateReviewActionMeta(id: number, meta: unknown) {
  updateReviewActionMetaStmt.run(JSON.stringify(meta), id);
}

/**
 * isClaimable
 * WHAT: Helper to determine if an application is in a claimable state.
 * WHY: Prevents claim attempts on terminal states (kicked, approved, rejected).
 * @param status - The application status
 * @returns true if the application can be claimed
 */
export function isClaimable(status: ApplicationStatus): boolean {
  return status === "submitted" || status === "needs_info";
}

/**
 * WHAT: Fetch recent review actions for an application.
 * WHY: Display action history on review card to reduce tab-switching for mods.
 * RETURNS: Array of recent actions, ordered newest first.
 * PERF: Uses idx_review_action_app_time (app_id, created_at DESC).
 */
// Fetches last N actions for display on review card history section.
// Index: idx_review_action_app_time (app_id, created_at DESC) makes this O(log n) + limit reads.
// Default limit=4 keeps the card compact while showing recent activity.
// Timing is logged for performance monitoring - if this gets slow, check index health.
// ===== Vote Out Queries =====

const getVoteOutCountStmt = db.prepare(
  `SELECT COUNT(*) as count FROM vote_out WHERE app_id = ?`
);

const getVoteOutVotersStmt = db.prepare(
  `SELECT voter_id FROM vote_out WHERE app_id = ? ORDER BY created_at ASC`
);

const insertVoteOutStmt = db.prepare(
  `INSERT OR IGNORE INTO vote_out (app_id, voter_id, created_at) VALUES (?, ?, datetime('now'))`
);

/**
 * WHAT: Get the current vote out count for an application.
 * WHY: Display on button label ("Vote Out (1/2)").
 */
export function getVoteOutCount(appId: string): number {
  const row = getVoteOutCountStmt.get(appId) as { count: number };
  return row.count;
}

/**
 * WHAT: Get ordered list of voter IDs for an application.
 * WHY: Format the public reply ("X and Y voted <@user> out.").
 */
export function getVoteOutVoters(appId: string): string[] {
  const rows = getVoteOutVotersStmt.all(appId) as Array<{ voter_id: string }>;
  return rows.map((r) => r.voter_id);
}

/**
 * WHAT: Insert a vote out vote (idempotent via UNIQUE constraint).
 * WHY: Track individual mod votes. Returns false on duplicate click.
 */
export function insertVoteOut(appId: string, voterId: string): boolean {
  const result = insertVoteOutStmt.run(appId, voterId);
  return result.changes > 0;
}

// ===== Recent Actions =====

export function getRecentActionsForApp(appId: string, limit = 4): RecentAction[] {
  const start = Date.now();

  const rows = getRecentActionsForAppStmt.all(appId, limit) as RecentAction[];

  const ms = Date.now() - start;
  logger.debug(
    { query: "getRecentActionsForApp", appId, limit, n: rows.length, ms },
    "[review] history_fetch"
  );

  return rows;
}
