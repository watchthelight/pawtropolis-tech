/**
 * Pawtropolis Tech — src/store/auditFindingsStore.ts
 * WHAT: Storage layer for command audit findings
 * WHY: Track audit results for commands, documentation accuracy, and permissions
 * FLOWS:
 *  - insertFinding(finding) → finding ID
 *  - getFindingsByRun(runId) → AuditFinding[]
 *  - getIssuesBySeverity(runId, severity) → AuditFinding[]
 *  - generateReportData(runId) → ReportData
 *  - listAuditRuns() → { runId, createdAt, commandCount }[]
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Types
// ============================================================================

export type TestStatus = "pass" | "fail" | "error" | "skipped" | "not_tested";
export type TestType = "live" | "mock" | "manual" | "api_limited";
export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface AuditFinding {
  id: number;
  audit_run_id: string;
  command_name: string;
  subcommand: string | null;
  test_status: TestStatus;
  test_type: TestType;
  issue_severity: IssueSeverity | null;
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

export interface InsertFindingParams {
  auditRunId: string;
  commandName: string;
  subcommand?: string | null;
  testStatus: TestStatus;
  testType: TestType;
  issueSeverity?: IssueSeverity | null;
  issueCategory?: string | null;
  issueTitle?: string | null;
  issueDescription?: string | null;
  responseTimeMs?: number | null;
  apiCallsMade?: number;
  apiCostEstimate?: number;
  docFile?: string | null;
  docAccurate?: boolean | null;
  docIssue?: string | null;
  expectedPermission?: string | null;
  actualPermission?: string | null;
  permissionMatch?: boolean | null;
  notes?: string | null;
}

export interface ReportData {
  auditRunId: string;
  totalCommands: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  errorCount: number;
  criticalIssues: AuditFinding[];
  highIssues: AuditFinding[];
  mediumIssues: AuditFinding[];
  lowIssues: AuditFinding[];
  infoIssues: AuditFinding[];
  totalApiCalls: number;
  totalApiCost: number;
  docIssues: AuditFinding[];
  permissionMismatches: AuditFinding[];
  allFindings: AuditFinding[];
}

// ============================================================================
// Prepared Statements
// ============================================================================

const insertFindingStmt = db.prepare(`
  INSERT INTO audit_findings (
    audit_run_id, command_name, subcommand, test_status, test_type,
    issue_severity, issue_category, issue_title, issue_description,
    response_time_ms, api_calls_made, api_cost_estimate,
    doc_file, doc_accurate, doc_issue,
    expected_permission, actual_permission, permission_match,
    notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getFindingsByRunStmt = db.prepare(`
  SELECT * FROM audit_findings
  WHERE audit_run_id = ?
  ORDER BY command_name, subcommand
`);

const getFindingsBySeverityStmt = db.prepare(`
  SELECT * FROM audit_findings
  WHERE audit_run_id = ? AND issue_severity = ?
  ORDER BY command_name, subcommand
`);

const getStatusCountsStmt = db.prepare(`
  SELECT
    test_status,
    COUNT(*) as count
  FROM audit_findings
  WHERE audit_run_id = ?
  GROUP BY test_status
`);

const getApiTotalsStmt = db.prepare(`
  SELECT
    COALESCE(SUM(api_calls_made), 0) as total_calls,
    COALESCE(SUM(api_cost_estimate), 0) as total_cost
  FROM audit_findings
  WHERE audit_run_id = ?
`);

const getDocIssuesStmt = db.prepare(`
  SELECT * FROM audit_findings
  WHERE audit_run_id = ? AND doc_accurate = 0
  ORDER BY doc_file
`);

const getPermMismatchesStmt = db.prepare(`
  SELECT * FROM audit_findings
  WHERE audit_run_id = ? AND permission_match = 0
  ORDER BY command_name
`);

const listAuditRunsStmt = db.prepare(`
  SELECT
    audit_run_id,
    MIN(created_at) as started_at,
    COUNT(*) as command_count,
    SUM(CASE WHEN test_status = 'pass' THEN 1 ELSE 0 END) as pass_count,
    SUM(CASE WHEN test_status = 'fail' THEN 1 ELSE 0 END) as fail_count
  FROM audit_findings
  GROUP BY audit_run_id
  ORDER BY started_at DESC
`);

// ============================================================================
// Functions
// ============================================================================

/**
 * Insert a new audit finding.
 */
export function insertFinding(params: InsertFindingParams): number {
  const {
    auditRunId,
    commandName,
    subcommand = null,
    testStatus,
    testType,
    issueSeverity = null,
    issueCategory = null,
    issueTitle = null,
    issueDescription = null,
    responseTimeMs = null,
    apiCallsMade = 0,
    apiCostEstimate = 0,
    docFile = null,
    docAccurate = null,
    docIssue = null,
    expectedPermission = null,
    actualPermission = null,
    permissionMatch = null,
    notes = null,
  } = params;

  try {
    const result = insertFindingStmt.run(
      auditRunId,
      commandName,
      subcommand,
      testStatus,
      testType,
      issueSeverity,
      issueCategory,
      issueTitle,
      issueDescription,
      responseTimeMs,
      apiCallsMade,
      apiCostEstimate,
      docFile,
      docAccurate === null ? null : docAccurate ? 1 : 0,
      docIssue,
      expectedPermission,
      actualPermission,
      permissionMatch === null ? null : permissionMatch ? 1 : 0,
      notes
    );

    const findingId = result.lastInsertRowid as number;

    logger.debug(
      { auditRunId, commandName, subcommand, testStatus, findingId },
      "[auditFindingsStore] Inserted finding"
    );

    return findingId;
  } catch (err) {
    logger.error({ err, auditRunId, commandName }, "[auditFindingsStore] Failed to insert finding");
    throw err;
  }
}

/**
 * Get all findings for an audit run.
 */
export function getFindingsByRun(runId: string): AuditFinding[] {
  try {
    return getFindingsByRunStmt.all(runId) as AuditFinding[];
  } catch (err) {
    logger.error({ err, runId }, "[auditFindingsStore] Failed to get findings by run");
    return [];
  }
}

/**
 * Get findings filtered by severity.
 */
export function getFindingsBySeverity(runId: string, severity: IssueSeverity): AuditFinding[] {
  try {
    return getFindingsBySeverityStmt.all(runId, severity) as AuditFinding[];
  } catch (err) {
    logger.error({ err, runId, severity }, "[auditFindingsStore] Failed to get findings by severity");
    return [];
  }
}

/**
 * Generate complete report data for an audit run.
 */
export function generateReportData(runId: string): ReportData {
  const allFindings = getFindingsByRun(runId);

  // Get status counts
  const statusCounts = getStatusCountsStmt.all(runId) as Array<{
    test_status: TestStatus;
    count: number;
  }>;
  const statusMap = new Map(statusCounts.map((r) => [r.test_status, r.count]));

  // Get API totals
  const apiTotals = getApiTotalsStmt.get(runId) as {
    total_calls: number;
    total_cost: number;
  };

  // Get doc issues
  const docIssues = getDocIssuesStmt.all(runId) as AuditFinding[];

  // Get permission mismatches
  const permissionMismatches = getPermMismatchesStmt.all(runId) as AuditFinding[];

  // Get issues by severity
  const criticalIssues = getFindingsBySeverity(runId, "critical");
  const highIssues = getFindingsBySeverity(runId, "high");
  const mediumIssues = getFindingsBySeverity(runId, "medium");
  const lowIssues = getFindingsBySeverity(runId, "low");
  const infoIssues = getFindingsBySeverity(runId, "info");

  return {
    auditRunId: runId,
    totalCommands: allFindings.length,
    passCount: statusMap.get("pass") ?? 0,
    failCount: statusMap.get("fail") ?? 0,
    skipCount: statusMap.get("skipped") ?? 0,
    errorCount: statusMap.get("error") ?? 0,
    criticalIssues,
    highIssues,
    mediumIssues,
    lowIssues,
    infoIssues,
    totalApiCalls: apiTotals.total_calls,
    totalApiCost: apiTotals.total_cost,
    docIssues,
    permissionMismatches,
    allFindings,
  };
}

/**
 * List all audit runs with summary info.
 */
export function listAuditRuns(): Array<{
  auditRunId: string;
  startedAt: number;
  commandCount: number;
  passCount: number;
  failCount: number;
}> {
  try {
    const rows = listAuditRunsStmt.all() as Array<{
      audit_run_id: string;
      started_at: number;
      command_count: number;
      pass_count: number;
      fail_count: number;
    }>;

    return rows.map((r) => ({
      auditRunId: r.audit_run_id,
      startedAt: r.started_at,
      commandCount: r.command_count,
      passCount: r.pass_count,
      failCount: r.fail_count,
    }));
  } catch (err) {
    logger.error({ err }, "[auditFindingsStore] Failed to list audit runs");
    return [];
  }
}

/**
 * Generate markdown report from audit data.
 */
export function generateMarkdownReport(data: ReportData): string {
  const passRate =
    data.totalCommands > 0 ? ((data.passCount / data.totalCommands) * 100).toFixed(1) : "0";

  const lines: string[] = [
    `# Pawtropolis Tech Command Audit Report`,
    ``,
    `**Audit Run ID:** \`${data.auditRunId}\``,
    `**Date:** ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Commands Tested | ${data.totalCommands} |`,
    `| Pass Rate | ${passRate}% |`,
    `| Critical Issues | ${data.criticalIssues.length} |`,
    `| High Issues | ${data.highIssues.length} |`,
    `| Medium Issues | ${data.mediumIssues.length} |`,
    `| Low Issues | ${data.lowIssues.length} |`,
    `| API Calls Made | ${data.totalApiCalls} |`,
    `| Estimated API Cost | $${data.totalApiCost.toFixed(4)} |`,
    ``,
  ];

  // Critical issues
  if (data.criticalIssues.length > 0) {
    lines.push(`## Critical Issues`, ``);
    for (const issue of data.criticalIssues) {
      lines.push(
        `### ${issue.command_name}${issue.subcommand ? ` ${issue.subcommand}` : ""}`,
        ``,
        `**${issue.issue_title || "Issue"}**`,
        ``,
        issue.issue_description || "No description provided.",
        ``
      );
    }
  }

  // High issues
  if (data.highIssues.length > 0) {
    lines.push(`## High Priority Issues`, ``);
    for (const issue of data.highIssues) {
      lines.push(
        `- **${issue.command_name}${issue.subcommand ? ` ${issue.subcommand}` : ""}**: ${issue.issue_title || "Issue"}`
      );
    }
    lines.push(``);
  }

  // Command results table
  lines.push(
    `## Command-by-Command Results`,
    ``,
    `| Command | Subcommand | Status | Response (ms) | Issues |`,
    `|---------|------------|--------|---------------|--------|`
  );

  for (const finding of data.allFindings) {
    const statusEmoji =
      finding.test_status === "pass"
        ? "PASS"
        : finding.test_status === "fail"
          ? "FAIL"
          : finding.test_status === "skipped"
            ? "SKIP"
            : finding.test_status === "error"
              ? "ERR"
              : "N/T";
    lines.push(
      `| ${finding.command_name} | ${finding.subcommand || "-"} | ${statusEmoji} | ${finding.response_time_ms ?? "-"} | ${finding.issue_title || "-"} |`
    );
  }

  lines.push(``);

  // Documentation issues
  if (data.docIssues.length > 0) {
    lines.push(`## Documentation Issues`, ``);
    for (const issue of data.docIssues) {
      lines.push(
        `- **${issue.doc_file}**: ${issue.doc_issue || "Inaccurate documentation"} (${issue.command_name})`
      );
    }
    lines.push(``);
  }

  // Permission mismatches
  if (data.permissionMismatches.length > 0) {
    lines.push(
      `## Permission Mismatches`,
      ``,
      `| Command | Expected | Actual |`,
      `|---------|----------|--------|`
    );
    for (const mismatch of data.permissionMismatches) {
      lines.push(
        `| ${mismatch.command_name} | ${mismatch.expected_permission || "-"} | ${mismatch.actual_permission || "-"} |`
      );
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `*Generated by Pawtropolis Tech Audit System*`
  );

  return lines.join("\n");
}
