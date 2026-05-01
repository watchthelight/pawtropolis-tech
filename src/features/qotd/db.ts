/**
 * Pawtropolis Tech — src/features/qotd/db.ts
 * WHAT: Database CRUD for QOTD suggestion system
 * WHY: Prepared statements for suggestion lifecycle, rate limiting, and queue
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import type { QotdSuggestionRow } from "./types.js";

// ── Lazy-init prepared statements ─────────────────────────────────────

let _insertSuggestion: ReturnType<typeof db.prepare> | null = null;
let _getSuggestionByCode: ReturnType<typeof db.prepare> | null = null;
let _getSuggestionById: ReturnType<typeof db.prepare> | null = null;
let _approveSuggestion: ReturnType<typeof db.prepare> | null = null;
let _rejectSuggestion: ReturnType<typeof db.prepare> | null = null;
let _markUsed: ReturnType<typeof db.prepare> | null = null;
let _getRandomApproved: ReturnType<typeof db.prepare> | null = null;
let _countPendingByUser: ReturnType<typeof db.prepare> | null = null;
let _getLastSuggestionTime: ReturnType<typeof db.prepare> | null = null;
let _getApprovedQueueSize: ReturnType<typeof db.prepare> | null = null;
let _getPendingQueueSize: ReturnType<typeof db.prepare> | null = null;
let _setReviewMessageId: ReturnType<typeof db.prepare> | null = null;

// ── Suggestion CRUD ───────────────────────────────────────────────────

export function insertSuggestion(
  guildId: string,
  userId: string,
  question: string,
  shortCode: string
): number {
  const stmt = (_insertSuggestion ??= db.prepare(`
    INSERT INTO qotd_suggestion (guild_id, user_id, question, short_code)
    VALUES (?, ?, ?, ?)
  `));
  const result = stmt.run(guildId, userId, question, shortCode);
  return result.lastInsertRowid as number;
}

export function getSuggestionByCode(
  guildId: string,
  shortCode: string
): QotdSuggestionRow | null {
  const stmt = (_getSuggestionByCode ??= db.prepare(`
    SELECT * FROM qotd_suggestion WHERE guild_id = ? AND short_code = ?
  `));
  return (stmt.get(guildId, shortCode) as QotdSuggestionRow) ?? null;
}

export function getSuggestionById(id: number): QotdSuggestionRow | null {
  const stmt = (_getSuggestionById ??= db.prepare(`
    SELECT * FROM qotd_suggestion WHERE id = ?
  `));
  return (stmt.get(id) as QotdSuggestionRow) ?? null;
}

export function setReviewMessageId(id: number, messageId: string): void {
  const stmt = (_setReviewMessageId ??= db.prepare(`
    UPDATE qotd_suggestion SET review_message_id = ? WHERE id = ?
  `));
  stmt.run(messageId, id);
}

// ── Approve / Reject ──────────────────────────────────────────────────

export function approveSuggestion(
  id: number,
  reviewerId: string
): boolean {
  const stmt = (_approveSuggestion ??= db.prepare(`
    UPDATE qotd_suggestion
    SET status = 'approved', reviewed_by = ?, reviewed_at_s = strftime('%s', 'now')
    WHERE id = ? AND status = 'pending'
  `));
  return stmt.run(reviewerId, id).changes > 0;
}

export function rejectSuggestion(
  id: number,
  reviewerId: string,
  reason: string
): boolean {
  const stmt = (_rejectSuggestion ??= db.prepare(`
    UPDATE qotd_suggestion
    SET status = 'rejected', reviewed_by = ?, reviewed_at_s = strftime('%s', 'now'), reject_reason = ?
    WHERE id = ? AND status = 'pending'
  `));
  return stmt.run(reviewerId, reason, id).changes > 0;
}

// ── Queue operations ──────────────────────────────────────────────────

/**
 * Pick a random approved suggestion. Staff can pull this to use as their QOTD.
 */
export function getRandomApproved(guildId: string): QotdSuggestionRow | null {
  const stmt = (_getRandomApproved ??= db.prepare(`
    SELECT * FROM qotd_suggestion
    WHERE guild_id = ? AND status = 'approved'
    ORDER BY RANDOM()
    LIMIT 1
  `));
  return (stmt.get(guildId) as QotdSuggestionRow) ?? null;
}

/**
 * Mark a suggestion as used (pulled by staff for QOTD).
 * Atomic: returns false if already used by someone else.
 */
export function markSuggestionUsed(
  id: number,
  usedBy: string
): boolean {
  const stmt = (_markUsed ??= db.prepare(`
    UPDATE qotd_suggestion
    SET status = 'used', used_by = ?, used_at_s = strftime('%s', 'now')
    WHERE id = ? AND status = 'approved'
  `));
  return stmt.run(usedBy, id).changes > 0;
}

/**
 * Move a rejected/used suggestion back to approved (dashboard restore action).
 * Pending suggestions are not restored — they are already actionable.
 */
export function restoreSuggestion(id: number, reviewerId: string): boolean {
  const stmt = db.prepare(`
    UPDATE qotd_suggestion
    SET status = 'approved', reviewed_by = ?, reviewed_at_s = strftime('%s', 'now'),
        reject_reason = NULL, used_by = NULL, used_at_s = NULL
    WHERE id = ? AND status IN ('rejected', 'used')
  `);
  return stmt.run(reviewerId, id).changes > 0;
}

/**
 * Edit the question text. Allowed only on pending suggestions so reviewers can
 * tighten phrasing before approval — once approved/used, edits are blocked to
 * preserve audit trail.
 */
export function editSuggestionQuestion(id: number, newQuestion: string): boolean {
  const stmt = db.prepare(`
    UPDATE qotd_suggestion
    SET question = ?
    WHERE id = ? AND status = 'pending'
  `);
  return stmt.run(newQuestion, id).changes > 0;
}

export function getApprovedQueueSize(guildId: string): number {
  const stmt = (_getApprovedQueueSize ??= db.prepare(`
    SELECT COUNT(*) as count FROM qotd_suggestion
    WHERE guild_id = ? AND status = 'approved'
  `));
  return (stmt.get(guildId) as { count: number }).count;
}

export function getPendingQueueSize(guildId: string): number {
  const stmt = (_getPendingQueueSize ??= db.prepare(`
    SELECT COUNT(*) as count FROM qotd_suggestion
    WHERE guild_id = ? AND status = 'pending'
  `));
  return (stmt.get(guildId) as { count: number }).count;
}

// ── Rate limiting ─────────────────────────────────────────────────────

export function countPendingByUser(guildId: string, userId: string): number {
  const stmt = (_countPendingByUser ??= db.prepare(`
    SELECT COUNT(*) as count FROM qotd_suggestion
    WHERE guild_id = ? AND user_id = ? AND status = 'pending'
  `));
  return (stmt.get(guildId, userId) as { count: number }).count;
}

export function getLastSuggestionTime(guildId: string, userId: string): number | null {
  const stmt = (_getLastSuggestionTime ??= db.prepare(`
    SELECT MAX(created_at_s) as last_at FROM qotd_suggestion
    WHERE guild_id = ? AND user_id = ?
  `));
  return (stmt.get(guildId, userId) as { last_at: number | null }).last_at;
}
