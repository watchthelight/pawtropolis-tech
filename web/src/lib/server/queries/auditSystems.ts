import { db } from "$lib/server/db";
import { normalizeTimestamp } from "./shared";

// ---------------------------------------------------------------------------
// Security audit snapshots
// ---------------------------------------------------------------------------

export interface SecuritySnapshotSummary {
  id: number;
  createdAt: number;
  roleCount: number;
  channelCount: number;
  issueCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  contentHash: string;
}

interface SnapshotSummaryRow {
  id: number;
  created_at: number;
  role_count: number;
  channel_count: number;
  issue_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  content_hash: string;
}

export interface SecuritySnapshotFull extends SecuritySnapshotSummary {
  rolesSnapshot: unknown[];
  channelsSnapshot: unknown[];
  issuesSnapshot: unknown[];
}

interface SnapshotFullRow extends SnapshotSummaryRow {
  roles_snapshot: string;
  channels_snapshot: string;
  issues_snapshot: string;
}

function mapSnapshotSummary(row: SnapshotSummaryRow): SecuritySnapshotSummary {
  return {
    id: row.id,
    createdAt: row.created_at * 1000,
    roleCount: row.role_count,
    channelCount: row.channel_count,
    issueCount: row.issue_count,
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    lowCount: row.low_count,
    contentHash: row.content_hash,
  };
}

function safeJsonParse(json: string): unknown[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export function getLatestSecuritySnapshot(guildId: string): SecuritySnapshotSummary | null {
  const row = db()
    .prepare(
      `
		SELECT id, created_at, role_count, channel_count, issue_count,
			critical_count, high_count, medium_count, low_count, content_hash
		FROM security_audit_snapshots
		WHERE guild_id = ?
		ORDER BY created_at DESC LIMIT 1
	`
    )
    .get(guildId) as SnapshotSummaryRow | undefined;
  return row ? mapSnapshotSummary(row) : null;
}

export function getSecuritySnapshots(
  guildId: string,
  limit: number = 20
): SecuritySnapshotSummary[] {
  const rows = db()
    .prepare(
      `
		SELECT id, created_at, role_count, channel_count, issue_count,
			critical_count, high_count, medium_count, low_count, content_hash
		FROM security_audit_snapshots
		WHERE guild_id = ?
		ORDER BY created_at DESC LIMIT ?
	`
    )
    .all(guildId, limit) as SnapshotSummaryRow[];
  return rows.map(mapSnapshotSummary);
}

export function getSecuritySnapshotFull(
  guildId: string,
  snapshotId: number
): SecuritySnapshotFull | null {
  const row = db()
    .prepare(
      `
		SELECT id, created_at, role_count, channel_count, issue_count,
			critical_count, high_count, medium_count, low_count, content_hash,
			roles_snapshot, channels_snapshot, issues_snapshot
		FROM security_audit_snapshots
		WHERE guild_id = ? AND id = ?
	`
    )
    .get(guildId, snapshotId) as SnapshotFullRow | undefined;
  if (!row) return null;
  return {
    ...mapSnapshotSummary(row),
    rolesSnapshot: safeJsonParse(row.roles_snapshot),
    channelsSnapshot: safeJsonParse(row.channels_snapshot),
    issuesSnapshot: safeJsonParse(row.issues_snapshot),
  };
}

// ---------------------------------------------------------------------------
// Security issue trends
// ---------------------------------------------------------------------------

export interface IssueHistoryEntry {
  recordedAt: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  acknowledgedCount: number;
}

interface IssueHistoryRow {
  recorded_at: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  acknowledged_count: number;
}

export function getSecurityIssueTrends(guildId: string, days: number = 30): IssueHistoryEntry[] {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db()
    .prepare(
      `
		SELECT recorded_at, critical_count, high_count, medium_count, low_count, acknowledged_count
		FROM security_issue_history
		WHERE guild_id = ? AND recorded_at >= ?
		ORDER BY recorded_at ASC
	`
    )
    .all(guildId, cutoff) as IssueHistoryRow[];
  return rows.map((row) => ({
    recordedAt: row.recorded_at * 1000,
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    lowCount: row.low_count,
    acknowledgedCount: row.acknowledged_count,
  }));
}

// ---------------------------------------------------------------------------
// Acknowledged security issues
// ---------------------------------------------------------------------------

export interface AcknowledgedIssueItem {
  issueKey: string;
  severity: string;
  title: string;
  acknowledgedBy: string;
  acknowledgedAt: number;
  reason: string | null;
}

interface AcknowledgedRow {
  issue_key: string;
  severity: string;
  title: string;
  acknowledged_by: string;
  acknowledged_at: number;
  reason: string | null;
}

export function getAcknowledgedIssuesList(guildId: string): AcknowledgedIssueItem[] {
  const rows = db()
    .prepare(
      `
		SELECT issue_key, severity, title, acknowledged_by, acknowledged_at, reason
		FROM acknowledged_security_issues
		WHERE guild_id = ?
		ORDER BY acknowledged_at DESC
	`
    )
    .all(guildId) as AcknowledgedRow[];
  return rows.map((row) => ({
    issueKey: row.issue_key,
    severity: row.severity,
    title: row.title,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at * 1000,
    reason: row.reason,
  }));
}

// ---------------------------------------------------------------------------
// Audit sessions (member / NSFW scans)
// ---------------------------------------------------------------------------

export interface AuditSessionItem {
  id: number;
  auditType: string;
  scope: string | null;
  status: string;
  startedBy: string;
  startedAt: number | null;
  completedAt: number | null;
  totalToScan: number;
  scannedCount: number;
  flaggedCount: number;
  apiCalls: number;
}

interface AuditSessionRow {
  id: number;
  audit_type: string;
  scope: string | null;
  status: string;
  started_by: string;
  started_at: string | null;
  completed_at: string | null;
  total_to_scan: number;
  scanned_count: number;
  flagged_count: number;
  api_calls: number;
}

function mapSession(row: AuditSessionRow): AuditSessionItem {
  return {
    id: row.id,
    auditType: row.audit_type,
    scope: row.scope,
    status: row.status,
    startedBy: row.started_by,
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at),
    totalToScan: row.total_to_scan,
    scannedCount: row.scanned_count,
    flaggedCount: row.flagged_count,
    apiCalls: row.api_calls,
  };
}

export function getAuditSessions(guildId: string, limit: number = 20): AuditSessionItem[] {
  const rows = db()
    .prepare(
      `
		SELECT id, audit_type, scope, status, started_by, started_at, completed_at,
			total_to_scan, scanned_count, flagged_count, api_calls
		FROM audit_sessions
		WHERE guild_id = ?
		ORDER BY id DESC LIMIT ?
	`
    )
    .all(guildId, limit) as AuditSessionRow[];
  return rows.map(mapSession);
}

export function getActiveAuditSession(guildId: string, auditType: string): AuditSessionItem | null {
  const row = db()
    .prepare(
      `
		SELECT id, audit_type, scope, status, started_by, started_at, completed_at,
			total_to_scan, scanned_count, flagged_count, api_calls
		FROM audit_sessions
		WHERE guild_id = ? AND audit_type = ? AND status = 'in_progress'
		ORDER BY id DESC LIMIT 1
	`
    )
    .get(guildId, auditType) as AuditSessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function getAuditSessionDetail(sessionId: number): AuditSessionItem | null {
  const row = db()
    .prepare(
      `
		SELECT id, audit_type, scope, status, started_by, started_at, completed_at,
			total_to_scan, scanned_count, flagged_count, api_calls
		FROM audit_sessions
		WHERE id = ?
	`
    )
    .get(sessionId) as AuditSessionRow | undefined;
  return row ? mapSession(row) : null;
}

// ---------------------------------------------------------------------------
// Audit findings (command audit results)
// ---------------------------------------------------------------------------

export interface AuditRunSummary {
  auditRunId: string;
  startedAt: number;
  commandCount: number;
  passCount: number;
  failCount: number;
  errorCount: number;
  skipCount: number;
}

interface AuditRunRow {
  audit_run_id: string;
  started_at: number;
  command_count: number;
  pass_count: number;
  fail_count: number;
  error_count: number;
  skip_count: number;
}

export function getAuditRuns(): AuditRunSummary[] {
  const rows = db()
    .prepare(
      `
		SELECT
			audit_run_id,
			MIN(created_at) as started_at,
			COUNT(*) as command_count,
			SUM(CASE WHEN test_status = 'pass' THEN 1 ELSE 0 END) as pass_count,
			SUM(CASE WHEN test_status = 'fail' THEN 1 ELSE 0 END) as fail_count,
			SUM(CASE WHEN test_status = 'error' THEN 1 ELSE 0 END) as error_count,
			SUM(CASE WHEN test_status IN ('skipped', 'not_tested') THEN 1 ELSE 0 END) as skip_count
		FROM audit_findings
		GROUP BY audit_run_id
		ORDER BY started_at DESC
	`
    )
    .all() as AuditRunRow[];
  return rows.map((row) => ({
    auditRunId: row.audit_run_id,
    startedAt: row.started_at * 1000,
    commandCount: row.command_count,
    passCount: row.pass_count,
    failCount: row.fail_count,
    errorCount: row.error_count,
    skipCount: row.skip_count,
  }));
}

export interface AuditFindingItem {
  id: number;
  auditRunId: string;
  commandName: string;
  subcommand: string | null;
  testStatus: string;
  testType: string;
  issueSeverity: string | null;
  issueCategory: string | null;
  issueTitle: string | null;
  issueDescription: string | null;
  responseTimeMs: number | null;
  apiCallsMade: number;
  apiCostEstimate: number;
  docFile: string | null;
  docAccurate: boolean | null;
  docIssue: string | null;
  expectedPermission: string | null;
  actualPermission: string | null;
  permissionMatch: boolean | null;
  notes: string | null;
  createdAt: number;
}

interface AuditFindingRow {
  id: number;
  audit_run_id: string;
  command_name: string;
  subcommand: string | null;
  test_status: string;
  test_type: string;
  issue_severity: string | null;
  issue_category: string | null;
  issue_title: string | null;
  issue_description: string | null;
  response_time_ms: number | null;
  api_calls_made: number;
  api_cost_estimate: number;
  doc_file: string | null;
  doc_accurate: number | null;
  doc_issue: string | null;
  expected_permission: string | null;
  actual_permission: string | null;
  permission_match: number | null;
  notes: string | null;
  created_at: number;
}

export function getAuditRunFindings(runId: string): AuditFindingItem[] {
  const rows = db()
    .prepare(
      `
		SELECT * FROM audit_findings
		WHERE audit_run_id = ?
		ORDER BY issue_severity IS NULL, issue_severity, command_name, subcommand
	`
    )
    .all(runId) as AuditFindingRow[];
  return rows.map((row) => ({
    id: row.id,
    auditRunId: row.audit_run_id,
    commandName: row.command_name,
    subcommand: row.subcommand,
    testStatus: row.test_status,
    testType: row.test_type,
    issueSeverity: row.issue_severity,
    issueCategory: row.issue_category,
    issueTitle: row.issue_title,
    issueDescription: row.issue_description,
    responseTimeMs: row.response_time_ms,
    apiCallsMade: row.api_calls_made,
    apiCostEstimate: row.api_cost_estimate,
    docFile: row.doc_file,
    docAccurate: row.doc_accurate !== null ? row.doc_accurate === 1 : null,
    docIssue: row.doc_issue,
    expectedPermission: row.expected_permission,
    actualPermission: row.actual_permission,
    permissionMatch: row.permission_match !== null ? row.permission_match === 1 : null,
    notes: row.notes,
    createdAt: row.created_at * 1000,
  }));
}

export interface AuditRunStats {
  commandCount: number;
  passCount: number;
  failCount: number;
  errorCount: number;
  skipCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  totalApiCalls: number;
  totalApiCost: number;
}

interface AuditRunStatsRow {
  command_count: number;
  pass_count: number;
  fail_count: number;
  error_count: number;
  skip_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
  total_api_calls: number;
  total_api_cost: number;
}

export function getAuditRunStats(runId: string): AuditRunStats {
  const row = db()
    .prepare(
      `
		SELECT
			COUNT(*) as command_count,
			SUM(CASE WHEN test_status = 'pass' THEN 1 ELSE 0 END) as pass_count,
			SUM(CASE WHEN test_status = 'fail' THEN 1 ELSE 0 END) as fail_count,
			SUM(CASE WHEN test_status = 'error' THEN 1 ELSE 0 END) as error_count,
			SUM(CASE WHEN test_status IN ('skipped', 'not_tested') THEN 1 ELSE 0 END) as skip_count,
			SUM(CASE WHEN issue_severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
			SUM(CASE WHEN issue_severity = 'high' THEN 1 ELSE 0 END) as high_count,
			SUM(CASE WHEN issue_severity = 'medium' THEN 1 ELSE 0 END) as medium_count,
			SUM(CASE WHEN issue_severity = 'low' THEN 1 ELSE 0 END) as low_count,
			SUM(CASE WHEN issue_severity = 'info' THEN 1 ELSE 0 END) as info_count,
			SUM(api_calls_made) as total_api_calls,
			SUM(api_cost_estimate) as total_api_cost
		FROM audit_findings
		WHERE audit_run_id = ?
	`
    )
    .get(runId) as AuditRunStatsRow;
  return {
    commandCount: row.command_count,
    passCount: row.pass_count,
    failCount: row.fail_count,
    errorCount: row.error_count,
    skipCount: row.skip_count,
    criticalCount: row.critical_count,
    highCount: row.high_count,
    mediumCount: row.medium_count,
    lowCount: row.low_count,
    infoCount: row.info_count,
    totalApiCalls: row.total_api_calls,
    totalApiCost: row.total_api_cost,
  };
}
