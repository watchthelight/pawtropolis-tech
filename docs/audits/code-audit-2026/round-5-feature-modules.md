# Round 5: Feature Modules (P1) — Audit Report

Audited: 2026-03-05
Files: 17 | Total Lines: ~6,700

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/features/modmail/routing.ts` | 527 | Early Addition | 6 | `tests/features/modmail/routing.test.ts` |
| `src/features/modmail/threadClose.ts` | 622 | Early Addition | 3 | `tests/features/modmail/threadClose.test.ts` |
| `src/features/modmail/threadOpen.ts` | 492 | Early Addition | 5 | `tests/features/modmail/threadOpen.test.ts` |
| `src/features/modmail/threadPerms.ts` | 495 | Early Addition | 1 | `tests/features/modmail/threadPerms.test.ts` |
| `src/features/modmail/handlers.ts` | 240 | Early Addition | 3 | `tests/features/modmail/handlers.test.ts` |
| `src/features/modmail/tickets.ts` | 262 | Early Addition | 2 | `tests/features/modmail/tickets.test.ts` |
| `src/features/modmail/transcript.ts` | 307 | Early Addition | 2 | `tests/features/modmail/transcript.test.ts` |
| `src/features/modmail/dashboardBridge.ts` | 358 | Dashboard Era | 2 | None |
| `src/features/events/gameNight.ts` | 972 | Early Addition | 2 | `tests/features/events/gameNight.test.ts` |
| `src/features/avatarNsfwMonitor.ts` | 349 | Early Addition | 9 | None |
| `src/features/avatarScan.ts` | 307 | Migration Evolved | 7 | None |
| `src/features/googleVision.ts` | 248 | Migration Evolved | 4 | `tests/features/googleVision.test.ts` |
| `src/features/serverAuditDocs.ts` | 1698 | Stable Mature | 9 | `tests/features/serverAuditDocs.test.ts` |
| `src/features/artistRotation/queue.ts` | 537 | Early Addition | 4 | `tests/features/artistRotation/queue.test.ts` |
| `src/features/artistRotation/handlers.ts` | 254 | Early Addition | 5 | `tests/features/artistRotation/handlers.test.ts` |
| `src/features/artistRotation/roleSync.ts` | 172 | Early Addition | 5 | `tests/features/artistRotation/roleSync.test.ts` |
| `src/features/artistRotation/constants.ts` | 182 | Early Addition | 7 | `tests/features/artistRotation/constants.test.ts` |

---

## Overall Assessment

Feature modules are the healthiest part of the codebase. Most have dedicated test files, clean architecture, and proper error handling. The standout issues are:
1. `dashboardBridge.ts` uses a fake interaction object (`as any`) to call modmail functions
2. `threadPerms.ts` accesses a non-existent config field via `as any`
3. `avatarScan.ts` and `avatarNsfwMonitor.ts` have no test coverage
4. `serverAuditDocs.ts` uses `as any` for Discord.js channel property access

---

## Findings

### F052 — dashboardBridge constructs fake interaction object
- **File**: `src/features/modmail/dashboardBridge.ts:153-161`
- **Severity**: MED
- **Category**: Architecture / Type Safety
- **Description**: The dashboard bridge creates a minimal object mimicking a ButtonInteraction and casts it `as any` to pass to `openPublicModmailThreadFor()`. This works but is fragile — if the function starts accessing additional interaction properties, the fake object silently returns undefined.
- **Risk**: Any change to openPublicModmailThreadFor's interaction usage could break dashboard modmail without type errors.
- **Fix**: Refactor `openPublicModmailThreadFor` to accept a parameter interface (guild, client, channel, userId, appCode) instead of requiring a full interaction object. The dashboard bridge passes these directly.

### F053 — threadPerms accesses non-existent `modmail_parent_channel_id` config field
- **File**: `src/features/modmail/threadPerms.ts:412`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: `(cfg as any)?.modmail_parent_channel_id` — this field does NOT exist in GuildConfig or the database schema. The `as any` cast hides this fact. The access always returns `undefined`, making the conditional on line 413 dead code.
- **Risk**: None functionally — the code works because the fallback path handles missing parent IDs.
- **Fix**: Remove lines 411-419 (the entire optional configured parent block).

### F054 — avatarScan.ts uses `as any` for displayAvatarURL options
- **File**: `src/features/avatarScan.ts:79`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `displayAvatarURL({ extension: "png", forceStatic: true, size: 1024 } as any)` — the ScanSubject type (which can be User or GuildMember) has slightly different signatures for displayAvatarURL options. The `as any` bypasses this.
- **Fix**: Use `ImageURLOptions` type from Discord.js, or narrow with a type guard for User vs GuildMember.

### F055 — serverAuditDocs.ts uses `as any` for channel properties
- **File**: `src/features/serverAuditDocs.ts:381-383`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: Accesses `topic`, `nsfw`, `rateLimitPerUser` via `(channel as any)` after checking `"topic" in channel`. The `in` operator narrows at runtime but TypeScript doesn't narrow the union type. This is a known pattern with Discord.js's channel type system.
- **Fix**: Use `isTextBased(channel)` type guard or type-assert to `TextChannel` after the `in` check. Alternatively, import `TextChannel` and use `instanceof`.

### F056 — avatarNsfwMonitor.ts and avatarScan.ts have no test coverage
- **File**: `src/features/avatarNsfwMonitor.ts`, `src/features/avatarScan.ts`
- **Severity**: MED
- **Category**: Test Coverage
- **Description**: The NSFW monitoring system (monitor + scanner) has no tests. This code handles sensitive content detection, Google Vision API integration, and alert routing. googleVision.ts itself has tests, but the orchestration layer doesn't.
- **Risk**: False positives/negatives in avatar scanning would affect real users without test safety net.
- **Fix**: Defer — requires mocking Google Vision API responses and Discord member objects.

### F057 — gameNight.ts is 972 lines in a single file
- **File**: `src/features/events/gameNight.ts`
- **Severity**: LOW
- **Category**: Pattern / Maintainability
- **Description**: Game night tracking, session management, voice state handling, role assignment, persistence, crash recovery, and multiple command handlers all in one file. This mirrors movieNight.ts (937 lines) and the two files share ~60% structural similarity.
- **Risk**: Changes to event tracking behavior need updating in both files.
- **Fix**: Defer — a shared event tracking framework could unify movieNight and gameNight, but this is a large refactor. The current duplicated-but-working approach is acceptable.

### F058 — dashboardBridge.ts has no test coverage
- **File**: `src/features/modmail/dashboardBridge.ts`
- **Severity**: LOW
- **Category**: Test Coverage
- **Description**: The dashboard bridge (open/close/reopen/send modmail from web dashboard) has no tests. Since it constructs fake interaction objects, integration testing is important to catch regressions.
- **Fix**: Defer — requires both Discord.js and database mocking.

### F059 — serverAuditDocs.ts is 1698 lines
- **File**: `src/features/serverAuditDocs.ts`
- **Severity**: LOW
- **Category**: Pattern
- **Description**: Server audit documentation generator is the second-largest file in the codebase. It handles role analysis, channel scanning, permission mapping, issue detection, markdown generation, git commit/push, and security diffing. Well-organized internally with clear sections, but could benefit from splitting into analyzer + generator + git modules.
- **Fix**: Defer — low priority since it's well-tested and rarely changes.

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [x] F053: Remove dead `modmail_parent_channel_id` access in threadPerms.ts
- [x] F054: Type avatarScan.ts displayAvatarURL options properly

### Medium Fixes (15-30 min each)
- [ ] F055: Replace `as any` channel property access with proper type narrowing in serverAuditDocs.ts

### Large Fixes (1+ hour)
- [ ] F052: Refactor modmail open function to accept a parameter interface instead of interaction

### Deferred
- [ ] F056: Test coverage for avatar scanning modules
- [ ] F057: Shared event tracking framework for movie/game nights
- [ ] F058: Test coverage for dashboardBridge
- [ ] F059: Split serverAuditDocs.ts

### Cross-Reference Warnings
- F052 refactor touches dashboardBridge.ts and threadOpen.ts — the function signature change must be backwards-compatible or all callers updated
- F053 removal is safe — the field never existed in the schema
- F055 requires checking which Discord.js version is in use for available type guards

---

## See Also

- [Code Audit 2026 (parent)](../CODE-AUDIT-2026.md) — full audit summary and findings rollup
- [Round 4: Large Commands](round-4-large-commands.md) — previous round
- [Round 6: Shared Utilities](round-6-shared-utilities.md) — next round
- [Improvement Plan](IMPROVEMENT-PLAN.md) — pass-by-pass execution plan for these findings
