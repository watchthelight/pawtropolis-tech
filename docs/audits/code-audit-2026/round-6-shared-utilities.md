# Round 6: Shared Utilities (P2) — Audit Report

Audited: 2026-03-05
Files: 21 | Total Lines: ~7,600

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/lib/cmdWrap.ts` | 538 | Migration Evolved | 10 | `tests/lib/cmdWrap.test.ts` |
| `src/lib/eventWrap.ts` | 201 | Early Addition | 6 | `tests/lib/eventWrap.test.ts` |
| `src/lib/modalPatterns.ts` | 143 | Migration Evolved | 9 | `tests/lib/modalPatterns.test.ts` |
| `src/lib/errorCard.ts` | 263 | Migration Evolved | 6 | `tests/lib/errorCard.test.ts` |
| `src/lib/errorCardV2.ts` | 532 | Early Addition | 2 | None (tested via cmdWrap) |
| `src/lib/errors.ts` | 437 | Early Addition | 4 | `tests/lib/errors.test.ts` |
| `src/lib/rateLimiter.ts` | 179 | Early Addition | 6 | `tests/lib/rateLimiter.test.ts` |
| `src/lib/logger.ts` | 164 | Migration Evolved | 5 | None |
| `src/lib/sentry.ts` | 300 | Migration Evolved | 5 | None |
| `src/lib/wideEvent.ts` | 854 | Early Addition | 2 | `tests/lib/wideEvent.test.ts` |
| `src/lib/wideEventEmitter.ts` | 359 | Early Addition | 3 | `tests/lib/wideEventEmitter.test.ts` |
| `src/lib/activityHeatmap.ts` | 652 | Migration Legacy | 2 | `tests/lib/activityHeatmap.test.ts` |
| `src/lib/buildInfo.ts` | 440 | Early Addition | 2 | None |
| `src/lib/csv.ts` | 272 | Migration Legacy | 2 | `tests/lib/csv.test.ts` |
| `src/lib/leaderboardImage.ts` | 450 | Migration Legacy | 3 | `tests/lib/leaderboardImage.test.ts` |
| `src/lib/reqctx.ts` | 130 | Migration Evolved | 4 | `tests/lib/reqctx.test.ts` |
| `src/lib/retry.ts` | 154 | Early Addition | 5 | `tests/lib/retry.test.ts` |
| `src/lib/roles.ts` | 230 | Early Addition | 2 | `tests/lib/roles.test.ts` |
| `src/lib/notifyLimiter.ts` | 194 | Migration Evolved | 6 | `tests/lib/notifyLimiter.test.ts` |
| `src/lib/permissionCard.ts` | 250 | Early Addition | 4 | `tests/lib/permissionCard.test.ts` |
| `src/logging/pretty.ts` | 592 | Migration Evolved | 14 | None |

---

## Overall Assessment

The shared utilities are the **best-tested** part of the codebase with 35 test files in tests/lib/. Code quality is high. The main concerns are minor:
1. Dead exports from the January report (3 still exist elsewhere)
2. Two error card versions co-existing (v1 + v2)
3. `(db as any).name` undocumented property access in dbHealthCheck
4. No tests for logger.ts, sentry.ts, logging/pretty.ts, buildInfo.ts

---

## Findings

### F060 — Two error card implementations (v1 and v2)
- **File**: `src/lib/errorCard.ts` (263 lines) and `src/lib/errorCardV2.ts` (532 lines)
- **Severity**: LOW
- **Category**: Duplication
- **Description**: errorCard (v1) is used in index.ts's router catch-all. errorCardV2 is used in cmdWrap.ts's command wrapper. V2 is significantly more detailed (severity colors, execution paths, build identity, response state). Both are actively used in different code paths.
- **Risk**: Bug fixes or styling changes need applying to both.
- **Fix**: Defer — v1 handles the router fallback path, v2 handles wrapped commands. Could consolidate by having v1 delegate to v2, but the router catch-all has different context available.

### F061 — `(db as any).name` in dbHealthCheck
- **File**: `src/lib/dbHealthCheck.ts:142`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: Accesses better-sqlite3's undocumented `.name` property to get the database file path. Comment says "undocumented but stable."
- **Fix**: better-sqlite3's TypeScript types do include `name` as a property. Could type properly: `(db as { name: string }).name` or add to local type augmentation.

### F062 — Dead exports still exist: getModeratorMetrics, getTopModerators, getAssignmentHistory
- **File**: `src/features/modPerformance.ts:436,453` and `src/features/artistRotation/queue.ts:464`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: From the January dead code report: `getModeratorMetrics`, `getTopModerators`, and `getAssignmentHistory` are still exported but never imported. Other flagged exports (`clearMetricsEpoch`, `APPLICANT_ACTIONS`, `getConfiguredGuilds`, `getRecentAssignments`, `OAUTH_RATE_LIMIT_MAX_REQUESTS`) appear to have been cleaned up already.
- **Fix**: Remove the 3 remaining dead exports. Also remove `getShortBuildId` and `getBuildAge` from buildInfo.ts (also flagged, still present).

### F063 — activityHeatmap.ts, csv.ts, leaderboardImage.ts are Migration Legacy
- **File**: All three files
- **Severity**: LOW
- **Category**: Pattern
- **Description**: These are Migration Legacy files (<=3 commits, from initial migration). They work fine and have tests, but they may contain patterns from the old codebase (pawtech) that differ from current conventions.
- **Fix**: Skip — they have tests and work. Not worth the churn to modernize.

### F064 — No tests for logger.ts, sentry.ts, pretty.ts
- **File**: `src/lib/logger.ts`, `src/lib/sentry.ts`, `src/logging/pretty.ts`
- **Severity**: LOW
- **Category**: Test Coverage
- **Description**: The logging infrastructure (pino logger, Sentry integration, pretty action embeds) has no tests. These are difficult to test (external service dependencies, Discord embed rendering) but the pretty.ts file at 592 lines handles 15+ action types.
- **Fix**: Defer — low priority since logging failures are non-fatal.

### F065 — buildInfo.ts dead exports (getShortBuildId, getBuildAge)
- **File**: `src/lib/buildInfo.ts:395,409`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: Both functions are exported but never imported. Flagged in January dead code report, still present.
- **Fix**: Remove both functions.

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [x] F062: Remove dead exports getModeratorMetrics, getTopModerators (getAssignmentHistory is actively used — skipped)
- [x] F065: SKIPPED — getShortBuildId and getBuildAge are actively imported by errorCardV2.ts and health.ts
- [ ] F061: Type `db.name` properly in dbHealthCheck.ts

### Deferred
- [ ] F060: Consolidate error card v1/v2 (low priority, both work)
- [ ] F063: Modernize legacy utility files (no action needed)
- [ ] F064: Test coverage for logging infrastructure

### Cross-Reference Warnings
- F062 dead export removal: verify with `grep -r` that no dynamic imports or string references exist
- F065 removal is safe — functions were always utility helpers, no external consumers
