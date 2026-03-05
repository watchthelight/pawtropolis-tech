# Code Audit 2026

Started: 2026-03-05
Status: **Complete — Passes 1-8 applied** — 79 findings across 8 rounds, 26 resolved
Detailed reports: `docs/audits/code-audit-2026/round-*.md`

## Known Issues Pre-Check (from Jan 2026 audit)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| K1 | Dead code: 11 unused exports | OPEN | All 11 still present per dead code report |
| K2 | tsconfig: `noUnusedLocals`/`noUnusedParameters` commented out | OPEN | tsconfig.json:13-14 |
| K3 | Two logger files: `lib/logger.ts` vs `features/logger.ts` | FALSE ALARM | Different purposes: pino vs Discord channel logging |
| K4 | Doc refs to deleted `/utility` command | FIXED | Cleaned up in Jan audit (AUDIT-FINAL line 334) |
| K5 | `/search` permission discrepancy | OK | Uses `setDefaultMemberPermissions(null)` + runtime checks; PERMS-MATRIX docs correct |

---

## Era Summary

| Era | Count | Description |
|-----|-------|-------------|
| Migration Legacy | 18 | In initial commit, <=3 commits — highest risk |
| Migration Evolved | 48 | In initial commit, 4+ commits — iterated |
| Early Addition | 98 | Added Nov 26 - Dec 14, 2025 |
| Stable Mature | 4 | Last modified before Jan 20, 4+ commits |
| Dashboard Era | 87 | Added/modified after Mar 1, 2026 — newest |

---

## Round 1: Foundation (P0)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/index.ts` | 2172 | Migration Evolved | 42 | `---` | |
| `src/db/db.ts` | 386 | Migration Evolved | 11 | `---` | |
| `src/db/ensure.ts` | 917 | Migration Evolved | 8 | `---` | |
| `src/lib/config.ts` | 1258 | Migration Evolved | 16 | `---` | |
| `src/lib/env.ts` | 244 | Migration Evolved | 11 | `---` | |

## Round 2: Gate System (P0)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/features/gate.ts` | 1396 | Migration Evolved | 13 | `---` | |
| `src/commands/gate/gateMain.ts` | 771 | Early Addition | 4 | `---` | |
| `src/commands/gate/accept.ts` | 300 | Early Addition | 5 | `---` | |
| `src/commands/gate/reject.ts` | 268 | Early Addition | 6 | `---` | |
| `src/commands/gate/kick.ts` | 202 | Early Addition | 5 | `---` | |
| `src/commands/gate/unclaim.ts` | 192 | Early Addition | 6 | `---` | |
| `src/commands/gate/shared.ts` | 58 | Early Addition | 4 | `---` | |

## Round 3: Review System (P0)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/features/review/handlers/actionRunners.ts` | 657 | Early Addition | 4 | `---` | |
| `src/features/review/handlers/buttons.ts` | 548 | Early Addition | 6 | `---` | |
| `src/features/review/handlers/claimHandlers.ts` | 248 | Early Addition | 3 | `---` | |
| `src/features/review/handlers/helpers.ts` | 331 | Early Addition | 4 | `---` | |
| `src/features/review/handlers/modals.ts` | 242 | Early Addition | 4 | `---` | |
| `src/features/review/card.ts` | 969 | Early Addition | 6 | `---` | |
| `src/features/review/claims.ts` | 101 | Early Addition | 3 | `---` | |
| `src/features/review/flows/approve.ts` | 208 | Early Addition | 2 | `---` | |
| `src/features/review/flows/kick.ts` | 197 | Early Addition | 1 | `---` | |
| `src/features/review/flows/reject.ts` | 132 | Early Addition | 1 | `---` | |
| `src/features/review/queries.ts` | 127 | Migration Evolved | 4 | `---` | |
| `src/features/review/types.ts` | 178 | Early Addition | 2 | `---` | |
| `src/features/review/welcome.ts` | 435 | Early Addition | 2 | `---` | |
| `src/ui/reviewCard.ts` | 677 | Migration Evolved | 11 | `---` | |
| `src/features/reviewActions.ts` | 261 | Migration Evolved | 7 | `---` | |
| `src/commands/review/getNotifyConfig.ts` | 148 | Migration Evolved | 7 | `---` | |
| `src/commands/review/setNotifyConfig.ts` | 236 | Migration Evolved | 7 | `---` | |
| `src/commands/review-set-listopen-output.ts` | 134 | Migration Evolved | 5 | `---` | |

## Round 4: Large Commands (P1)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/commands/audit.ts` | 1684 | Early Addition | 20 | `---` | |
| `src/commands/art.ts` | 1283 | Early Addition | 9 | `---` | |
| `src/commands/movie.ts` | 811 | Early Addition | 11 | `---` | |
| `src/commands/listopen.ts` | 787 | Migration Evolved | 11 | `---` | |
| `src/commands/roles.ts` | 706 | Early Addition | 7 | `---` | |
| `src/commands/database.ts` | 662 | Migration Evolved | 9 | `---` | |
| `src/commands/artistqueue.ts` | 698 | Early Addition | 10 | `---` | |

## Round 5: Feature Modules (P1)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/features/modmail/routing.ts` | 527 | Early Addition | 6 | `---` | |
| `src/features/modmail/threadClose.ts` | 622 | Early Addition | 3 | `---` | |
| `src/features/modmail/threadOpen.ts` | 492 | Early Addition | 5 | `---` | |
| `src/features/modmail/threadPerms.ts` | 495 | Early Addition | 1 | `---` | |
| `src/features/modmail/handlers.ts` | 240 | Early Addition | 3 | `---` | |
| `src/features/modmail/tickets.ts` | 262 | Early Addition | 2 | `---` | |
| `src/features/modmail/transcript.ts` | 307 | Early Addition | 2 | `---` | |
| `src/features/modmail/dashboardBridge.ts` | 358 | Dashboard Era | 2 | `---` | |
| `src/features/events/gameNight.ts` | 972 | Early Addition | 2 | `---` | |
| `src/features/avatarNsfwMonitor.ts` | 349 | Early Addition | 9 | `---` | |
| `src/features/avatarScan.ts` | 307 | Migration Evolved | 7 | `---` | |
| `src/features/googleVision.ts` | 248 | Migration Evolved | 4 | `---` | |
| `src/features/serverAuditDocs.ts` | 1698 | Stable Mature | 9 | `---` | |
| `src/features/artistRotation/queue.ts` | 537 | Early Addition | 4 | `---` | |
| `src/features/artistRotation/handlers.ts` | 254 | Early Addition | 5 | `---` | |
| `src/features/artistRotation/roleSync.ts` | 172 | Early Addition | 5 | `---` | |
| `src/features/artistRotation/constants.ts` | 182 | Early Addition | 7 | `---` | |

## Round 6: Shared Utilities (P2)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/lib/cmdWrap.ts` | 538 | Migration Evolved | 10 | `---` | |
| `src/lib/eventWrap.ts` | 201 | Early Addition | 6 | `---` | |
| `src/lib/modalPatterns.ts` | 143 | Migration Evolved | 9 | `---` | |
| `src/lib/errorCard.ts` | 263 | Migration Evolved | 6 | `---` | |
| `src/lib/errorCardV2.ts` | 532 | Early Addition | 2 | `---` | |
| `src/lib/errors.ts` | 437 | Early Addition | 4 | `---` | |
| `src/lib/rateLimiter.ts` | 179 | Early Addition | 6 | `---` | |
| `src/lib/logger.ts` | 164 | Migration Evolved | 5 | `---` | |
| `src/lib/sentry.ts` | 300 | Migration Evolved | 5 | `---` | |
| `src/lib/wideEvent.ts` | 854 | Early Addition | 2 | `---` | |
| `src/lib/wideEventEmitter.ts` | 359 | Early Addition | 3 | `---` | |
| `src/lib/activityHeatmap.ts` | 652 | Migration Legacy | 2 | `---` | |
| `src/lib/buildInfo.ts` | 440 | Early Addition | 2 | `---` | |
| `src/lib/csv.ts` | 272 | Migration Legacy | 2 | `---` | |
| `src/lib/leaderboardImage.ts` | 450 | Migration Legacy | 3 | `---` | |
| `src/lib/reqctx.ts` | 130 | Migration Evolved | 4 | `---` | |
| `src/lib/retry.ts` | 154 | Early Addition | 5 | `---` | |
| `src/lib/roles.ts` | 230 | Early Addition | 2 | `---` | |
| `src/lib/notifyLimiter.ts` | 194 | Migration Evolved | 6 | `---` | |
| `src/lib/permissionCard.ts` | 250 | Early Addition | 4 | `---` | |
| `src/logging/pretty.ts` | 592 | Migration Evolved | 14 | `---` | |

## Round 7: Stores, Schedulers, Config (P2)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `src/store/flagsStore.ts` | 215 | Migration Evolved | 6 | `---` | |
| `src/store/auditSessionStore.ts` | 228 | Early Addition | 3 | `---` | |
| `src/store/auditFindingsStore.ts` | 449 | Early Addition | 1 | `---` | |
| `src/store/securitySnapshotStore.ts` | 455 | Early Addition | 1 | `---` | |
| `src/store/nsfwFlagsStore.ts` | 89 | Early Addition | 5 | `---` | |
| `src/store/byteMultiplierStore.ts` | 262 | Early Addition | 1 | `---` | |
| `src/store/gameConfigStore.ts` | 135 | Early Addition | 1 | `---` | |
| `src/store/acknowledgedSecurityStore.ts` | 237 | Early Addition | 1 | `---` | |
| `src/store/aiDetectionToggles.ts` | 93 | Early Addition | 1 | `---` | |
| `src/scheduler/staleApplicationCheck.ts` | 386 | Early Addition | 4 | `---` | |
| `src/scheduler/securityAuditScheduler.ts` | 380 | Early Addition | 2 | `---` | |
| `src/scheduler/diskSpaceScheduler.ts` | 273 | Early Addition | 1 | `---` | |
| `src/scheduler/byteMultiplierScheduler.ts` | 241 | Early Addition | 1 | `---` | |
| `src/scheduler/opsHealthScheduler.ts` | 165 | Migration Evolved | 4 | `---` | |
| `src/scheduler/modMetricsScheduler.ts` | 132 | Migration Evolved | 4 | `---` | |
| `src/scheduler/eventTimeoutScheduler.ts` | 106 | Dashboard Era | 1 | `---` | |
| `src/config/flaggerStore.ts` | 267 | Migration Evolved | 9 | `---` | |
| `src/config/loggingStore.ts` | 184 | Migration Evolved | 7 | `---` | |

## Round 8: Web Dashboard (P1)

| File | Lines | Era | Commits | Status | Findings |
|------|-------|-----|---------|--------|----------|
| `web/src/lib/server/queries/stats.ts` | 541 | Dashboard Era | 3 | `---` | |
| `web/src/lib/server/queries/reviews.ts` | 293 | Dashboard Era | 13 | `---` | |
| `web/src/lib/server/queries/flags.ts` | 152 | Dashboard Era | 1 | `---` | |
| `web/src/lib/server/queries/modmail.ts` | 94 | Dashboard Era | 1 | `---` | |
| `web/src/lib/server/queries/home.ts` | 61 | Dashboard Era | 4 | `---` | |
| `web/src/lib/server/db.ts` | 23 | Dashboard Era | 2 | `---` | |
| `web/src/lib/server/roles.ts` | 89 | Dashboard Era | 2 | `---` | |
| `web/src/lib/server/session.ts` | 51 | Dashboard Era | 1 | `---` | |
| `web/src/lib/server/discord.ts` | 87 | Dashboard Era | 1 | `---` | |
| `web/src/lib/server/botApi.ts` | 75 | Dashboard Era | 2 | `---` | |
| `web/src/lib/server/events/bus.ts` | 46 | Dashboard Era | 3 | `---` | |
| `web/src/lib/server/events/fan-out.ts` | 119 | Dashboard Era | 3 | `---` | |
| `web/src/lib/stores/theme.ts` | 228 | Dashboard Era | 11 | `---` | |
| `web/src/lib/stores/sse.svelte.ts` | 179 | Dashboard Era | 3 | `---` | |
| `web/src/lib/stores/bot-status.svelte.ts` | 61 | Dashboard Era | 3 | `---` | |
| `web/src/lib/types/events.ts` | 174 | Dashboard Era | 5 | `---` | |
| `web/src/routes/dashboard/flags/+page.svelte` | 923 | Dashboard Era | 7 | `---` | |
| `web/src/routes/dashboard/reviews/+layout.svelte` | 443 | Dashboard Era | 15 | `---` | |
| `web/src/routes/dashboard/stats/+page.svelte` | 604 | Dashboard Era | 7 | `---` | |
| `web/src/routes/dashboard/+layout.svelte` | 378 | Dashboard Era | 16 | `---` | |
| `web/src/routes/+page.svelte` | 445 | Dashboard Era | 13 | `---` | |
| `web/src/lib/components/review/AppDetail.svelte` | 680 | Dashboard Era | 25 | `---` | |
| `web/src/lib/components/review/ModmailViewer.svelte` | 484 | Dashboard Era | 7 | `---` | |
| `web/src/lib/components/review/DiscordProfileCard.svelte` | 417 | Dashboard Era | 5 | `---` | |
| `web/src/routes/api/review/[action]/+server.ts` | 68 | Dashboard Era | 4 | `---` | |
| `web/src/routes/api/review/profile/+server.ts` | 68 | Dashboard Era | 5 | `---` | |

### Deferred (P3) — not tracked

Minor commands (poke, skullmode, sample, test), simple listeners (dadMode, skullMode), formatting (logging/embeds), static data (constants/sampleData).

---

## Findings Summary (79 total)

### By Severity
| Severity | Count | Key Examples |
|----------|-------|-------------|
| HIGH | 3 | F032 action runner duplication, F036 review zero tests, F072 session tokens plaintext |
| MED | 10 | F001 hardcoded guild ID, F016 column allowlist, F045 `any` params, F052 fake interaction, F076 web zero tests |
| LOW | 63 | Type safety, duplication, dead code, docs, patterns |
| SKIP/RESOLVED | 3 | F021 console.error in env (intentional), F050 invalidateDraftsCache (already removed), F063 legacy files (tested) |

### By Category
| Category | Count |
|----------|-------|
| Type Safety | 15 |
| Duplication | 13 |
| Dead Code | 8 |
| Test Coverage | 11 |
| Pattern/Maintainability | 14 |
| Security | 4 |
| Performance | 5 |
| Documentation | 3 |
| Error Handling | 3 |
| Architecture | 3 |

### Top Priority Fixes (Improvement Pass Order)
1. **F072** — Encrypt session cookies (HIGH security)
2. **F032** — Refactor action runners to shared pipeline (HIGH duplication, ~650 lines)
3. **F016** — Audit ALLOWED_CONFIG_COLUMNS for missing entries (MED, silent data loss)
4. **F018** — Extract shared ensureGuildConfigColumns helper (MED, ~200 lines saved)
5. **F024** — Extract shared resolveApplication helper for gate commands (LOW, ~160 lines saved)

### Quick Wins (batch in one commit each)
- Dead code removal: F002, F029, F030, F033, F053, F062, F065
- Type safety fixes: F003, F007, F035, F042, F045, F054
- Shared utilities: F008 (SQL_IDENTIFIER_RE), F043 (sleep)
- Logging: F010 (bare catch), F034 (info->debug)
- Minor: F047 (memberCount), F051 (SSH StrictHostChecking), F067 (SELECT 1)

Full findings details in per-round reports: `docs/audits/code-audit-2026/round-{1..8}-*.md`
