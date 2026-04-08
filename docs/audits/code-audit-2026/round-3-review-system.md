# Round 3: Review System (P0) — Audit Report

Audited: 2026-03-05
Files: 18 | Total Lines: ~5,800

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/features/review.ts` | 123 | Migration Evolved | 8 | None (barrel) |
| `src/features/review/types.ts` | 178 | Early Addition | 2 | None |
| `src/features/review/claims.ts` | 101 | Early Addition | 3 | None |
| `src/features/review/queries.ts` | 127 | Migration Evolved | 4 | None |
| `src/features/review/flows/approve.ts` | 208 | Early Addition | 2 | None |
| `src/features/review/flows/kick.ts` | 197 | Early Addition | 1 | None |
| `src/features/review/flows/reject.ts` | 132 | Early Addition | 1 | None |
| `src/features/review/flows/index.ts` | 15 | Early Addition | 1 | None |
| `src/features/review/handlers/actionRunners.ts` | 657 | Early Addition | 4 | None |
| `src/features/review/handlers/buttons.ts` | 548 | Early Addition | 6 | None |
| `src/features/review/handlers/claimHandlers.ts` | 248 | Early Addition | 3 | None |
| `src/features/review/handlers/helpers.ts` | 331 | Early Addition | 4 | None |
| `src/features/review/handlers/modals.ts` | 242 | Early Addition | 4 | None |
| `src/features/review/handlers/index.ts` | 54 | Early Addition | 3 | None |
| `src/features/review/index.ts` | 114 | Early Addition | 3 | None |
| `src/features/review/card.ts` | 969 | Early Addition | 6 | None |
| `src/features/review/welcome.ts` | 435 | Early Addition | 2 | None |
| `src/features/reviewActions.ts` | 261 | Migration Evolved | 7 | None |
| `src/ui/reviewCard.ts` | 677 | Migration Evolved | 11 | None |
| `src/commands/review/getNotifyConfig.ts` | 148 | Migration Evolved | 7 | None |
| `src/commands/review/setNotifyConfig.ts` | 236 | Migration Evolved | 7 | None |
| `src/commands/review-set-listopen-output.ts` | 134 | Migration Evolved | 5 | None |

---

## Overall Assessment

The review system is well-architected with clean separation into types, claims, queries, flows, handlers, and card rendering. The refactor from a monolith review.ts into submodules was done carefully. However, the module suffers from:
1. **Massive duplication** in action runners (approve/reject/permReject/kick share ~80% of their code)
2. **Dead exported functions** (getReviewClaim is never imported)
3. **Zero test coverage** — the entire review system has no test files
4. **Noisy logging** at info level for routine queries

---

## Findings

### F032 — Action runners are 80% duplicated
- **File**: `src/features/review/handlers/actionRunners.ts` (657 lines)
- **Severity**: HIGH
- **Category**: Duplication
- **Description**: `runApproveAction`, `runRejectAction`, `runPermRejectAction`, and `runKickAction` follow the same pattern:
  1. Claim guard check
  2. Transaction (approveTx/rejectTx/kickTx)
  3. Handle "already"/"terminal"/"invalid" results
  4. Wide event tracking
  5. Cache user identity
  6. Action log
  7. Close modmail
  8. Refresh review card
  9. Post public message
  10. Notify dashboard

  Steps 1, 3, 5-10 are nearly identical across all 4 runners. `runRejectAction` and `runPermRejectAction` share ~95% of their code (only the `permanent: true` flag differs).
- **Risk**: Bug fix in one runner may not be applied to others. Each new post-action step must be added 4 times.
- **Fix**: Extract a shared `executeReviewAction(interaction, app, config)` pipeline that takes an action-specific handler for step 2. Each runner becomes ~20 lines calling the pipeline with their specific TX function.

### F033 — getReviewClaim is dead code (never imported)
- **File**: `src/features/review/claims.ts:61`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: `getReviewClaim(appId)` returns `ReviewClaimRow | undefined`. It's defined, exported from claims.ts, and re-exported through 2 barrel files (review/index.ts and review.ts). But no consumer file ever imports it — everyone uses `getClaim()` which returns `ReviewClaimRow | null` instead. The comment at line 78-82 acknowledges this exact duplication.
- **Fix**: Remove `getReviewClaim` and its re-exports. Update barrels.

### F034 — logger.info on every getRecentActionsForApp call
- **File**: `src/features/review/queries.ts:121`
- **Severity**: LOW
- **Category**: Performance / Logging
- **Description**: `logger.info(...)` fires on every review card render to log query timing. This indexed query runs in <1ms typically. Info-level logging is too noisy for a hot-path read.
- **Fix**: Change to `logger.debug`.

### F035 — `(err as any)?.code` in kick flow
- **File**: `src/features/review/flows/kick.ts:174`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: Single `as any` cast to check Discord error code. Standard pattern would be a typed error check.
- **Fix**: Use a type guard or `(err as { code?: number })?.code`.

### F036 — Zero test coverage for entire review system
- **File**: All review/* files
- **Severity**: HIGH
- **Category**: Test Coverage
- **Description**: 18+ files with ~5,800 lines of business-critical code have zero dedicated tests. The review system handles the core moderation workflow — claim/approve/reject/kick with transaction safety, DM delivery, role assignment, modmail integration, and card rendering. Any regression here directly impacts staff operations.
- **Risk**: Very high — this is the core business logic with the most code paths.
- **Fix**: Defer — requires significant mocking infrastructure for Discord.js interactions, guild members, channels, and database state. Would be the highest-impact test investment.

### F037 — review.ts and review/index.ts are near-duplicate barrels
- **File**: `src/features/review.ts` and `src/features/review/index.ts`
- **Severity**: LOW
- **Category**: Duplication
- **Description**: Both files exist as barrel re-exports. `review.ts` re-exports from `review/*.js` submodules and also defines `ALLOWED_ACTIONS`. `review/index.ts` re-exports slightly different subsets. Consumers import from either path. This creates ambiguity about which barrel to use.
- **Fix**: Consolidate into one barrel. Most consumers use `../features/review.js` so that should be the canonical path.

### F038 — ensureReviewMessage called twice in approve action
- **File**: `src/features/review/handlers/actionRunners.ts:136-141` and `207-212`
- **Severity**: LOW
- **Category**: Performance
- **Description**: In `runApproveAction`, `ensureReviewMessage` is called at line 137 (after DB approve) and again at line 207 (after modmail close). The second call is to update the card with modmail close status. Both calls edit the same Discord message.
- **Risk**: Extra API call on every approval. Not harmful but wasteful.
- **Fix**: Remove the first call (line 137) since the second call (line 207) supersedes it anyway.

### F039 — reviewActions.ts exists alongside review/flows
- **File**: `src/features/reviewActions.ts` (261 lines)
- **Severity**: LOW
- **Category**: Pattern Consistency
- **Description**: `reviewActions.ts` contains `claimTx()`, `unclaimTx()`, and `ClaimError`. These are claim-specific transaction functions that sit at the `features/` level rather than inside `review/`. Meanwhile, `review/flows/` contains `approveTx`, `rejectTx`, `kickTx`. The split is historical — `reviewActions.ts` is Migration Evolved (from the monolith), while `review/flows/` was added during the refactor.
- **Fix**: Move `claimTx`/`unclaimTx`/`ClaimError` into `review/flows/claim.ts` or `review/claims.ts` for consistency.

### F040 — `isMissingPermissionError` uses `as` cast
- **File**: `src/features/review/flows/approve.ts:40`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `(err as { code?: unknown })?.code === 50013` — lightweight cast but could use a proper type guard.
- **Fix**: Minor — extract a shared `isDiscordError(err, code)` utility.

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [x] F033: Remove dead `getReviewClaim` function and barrel re-exports
- [x] F034: Change getRecentActionsForApp logging from info to debug
- [x] F035: Fix `(err as any)?.code` in kick flow
- [ ] F038: Remove duplicate `ensureReviewMessage` call in runApproveAction

### Medium Fixes (15-30 min each)
- [ ] F037: Consolidate review.ts and review/index.ts barrels
- [ ] F039: Move reviewActions.ts contents into review/ directory
- [ ] F040: Extract shared `isDiscordError()` utility

### Large Fixes (1+ hour)
- [ ] F032: Refactor action runners into a shared pipeline (~650 lines → ~200 lines)

### Deferred
- [ ] F036: Test coverage for review system (very large scope, highest impact)

### Cross-Reference Warnings
- F032 refactor touches actionRunners.ts heavily — all 4 runners must be verified to produce identical behavior after consolidation
- F033 removal touches claims.ts, review/index.ts, and review.ts — grep all consumers before removing
- F037 barrel consolidation may break import paths — grep for `from ".*review/index.js"` vs `from ".*review.js"`
- F039 move requires updating all imports of `claimTx`/`unclaimTx` from `reviewActions.js` (used in handlers/claimHandlers.ts and index.ts)

---

## See Also

- [Code Audit 2026 (parent)](../CODE-AUDIT-2026.md) — full audit summary and findings rollup
- [Round 2: Gate System](round-2-gate-system.md) — previous round
- [Round 4: Large Commands](round-4-large-commands.md) — next round
- [Improvement Plan](IMPROVEMENT-PLAN.md) — pass-by-pass execution plan for these findings
