# Code Quality Findings (2026-05-19)

## Executive Summary

Scanned 312 TypeScript files across nine dimensions of code quality. Total findings: 27 items. 0 Critical, 7 High, 16 Medium, 4 Low, 0 Nominal. Major issues cluster in three areas: (1) large monolithic files that exceed 1000 lines and bundle too many responsibilities, (2) extensive linter failures (4,545 total: 2,273 errors, 2,272 warnings) mostly in test files and scripts with lazy-typed any, (3) test coverage gaps in critical scheduler and feature modules. Type safety passes (npm run typecheck succeeds cleanly). Format drift is worst in web/ (925 violations).

---

## Finding 1: index.ts is a monolithic event router doing too much
- Severity: High
- Type: refactor
- File(s): src/index.ts:1-2705
- Evidence: 2,705-line main entry orchestrates 30+ Discord event handlers inline (guildCreate, messageCreate, threadDelete, voiceStateUpdate, etc.), command routing logic, and startup/shutdown. Each handler is wrapped inline with logic that belongs in separate event modules. Single point of maintenance for unrelated concerns.
- Proposed action: Extract each event handler into src/events/ (one file per Discord event type). Move interaction router to src/features/interactionRouter.ts. Aim for index.ts under 300 lines.

## Finding 2: dashboardApi.ts mixes routes, business logic, and authorization
- Severity: High
- Type: refactor
- File(s): src/web/dashboardApi.ts:1-1792
- Evidence: Fastify server with 1,792 lines containing 20+ POST route handlers. Each route inlines authorization check, db queries, transactional logic, error handling. No middleware pattern.
- Proposed action: Extract route groups into src/web/routes/<name>Routes.ts. Create shared helpers in src/web/routeHelpers.ts. Use Fastify register() for composition.

## Finding 3: audit.ts combines 5 audit workflows in one handler
- Severity: High
- Type: refactor
- File(s): src/commands/audit.ts:1-1760
- Evidence: 1,760 lines with subcommands for members, nsfw, findings, acknowledge. Each subcommand has its own multi-step workflow with error handling, embed generation, button creation, and db queries inlined.
- Proposed action: Create src/commands/audit/ subdirectory: members.ts, nsfw.ts, findings.ts, acknowledge.ts. Extract shared workflows to audit/shared.ts.

## Finding 4: serverAuditDocs.ts mixes generation and security analysis
- Severity: High
- Type: refactor
- File(s): src/features/serverAuditDocs.ts:1-1740
- Evidence: Three separate concerns in one file: markdown audit docs generation, security diff analysis, git commit/push.
- Proposed action: Split into src/features/auditDocs/generator.ts, src/features/auditDocs/analyzer.ts, src/features/auditDocs/vcs.ts.

## Finding 5: gate.ts orchestrates RBAC with minimal decomposition
- Severity: High
- Type: refactor
- File(s): src/features/gate.ts:1-1602
- Evidence: 1,602 lines implementing /gate command and its modals. Handlers for handleStartButton, handleGateModalSubmit, handleDoneButton share duplicated state checks. Hard to change one step without touching the whole flow.
- Proposed action: Extract gate flow into a state machine: src/features/gate/flow.ts with explicit states. Move each handler to gate/handlers/<name>.ts. Reduce main gate.ts to ~200 lines.

## Finding 6: Disabled health.ts timeout test
- Severity: Medium
- Type: chore
- File(s): tests/commands/health.test.ts:138-157
- Evidence: it.skip("handles timeout gracefully with ephemeral message") with comment about fake-timer difficulty. No tracked issue, no timeline.
- Proposed action: Either refactor health command to avoid Promise.race, use real timers + timeout, or move to integration tests. Reference the issue in the skip comment.

## Finding 7: Disabled flag.store.test.ts suite (module-level mocking)
- Severity: Medium
- Type: bug
- File(s): tests/flag.store.test.ts:14-20
- Evidence: describe.skip() blocks the entire file because src/features/flagsStore.ts calls db.prepare() at top level before vi.mock can intercept. Flag CRUD has zero coverage.
- Proposed action: Refactor src/features/flagsStore.ts to lazy-initialize prepared statements inside each function. Then un-skip the test file.

## Finding 8: Disabled config.test.ts hasStaffPermissions tests
- Severity: Medium
- Type: chore
- File(s): tests/lib/config.test.ts:67-78
- Evidence: describe.skip on hasStaffPermissions due to internal require() that cannot be mocked. Four it.todo() tests unimplemented. Staff permission logic central to access control but untested.
- Proposed action: Refactor hasStaffPermissions to accept dependencies (guildMember, client) rather than require() them, then un-skip and implement the todo tests.

## Finding 9: Missing tests for avatarScan.ts
- Severity: Medium
- Type: chore
- File(s): src/features/avatarScan.ts (390 lines, no test neighbor)
- Evidence: Implements avatar NSFW/risk classification via Google Vision. No tests cover risk logic, API error handling, image type validation. Security-sensitive (flags questionable content).
- Proposed action: Create tests/features/avatarScan.test.ts with Vision API mocks. Cover risk levels, error cases, edge cases.

## Finding 10: Missing tests for auditRunner.ts
- Severity: Medium
- Type: chore
- File(s): src/features/auditRunner.ts (351 lines, no test neighbor)
- Evidence: Manages audit lifecycle and persists state to db. No tests on session creation/resumption, progress tracking, cancellation, error cleanup.
- Proposed action: Create tests/features/auditRunner.test.ts. Mock session store and db. Test lifecycle, progress mutation, cancellation, orphan cleanup.

## Finding 11: Missing tests for securityDiff.ts
- Severity: Medium
- Type: chore
- File(s): src/features/securityDiff.ts (626 lines, no test neighbor)
- Evidence: Computes security issue diffs and identifies dangerous changes. Used by audit reporting. No tests on diff algo, dangerous-change classification, edge cases.
- Proposed action: Create tests/features/securityDiff.test.ts. Sample snapshots, role/permission changes, empty diffs.

## Finding 12: Missing tests for byteTokenHandler.ts
- Severity: Medium
- Type: chore
- File(s): src/features/byteTokenHandler.ts (607 lines, no test neighbor)
- Evidence: Token distribution and reward logic. grantBytes, applyMultiplier, computeReward untested. Economy system; bad logic affects fairness.
- Proposed action: Create tests/features/byteTokenHandler.test.ts. Mock db and config. Test reward calc for tiers, multipliers, edge cases.

## Finding 13: Missing tests for 5 scheduler modules
- Severity: Medium
- Type: chore
- File(s): src/scheduler/byteMultiplierScheduler.ts, diskSpaceScheduler.ts, eventTimeoutScheduler.ts, guildSnapshotScheduler.ts, securityAuditScheduler.ts
- Evidence: 4 of 9 schedulers tested. Periodic jobs without tests can silently break.
- Proposed action: Create test files for the 5 missing schedulers under tests/scheduler/.

## Finding 14: Web component and route tests nearly absent
- Severity: High
- Type: chore
- File(s): web/src/ (79 .svelte files, 127 .ts/.js files), tests/web/ (1 file)
- Evidence: 206 components and route handlers; 1 test file. Critical API routes and dashboard pages untested.
- Proposed action: Prioritize API route tests for review/profile, modmail/send, sse. Then dashboard pages: Reviews, Tickets, Audit.

## Finding 15: Lazy any types in scripts/commands.ts
- Severity: Medium
- Type: refactor
- File(s): scripts/commands.ts:50-180 (16 instances)
- Evidence: Command-metadata generator uses : any for command builders and deserialized data. Refactoring this script is risky without type-checking safety.
- Proposed action: Import Discord.js command builder types or define a local CommandPayload interface. Replace all : any.

## Finding 16: Lazy any types in src/features/opsHealth.ts
- Severity: Medium
- Type: refactor
- File(s): src/features/opsHealth.ts (12 instances)
- Evidence: Health-check payloads from external services typed as : any. Cannot safely refactor or extend health logic.
- Proposed action: Define strict types for health payloads. Replace all : any with proper interfaces.

## Finding 17: Format drift in web/ (925 prettier warnings)
- Severity: Medium
- Type: chore
- File(s): web/ (925 files)
- Evidence: npm run format:check reports 925 web/ warnings vs 237 src/ and 106 tests/. Code review diffs noisy.
- Proposed action: Run npm run format on web/ in one commit. Add pre-commit hook to prevent drift. Verify .prettierignore excludes .svelte-kit/ artifacts.

## Finding 18: Unused export clearMetricsEpoch
- Severity: Low
- Type: chore
- File(s): src/features/metricsEpoch.ts
- Evidence: Listed in audit/02_DEAD_CODE_REPORT.md. No imports confirmed by grep.
- Proposed action: Remove the export.

## Finding 19: Unused export getConfiguredGuilds
- Severity: Low
- Type: chore
- File(s): src/features/notifyConfig.ts
- Evidence: Listed dead. No imports.
- Proposed action: Remove the export.

## Finding 20: Unused export getRecentAssignments
- Severity: Low
- Type: chore
- File(s): src/features/roleAutomation.ts
- Evidence: Listed dead. No imports.
- Proposed action: Remove the export.

## Finding 21: Unused export APPLICANT_ACTIONS
- Severity: Low
- Type: chore
- File(s): src/features/modPerformance.ts:38
- Evidence: Constant exported but never referenced.
- Proposed action: Remove the export.

## Finding 22: Unused constant OAUTH_RATE_LIMIT_MAX_REQUESTS
- Severity: Low
- Type: chore
- File(s): src/lib/constants.ts:61
- Evidence: Export defined but never used.
- Proposed action: Remove or document why it exists.

## Finding 23: TODO comment for art.ts circular dependency
- Severity: Low
- Type: chore
- File(s): src/commands/art.ts:869
- Evidence: Comment "TODO: Might be worth refactoring this out, but it works for now." Refers to dynamic import of artJobs/index.js. Adds noise.
- Proposed action: Either resolve the circular dependency and remove the TODO, or replace with a clear comment documenting the deliberate choice.

## Finding 24: TODO comment for activityTracker.ts JSON fallback
- Severity: Low
- Type: chore
- File(s): src/features/activityTracker.ts:288
- Evidence: "TODO: Implement JSON fallback logging (future enhancement)". No issue, no timeline.
- Proposed action: Create an issue for the JSON fallback or remove the feature idea. Reference issue in the comment if deferred.

## Finding 25: ESLint no-undef warnings in scripts (env config wrong)
- Severity: Low
- Type: chore
- File(s): scripts/ (multiple files including assign-leadership-tags.mjs, build-overlay-weekly.mjs, worker code)
- Evidence: ESLint reports no-undef for fetch, __dirname, console, process, Buffer, Response, Request. ~200 warnings from wrong env config.
- Proposed action: Update .eslintrc for scripts/ with env: node + es2020. Workers get worker env. Should suppress ~200 no-undef warnings.

## Finding 26: Empty block in build-overlay-weekly.mjs
- Severity: Low
- Type: chore
- File(s): scripts/build-overlay-weekly.mjs:100
- Evidence: ESLint reports empty block. Likely placeholder or incomplete error handling.
- Proposed action: Comment the block or remove it.

## Finding 27: Typecheck passes cleanly
- Severity: Nominal
- Type: chore
- File(s): src/, tests/ (entire project)
- Evidence: npm run typecheck completes with zero errors. tsconfig.json strict mode is sound.
- Proposed action: No action; document in team wiki.
