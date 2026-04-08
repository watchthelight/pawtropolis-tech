# Round 2: Gate System (P0) — Audit Report

Audited: 2026-03-05
Files: 8 | Total Lines: ~4,100

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/features/gate.ts` | 1396 | Migration Evolved | 13 | `tests/features/gate/gate.test.ts` |
| `src/features/gate/questions.ts` | 168 | Migration Evolved | 4 | None (covered by gate.test.ts) |
| `src/commands/gate/gateMain.ts` | 771 | Early Addition | 4 | `tests/commands/gate/gateMain.test.ts` |
| `src/commands/gate/accept.ts` | 300 | Early Addition | 5 | None |
| `src/commands/gate/reject.ts` | 268 | Early Addition | 6 | None |
| `src/commands/gate/kick.ts` | 202 | Early Addition | 5 | None |
| `src/commands/gate/unclaim.ts` | 192 | Early Addition | 6 | None |
| `src/commands/gate/shared.ts` | 58 | Early Addition | 4 | N/A (re-exports only) |

---

## Overall Assessment

The gate system is one of the most polished parts of the codebase. Code quality is high, error handling is thorough, and the flow logic is well-documented with inline comments. The main issues are:
- One `any` type annotation
- A misleading comment
- Minor duplication across the 4 action commands (accept/reject/kick/unclaim)
- Missing test coverage for the individual action commands

---

## Findings

### F022 — `component: any` in messageHasStartButton
- **File**: `src/features/gate.ts:736`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `(component: any) => component.type === ComponentType.Button && component.customId === "v1:start"` — the lambda parameter is typed `any`. The `row.components` array should be typed via Discord.js types (`APIMessageActionRowComponent`).
- **Fix**: Type as `APIMessageActionRowComponent` or use `component.type === ComponentType.Button` type narrowing.

### F023 — Misleading "fire-and-forget" comment
- **File**: `src/features/gate.ts:1355-1356`
- **Severity**: LOW
- **Category**: Documentation
- **Description**: Comment says "Ensure review card is created (fire-and-forget)" but the next line says "GOTCHA: This is NOT fire-and-forget - we await it." The first comment is wrong and should be removed. The correcting comment at 1356 acknowledges this already.
- **Fix**: Remove the misleading line 1355 comment, keep the GOTCHA.

### F024 — Duplicate "exactly one identifier" validation across 4 commands
- **File**: `src/commands/gate/accept.ts:85-97`, `reject.ts:93-101`, `kick.ts` (same), `unclaim.ts` (same)
- **Severity**: LOW
- **Category**: Duplication
- **Description**: All 4 gate action commands (accept, reject, kick, unclaim) copy-paste the same "exactly one of app/user/uid" validation logic and the same lookup logic (short code, user mention, raw UID). This is ~40 lines duplicated 4 times.
- **Risk**: If a new lookup method is added (e.g., by thread ID), it needs updating in 4 places.
- **Fix**: Extract a shared `resolveApplication(interaction, ctx)` helper in `shared.ts` that returns the resolved application or an error message. Would reduce each command by ~40 lines.

### F025 — No test files for accept/reject/kick/unclaim commands
- **File**: `src/commands/gate/accept.ts`, `reject.ts`, `kick.ts`, `unclaim.ts`
- **Severity**: MED
- **Category**: Test Coverage
- **Description**: None of the 4 action commands have dedicated test files. They contain permission checks, claim validation, transaction logic, modmail close, and multi-step flows. The review card refresh and DM delivery paths are untested.
- **Fix**: Defer — requires mocking Discord.js interactions and database state.

### F026 — `guildId!` non-null assertion used frequently
- **File**: `src/commands/gate/gateMain.ts` (lines 172, 184, 193, etc.)
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `interaction.guildId!` used many times after an early guild check. The check at the top validates `guildId` exists, but TypeScript doesn't narrow it for the rest of the function. Using `!` is safe here because of the early return, but it's a pattern that could mask bugs if the early check is removed.
- **Fix**: Assign to a local `const guildId = interaction.guildId!` once after the check (already done in some places but not all).

### F027 — shared.ts is a barrel re-export with 30+ symbols
- **File**: `src/commands/gate/shared.ts`
- **Severity**: LOW
- **Category**: Pattern
- **Description**: shared.ts re-exports from 6 different modules (config, appLookup, review, welcome, modmail, cmdWrap, ids, logger). It exists to reduce import boilerplate in the 4 action commands. This is a convenience barrel — not harmful, but makes dependency tracking harder. The alternative (each file imports directly) is more explicit.
- **Risk**: If `review.js` adds a breaking export name, all 4 commands break simultaneously (which could be a feature, not a bug).
- **Fix**: Skip — the barrel pattern is a deliberate trade-off.

### F028 — handleResetModal double-checks permissions
- **File**: `src/commands/gate/gateMain.ts:263-270` and `329-345`
- **Severity**: LOW
- **Category**: Pattern
- **Description**: Permission is checked twice: once before showing the modal (line 263) and again after the modal is submitted (line 329). The second check has a comment: "Permission revoked between modal open and submit." This is actually good defensive programming for TOCTOU scenarios, but the double-check could be simplified into a shared helper.
- **Fix**: Skip — intentional TOCTOU protection.

### F029 — `1;` prefix on gate.ts line 1
- **File**: `src/features/gate.ts:1`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: The file starts with `1; /**` — a `1;` expression statement before the JSDoc comment. This is a no-op and appears to be an accidental edit artifact.
- **Fix**: Remove the `1;` prefix.

### F030 — Stale gatekeeper ping step in handleGateModalSubmit
- **File**: `src/features/gate.ts:1367-1372`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: After submission, there's a step `ctx.step("gatekeeper_ping")` that immediately logs "skipping separate ping; review card handles one-time ping on create." This is a vestigial step from before the ping was moved to review card creation. The step adds noise to traces without doing anything.
- **Fix**: Remove the dead step and its log message.

### F031 — resolvedApps scan for short code collisions is O(n)
- **File**: `src/features/gate.ts:247-260`
- **Severity**: LOW
- **Category**: Performance
- **Description**: `getOrCreateDraft` fetches ALL resolved applications for the guild to check for short code collisions, then iterates through them. For a guild with thousands of historical applications, this could be slow. The `shortCode()` function derives from UUID, so collisions should be extremely rare.
- **Risk**: Low — this runs once per application start, not on a hot path. But the full table scan is unnecessary.
- **Fix**: Could use SQL: `WHERE guild_id = ? AND status IN (...) AND substr(id, 1, 8) = ?` or compute the short code in SQL. However, `shortCode()` truncates a UUID to 8 hex chars which may not match a simple substr — needs investigation.

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [ ] F022: Type the `component: any` parameter in messageHasStartButton
- [x] F023: Remove misleading "fire-and-forget" comment at line 1355
- [x] F029: Remove `1;` prefix on gate.ts line 1
- [x] F030: Remove dead gatekeeper_ping step

### Medium Fixes (15-30 min each)
- [ ] F024: Extract shared `resolveApplication()` helper for accept/reject/kick/unclaim
- [ ] F026: Normalize guildId! patterns to use early-assigned locals consistently

### Deferred
- [ ] F025: Test coverage for accept/reject/kick/unclaim (large scope)
- [ ] F031: Optimize short code collision check (low priority, rare path)

### Cross-Reference Warnings
- F024 refactor touches accept.ts, reject.ts, kick.ts, unclaim.ts, and shared.ts — all must be updated atomically
- F029 is a one-character fix but verify no tooling depends on the `1;` prefix (unlikely)
- F022 fix requires checking Discord.js APIMessageActionRowComponent type availability

---

## See Also

- [Code Audit 2026 (parent)](../CODE-AUDIT-2026.md) — full audit summary and findings rollup
- [Round 1: Foundation](round-1-foundation.md) — previous round
- [Round 3: Review System](round-3-review-system.md) — next round
- [Improvement Plan](IMPROVEMENT-PLAN.md) — pass-by-pass execution plan for these findings
