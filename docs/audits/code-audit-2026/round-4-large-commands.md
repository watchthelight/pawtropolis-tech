# Round 4: Large Commands (P1) — Audit Report

Audited: 2026-03-05
Files: 7 | Total Lines: ~6,631

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/commands/audit.ts` | 1684 | Early Addition | 20 | None |
| `src/commands/art.ts` | 1283 | Early Addition | 9 | None |
| `src/commands/movie.ts` | 811 | Early Addition | 11 | None |
| `src/commands/listopen.ts` | 787 | Migration Evolved | 11 | `tests/commands/listopen.test.ts` |
| `src/commands/roles.ts` | 706 | Early Addition | 7 | `tests/commands/roles.test.ts` |
| `src/commands/database.ts` | 662 | Migration Evolved | 9 | None |
| `src/commands/artistqueue.ts` | 698 | Early Addition | 10 | None |

---

## Overall Assessment

These are the "big" command files, each >600 lines. The code quality is generally good with proper error handling, rate limiting, and permission checks. The main concerns are:
- `audit.ts` is a 1684-line monolith handling 8 subcommands
- `movie.ts` is deprecated but still 811 lines in the codebase
- Three independent `sleep()` utility implementations across the codebase
- Some `interaction: any` parameters in listopen.ts handler exports
- Shell commands in database.ts are properly validated (good security)

---

## Findings

### F041 — audit.ts is a 1684-line monolith with 8 subcommands
- **File**: `src/commands/audit.ts`
- **Severity**: MED
- **Category**: Pattern / Maintainability
- **Description**: audit.ts handles members, nsfw, security, acknowledge, unacknowledge, acknowledge-all, trends, and diff subcommands all in one file. The security subcommand alone is ~130 lines. Button handling adds another ~700 lines. Finding specific subcommand logic requires extensive scrolling.
- **Risk**: Hard to navigate. Bug fixes in one subcommand risk collateral damage to others.
- **Fix**: Split into `audit/members.ts`, `audit/nsfw.ts`, `audit/security.ts`, `audit/acknowledge.ts`, etc. with a barrel index.ts. This mirrors the gate/ and review/ refactor patterns.

### F042 — `catch (editErr: any)` typed catch variable
- **File**: `src/commands/audit.ts:331`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `catch (editErr: any)` — TypeScript catch variables are `unknown` by default. Using `any` bypasses type checking on error access. Should use `unknown` with proper narrowing.
- **Fix**: Change to `catch (editErr: unknown)` and narrow with `editErr instanceof Error`.

### F043 — Three duplicate `sleep()` implementations
- **File**: `src/commands/audit.ts:1682`, `src/features/welcome.ts:220`, `src/lib/retry.ts:152`
- **Severity**: LOW
- **Category**: Duplication
- **Description**: Three identical `function sleep(ms: number): Promise<void>` definitions. Each file independently implements `new Promise(resolve => setTimeout(resolve, ms))`.
- **Fix**: Export from `src/lib/retry.ts` (which already has it) and import in audit.ts and welcome.ts. Or create a shared `src/lib/time.ts` export.

### F044 — movie.ts is deprecated but still 811 lines
- **File**: `src/commands/movie.ts`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: Header says "DEPRECATED: This command is deprecated in favor of /event movie." The command still works with a deprecation footer on every response. 811 lines of code that will eventually be removed.
- **Risk**: Maintenance burden. If movieNight.ts changes, both movie.ts and event/movie.ts need updating.
- **Fix**: Defer — this is a known migration. Track removal in a future cleanup pass.

### F045 — `interaction: any` in listopen.ts handler exports
- **File**: `src/commands/listopen.ts:645,738`
- **Severity**: MED
- **Category**: Type Safety
- **Description**: `handleListOpenPagination(interaction: any)` and `handleListOpenPageSelect(interaction: any)` — these handlers are called from index.ts's interaction router and should be typed as `ButtonInteraction` and `StringSelectMenuInteraction` respectively.
- **Risk**: Consumers could pass wrong interaction type without type errors.
- **Fix**: Type as `ButtonInteraction` and `StringSelectMenuInteraction`.

### F046 — generateNonce() uses Math.random() instead of crypto
- **File**: `src/commands/audit.ts:79-81`
- **Severity**: LOW
- **Category**: Security
- **Description**: `Math.random().toString(16).slice(2, 10)` generates an 8-char hex nonce for button security. Comment acknowledges it's "Not cryptographically secure." The `randomBytes` import from `node:crypto` is available in the same file (used elsewhere in database.ts).
- **Risk**: Low — nonce is only for preventing casual button spoofing, not for cryptographic security.
- **Fix**: Could use `randomBytes(4).toString('hex')` for consistency, but current approach is adequate for its purpose.

### F047 — `guild.members.fetch()` loads ALL members into memory
- **File**: `src/commands/audit.ts:899`
- **Severity**: LOW
- **Category**: Performance
- **Description**: The confirmation step does `await guild.members.fetch()` to get memberCount, loading ALL members into memory. The actual audit uses `guild.members.list()` with pagination (correctly). The fetch is only for the count display.
- **Risk**: For large guilds (50k+), this could spike memory briefly. For Pawtropolis's size, it's fine.
- **Fix**: Could use `guild.memberCount` (cached property) instead of fetching all members. The count may be slightly stale but that's acceptable for a confirmation prompt.

### F048 — audit.ts members audit doesn't use session tracking
- **File**: `src/commands/audit.ts:1183-1368`
- **Severity**: LOW
- **Category**: Pattern Consistency
- **Description**: The NSFW audit uses the session tracking system (createSession, markUserScanned, updateProgress, completeSession) for resume support. The members audit does NOT — it has no session creation, no resume capability, no progress persistence. If the bot restarts mid-members-audit, all progress is lost.
- **Risk**: Low — members audit is fast (CPU-bound, no API calls), so losing progress is less painful than NSFW audit.
- **Fix**: Defer — members audit is fast enough that resume support isn't critical.

### F049 — Missing test files for 5 of 7 commands
- **File**: audit.ts, art.ts, movie.ts, database.ts, artistqueue.ts
- **Severity**: MED
- **Category**: Test Coverage
- **Description**: Only listopen.ts and roles.ts have tests. The audit command handles expensive operations (Google Vision API, shell commands to remote servers). The database command runs SSH commands and file operations. These would benefit from at least permission and validation testing.
- **Fix**: Defer — requires significant mocking infrastructure.

### F050 — Dead code: `invalidateDraftsCache` removed from listopen.ts
- **File**: `src/commands/listopen.ts`
- **Severity**: RESOLVED
- **Category**: Dead Code
- **Description**: The dead code report (audit/02_DEAD_CODE_REPORT.md) flagged `invalidateDraftsCache` at line 285. This export no longer exists in the file — it was already cleaned up.
- **Fix**: None needed. Update dead code report to mark as resolved.

### F051 — `StrictHostKeyChecking=no` in SSH command
- **File**: `src/commands/database.ts:300`
- **Severity**: LOW
- **Category**: Security
- **Description**: `StrictHostKeyChecking=no` in the SSH command for remote health checks. Comment says "risky in prod, fine here" but this IS prod. If someone MITMs the connection, the bot would connect to a hostile server.
- **Risk**: Low — connection is to a known IP via SSH alias, and the command only reads data (verify-db-integrity.js).
- **Fix**: Change to `StrictHostKeyChecking=accept-new` which is safer (trusts on first connect, verifies after).

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [x] F042: Fix `catch (editErr: any)` to use `unknown` narrowing
- [x] F043: Replace duplicate sleep() implementations with shared import
- [x] F045: Type listopen handler parameters (ButtonInteraction, StringSelectMenuInteraction)
- [x] F047: Use `guild.memberCount` instead of `guild.members.fetch()` for confirmation count
- [x] F050: Update dead code report to mark invalidateDraftsCache as resolved
- [x] F051: Change StrictHostKeyChecking=no to accept-new

### Medium Fixes (15-30 min each)
- [ ] F046: Replace Math.random nonce with crypto.randomBytes (optional)

### Large Fixes (1+ hour)
- [ ] F041: Split audit.ts into subcommand modules (~1684 lines → 5-6 files)

### Deferred
- [ ] F044: Remove deprecated movie.ts (depends on migration timeline)
- [ ] F048: Add session tracking to members audit (low priority)
- [ ] F049: Test coverage for large commands (very large scope)

### Cross-Reference Warnings
- F043 sleep refactor touches audit.ts, welcome.ts — verify no circular import from lib/retry.ts
- F041 split must preserve the handleAuditButton export used in index.ts
- F045 typing must match how index.ts passes interactions to these handlers (check the regex match path)
- F051 SSH config change should be tested by running `./deploy.sh --status` to verify connectivity still works
