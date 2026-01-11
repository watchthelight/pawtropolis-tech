/**
 * Pawtropolis Tech — src/store/securitySnapshotStore.ts
 * WHAT: Storage layer for security audit snapshots and history
 * WHY: Enable diff tracking between audits, historical trends, and change detection
 * FLOWS:
 *  - saveSnapshot({ guildId, ... }) → snapshotId
 *  - getLatestSnapshot(guildId) → SecuritySnapshot | null
 *  - getSnapshotHistory(guildId, limit) → SecuritySnapshot[]
 *  - recordIssueHistory({ guildId, ... }) → void
 *  - getIssueHistory(guildId, days) → IssueHistoryEntry[]
 *  - pruneOldSnapshots(guildId, keepCount) → number
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { LRUCache } from "../lib/lruCache.js";
import crypto from "node:crypto";

// ============================================================================
// Types
// ============================================================================

export interface SecuritySnapshot {
  id: number;
  guildId: string;
  createdAt: number; // Unix epoch seconds
  roleCount: number;
  channelCount: number;
  issueCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  rolesSnapshot: RoleSnapshot[];
  channelsSnapshot: ChannelSnapshot[];
  issuesSnapshot: IssueSnapshot[];
  contentHash: string;
}

export interface RoleSnapshot {
  id: string;
  name: string;
  position: number;
  color: number;
  managed: boolean;
  permissions: string; // Bitfield as string
  memberCount: number;
}

export interface ChannelSnapshot {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number;
  overwrites: PermissionOverwriteSnapshot[];
}

export interface PermissionOverwriteSnapshot {
  id: string;
  type: "role" | "member";
  allow: string; // Bitfield as string
  deny: string; // Bitfield as string
}

export interface IssueSnapshot {
  key: string;
  severity: string;
  title: string;
  description: string;
  targetId: string;
  targetName: string;
  permissionHash: string;
}

export interface IssueHistoryEntry {
  id: number;
  guildId: string;
  recordedAt: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  acknowledgedCount: number;
  roleIssues: number;
  channelIssues: number;
  hierarchyIssues: number;
  verificationIssues: number;
}

interface SnapshotRow {
  id: number;
  guild_id: string;
  created_at: number;
  role_count: number;
  channel_count: number;
  issue_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  roles_snapshot: string;
  channels_snapshot: string;
  issues_snapshot: string;
  content_hash: string;
}

interface HistoryRow {
  id: number;
  guild_id: string;
  recorded_at: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  acknowledged_count: number;
  role_issues: number;
  channel_issues: number;
  hierarchy_issues: number;
  verification_issues: number;
}

// ============================================================================
// Prepared Statements
// ============================================================================

const insertSnapshotStmt = db.prepare(`
  INSERT INTO security_audit_snapshots (
    guild_id, role_count, channel_count, issue_count,
    critical_count, high_count, medium_count, low_count,
    roles_snapshot, channels_snapshot, issues_snapshot, content_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getLatestSnapshotStmt = db.prepare(`
  SELECT * FROM security_audit_snapshots
  WHERE guild_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`);

const getSnapshotHistoryStmt = db.prepare(`
  SELECT * FROM security_audit_snapshots
  WHERE guild_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const pruneSnapshotsStmt = db.prepare(`
  DELETE FROM security_audit_snapshots
  WHERE guild_id = ? AND id NOT IN (
    SELECT id FROM security_audit_snapshots
    WHERE guild_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  )
`);

const insertHistoryStmt = db.prepare(`
  INSERT INTO security_issue_history (
    guild_id, critical_count, high_count, medium_count, low_count,
    acknowledged_count, role_issues, channel_issues, hierarchy_issues, verification_issues
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getHistoryStmt = db.prepare(`
  SELECT * FROM security_issue_history
  WHERE guild_id = ? AND recorded_at >= ?
  ORDER BY recorded_at DESC
`);

// ============================================================================
// Cache Layer
// ============================================================================

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_SIZE = 50;

const snapshotCache = new LRUCache<string, SecuritySnapshot | null>(CACHE_MAX_SIZE, CACHE_TTL_MS);

function invalidateCache(guildId: string): void {
  snapshotCache.delete(guildId);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute a content hash for change detection.
 * Uses MD5 of roles + channels JSON for quick "did anything change?" check.
 */
export function computeContentHash(roles: RoleSnapshot[], channels: ChannelSnapshot[]): string {
  const content = JSON.stringify({ roles, channels });
  return crypto.createHash("md5").update(content).digest("hex");
}

function rowToSnapshot(row: SnapshotRow): SecuritySnapshot {
  return {
    id: row.id,
    guildId: row.guild_id,
    createdAt: row.created_at,
    roleCount: row.role_count,
    channelCount: row.channel_count,
    issueCount: row.issue_count,
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    lowCount: row.low_count,
    rolesSnapshot: JSON.parse(row.roles_snapshot) as RoleSnapshot[],
    channelsSnapshot: JSON.parse(row.channels_snapshot) as ChannelSnapshot[],
    issuesSnapshot: JSON.parse(row.issues_snapshot) as IssueSnapshot[],
    contentHash: row.content_hash,
  };
}

function rowToHistory(row: HistoryRow): IssueHistoryEntry {
  return {
    id: row.id,
    guildId: row.guild_id,
    recordedAt: row.recorded_at,
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    lowCount: row.low_count,
    acknowledgedCount: row.acknowledged_count,
    roleIssues: row.role_issues,
    channelIssues: row.channel_issues,
    hierarchyIssues: row.hierarchy_issues,
    verificationIssues: row.verification_issues,
  };
}

// ============================================================================
// Public Functions - Snapshots
// ============================================================================

/**
 * Save a new security audit snapshot.
 * @returns The ID of the newly created snapshot
 */
export function saveSnapshot(params: {
  guildId: string;
  roleCount: number;
  channelCount: number;
  issueCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  rolesSnapshot: RoleSnapshot[];
  channelsSnapshot: ChannelSnapshot[];
  issuesSnapshot: IssueSnapshot[];
}): number {
  const {
    guildId,
    roleCount,
    channelCount,
    issueCount,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    rolesSnapshot,
    channelsSnapshot,
    issuesSnapshot,
  } = params;

  const contentHash = computeContentHash(rolesSnapshot, channelsSnapshot);

  try {
    const result = insertSnapshotStmt.run(
      guildId,
      roleCount,
      channelCount,
      issueCount,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      JSON.stringify(rolesSnapshot),
      JSON.stringify(channelsSnapshot),
      JSON.stringify(issuesSnapshot),
      contentHash
    );

    invalidateCache(guildId);

    logger.info(
      { guildId, snapshotId: result.lastInsertRowid, roleCount, channelCount, issueCount },
      "[securitySnapshotStore] Snapshot saved"
    );

    return Number(result.lastInsertRowid);
  } catch (err) {
    logger.error({ err, guildId }, "[securitySnapshotStore] Failed to save snapshot");
    throw err;
  }
}

/**
 * Get the most recent snapshot for a guild.
 * @returns The latest snapshot or null if none exists
 */
export function getLatestSnapshot(guildId: string): SecuritySnapshot | null {
  // Check cache first
  const cached = snapshotCache.get(guildId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const row = getLatestSnapshotStmt.get(guildId) as SnapshotRow | undefined;

    if (!row) {
      snapshotCache.set(guildId, null);
      return null;
    }

    const snapshot = rowToSnapshot(row);
    snapshotCache.set(guildId, snapshot);
    return snapshot;
  } catch (err) {
    logger.warn({ err, guildId }, "[securitySnapshotStore] Failed to get latest snapshot");
    return null;
  }
}

/**
 * Get recent snapshots for a guild (for comparison/history).
 */
export function getSnapshotHistory(guildId: string, limit: number = 10): SecuritySnapshot[] {
  try {
    const rows = getSnapshotHistoryStmt.all(guildId, limit) as SnapshotRow[];
    return rows.map(rowToSnapshot);
  } catch (err) {
    logger.warn({ err, guildId }, "[securitySnapshotStore] Failed to get snapshot history");
    return [];
  }
}

/**
 * Prune old snapshots to prevent unbounded growth.
 * Keeps the most recent `keepCount` snapshots per guild.
 * @returns Number of snapshots deleted
 */
export function pruneOldSnapshots(guildId: string, keepCount: number = 30): number {
  try {
    const result = pruneSnapshotsStmt.run(guildId, guildId, keepCount);

    if (result.changes > 0) {
      invalidateCache(guildId);
      logger.info(
        { guildId, deletedCount: result.changes, kept: keepCount },
        "[securitySnapshotStore] Pruned old snapshots"
      );
    }

    return result.changes;
  } catch (err) {
    logger.error({ err, guildId }, "[securitySnapshotStore] Failed to prune snapshots");
    return 0;
  }
}

// ============================================================================
// Public Functions - Issue History
// ============================================================================

/**
 * Record issue counts for trend tracking.
 */
export function recordIssueHistory(params: {
  guildId: string;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  acknowledgedCount: number;
  roleIssues: number;
  channelIssues: number;
  hierarchyIssues: number;
  verificationIssues: number;
}): void {
  const {
    guildId,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    acknowledgedCount,
    roleIssues,
    channelIssues,
    hierarchyIssues,
    verificationIssues,
  } = params;

  try {
    insertHistoryStmt.run(
      guildId,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      acknowledgedCount,
      roleIssues,
      channelIssues,
      hierarchyIssues,
      verificationIssues
    );

    logger.debug(
      { guildId, criticalCount, highCount, mediumCount, lowCount },
      "[securitySnapshotStore] Issue history recorded"
    );
  } catch (err) {
    logger.error({ err, guildId }, "[securitySnapshotStore] Failed to record issue history");
    // Don't throw - history recording is non-critical
  }
}

/**
 * Get issue history for trend analysis.
 * @param guildId - Guild to get history for
 * @param days - Number of days to look back (default: 30)
 */
export function getIssueHistory(guildId: string, days: number = 30): IssueHistoryEntry[] {
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  try {
    const rows = getHistoryStmt.all(guildId, cutoffTimestamp) as HistoryRow[];
    return rows.map(rowToHistory);
  } catch (err) {
    logger.warn({ err, guildId }, "[securitySnapshotStore] Failed to get issue history");
    return [];
  }
}

/**
 * Check if content has changed since last snapshot.
 * Quick check using hash comparison.
 */
export function hasContentChanged(guildId: string, newHash: string): boolean {
  const latest = getLatestSnapshot(guildId);
  if (!latest) return true; // No previous snapshot = definitely changed
  return latest.contentHash !== newHash;
}

/**
 * Clear cache for a guild (e.g., on guildDelete).
 */
export function clearSnapshotCache(guildId: string): void {
  snapshotCache.delete(guildId);
}
