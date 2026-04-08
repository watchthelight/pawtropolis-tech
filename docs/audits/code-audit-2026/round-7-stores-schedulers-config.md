# Round 7: Stores, Schedulers, Config (P2) — Audit Report

Audited: 2026-03-05
Files: 18 | Total Lines: ~4,400

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/store/flagsStore.ts` | 215 | Migration Evolved | 6 | `tests/store/flagsStore.test.ts` |
| `src/store/auditSessionStore.ts` | 228 | Early Addition | 3 | `tests/store/auditSessionStore.test.ts` |
| `src/store/auditFindingsStore.ts` | 449 | Early Addition | 1 | None |
| `src/store/securitySnapshotStore.ts` | 455 | Early Addition | 1 | None |
| `src/store/nsfwFlagsStore.ts` | 89 | Early Addition | 5 | `tests/store/nsfwFlagsStore.test.ts` |
| `src/store/byteMultiplierStore.ts` | 262 | Early Addition | 1 | None |
| `src/store/gameConfigStore.ts` | 135 | Early Addition | 1 | `tests/store/gameConfigStore.test.ts` |
| `src/store/acknowledgedSecurityStore.ts` | 237 | Early Addition | 1 | `tests/store/acknowledgedSecurityStore.test.ts` |
| `src/store/aiDetectionToggles.ts` | 93 | Early Addition | 1 | `tests/store/aiDetectionToggles.test.ts` |
| `src/scheduler/staleApplicationCheck.ts` | 386 | Early Addition | 4 | `tests/scheduler/staleApplicationCheck.test.ts` |
| `src/scheduler/securityAuditScheduler.ts` | 380 | Early Addition | 2 | None |
| `src/scheduler/diskSpaceScheduler.ts` | 273 | Early Addition | 1 | None |
| `src/scheduler/byteMultiplierScheduler.ts` | 241 | Early Addition | 1 | None |
| `src/scheduler/opsHealthScheduler.ts` | 165 | Migration Evolved | 4 | `tests/scheduler/opsHealthScheduler.test.ts` |
| `src/scheduler/modMetricsScheduler.ts` | 132 | Migration Evolved | 4 | `tests/scheduler/modMetricsScheduler.test.ts` |
| `src/scheduler/eventTimeoutScheduler.ts` | 106 | Dashboard Era | 1 | None |
| `src/config/flaggerStore.ts` | 267 | Migration Evolved | 9 | `tests/config/flaggerStore.test.ts` |
| `src/config/loggingStore.ts` | 184 | Migration Evolved | 7 | `tests/config/loggingStore.test.ts` |

---

## Overall Assessment

This is the **cleanest** batch of code in the codebase. Zero `as any` casts across all 18 files. Consistent patterns throughout. Good test coverage (10 of 18 files tested). The stores use prepared statements at module load for performance. The schedulers follow a uniform start/stop/unref pattern.

The only notable findings are:
1. Scheduler pattern repetition (each scheduler reimplements the same start/stop/interval boilerplate)
2. A few stores without test coverage
3. `SELECT *` usage in existence checks

---

## Findings

### F066 — All 7 schedulers repeat identical start/stop boilerplate
- **File**: All scheduler files
- **Severity**: LOW
- **Category**: Duplication / Pattern
- **Description**: Every scheduler has the same ~15-line pattern: `let _activeInterval`, `interval.unref()`, `start*Scheduler(client)`, and `stop*Scheduler()` with identical clearInterval logic. This pattern is duplicated 7 times across 7 files.
- **Risk**: Low — the pattern is simple and unlikely to have bugs. But if the cleanup logic needs changing (e.g., adding graceful drain), it must be updated in 7 places.
- **Fix**: Could extract a `createScheduler(name, intervalMs, callback)` utility that returns `{ start, stop }`. Would reduce each scheduler by ~10 lines. However, this is over-engineering for a stable pattern.

### F067 — `SELECT *` in flagsStore existence check
- **File**: `src/store/flagsStore.ts:46-48`
- **Severity**: LOW
- **Category**: Performance
- **Description**: `checkExistingRowStmt` uses `SELECT * FROM user_activity WHERE guild_id = ? AND user_id = ?` for an existence check. Comment acknowledges "Could be SELECT 1 for a tiny performance gain."
- **Fix**: Change to `SELECT 1` — trivial and good practice. Performance difference is negligible but it's cleaner intent.

### F068 — 3 stores without test coverage
- **File**: `auditFindingsStore.ts`, `securitySnapshotStore.ts`, `byteMultiplierStore.ts`
- **Severity**: LOW
- **Category**: Test Coverage
- **Description**: These stores handle audit findings persistence, security snapshot storage, and byte multiplier tracking. All are lower-risk since they're consumed by well-tested scheduler/command paths, but direct store tests would catch edge cases (e.g., expiration logic in byteMultiplierStore).
- **Fix**: Defer — low priority, indirect coverage through command tests.

### F069 — 4 schedulers without test coverage
- **File**: `securityAuditScheduler.ts`, `diskSpaceScheduler.ts`, `byteMultiplierScheduler.ts`, `eventTimeoutScheduler.ts`
- **Severity**: LOW
- **Category**: Test Coverage
- **Description**: These schedulers handle security audits, disk monitoring, multiplier expiration, and event timeout. The core logic (find expired items, process them, log results) follows the tested scheduler patterns.
- **Fix**: Defer — the scheduler pattern is uniform and proven.

### F070 — getFlaggedUserIds returns empty array on error
- **File**: `src/store/flagsStore.ts:133-139`
- **Severity**: LOW
- **Category**: Error Handling
- **Description**: On database error, `getFlaggedUserIds` returns `[]` instead of throwing. Comment says this is deliberate: "audit continues with all users rather than crashing." This means a database corruption could silently cause NSFW audits to scan ALL members instead of just flagged ones.
- **Risk**: Very low — database errors at this level usually crash the whole process.
- **Fix**: Skip — the deliberate degradation is reasonable.

### F071 — flaggerStore and loggingStore use separate upserts for different fields
- **File**: `src/config/flaggerStore.ts:29-43` and `src/config/loggingStore.ts`
- **Severity**: LOW
- **Category**: Pattern
- **Description**: Both config stores have separate prepared statements for each field update (`upsertFlagsChannelStmt`, `upsertSilentDaysStmt`). This means each field update is an independent SQL statement rather than a single update-multiple-fields call. Fine for 2 fields, could scale poorly.
- **Fix**: Skip — only 2 fields each, not worth generalizing.

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [x] F067: Change `SELECT *` to `SELECT 1` in flagsStore existence check

### Deferred
- [ ] F066: Extract shared scheduler utility (low priority, over-engineering risk)
- [ ] F068: Test coverage for 3 untested stores
- [ ] F069: Test coverage for 4 untested schedulers

### Cross-Reference Warnings
- F066 scheduler refactor would touch all 7 scheduler files + index.ts startup/shutdown — high risk for a low-reward change
- F067 is safe — SELECT 1 vs SELECT * has identical behavior for .get() existence checks

---

## See Also

- [Code Audit 2026 (parent)](../CODE-AUDIT-2026.md) — full audit summary and findings rollup
- [Round 6: Shared Utilities](round-6-shared-utilities.md) — previous round
- [Round 8: Web Dashboard](round-8-web-dashboard.md) — next round
- [Improvement Plan](IMPROVEMENT-PLAN.md) — pass-by-pass execution plan for these findings
