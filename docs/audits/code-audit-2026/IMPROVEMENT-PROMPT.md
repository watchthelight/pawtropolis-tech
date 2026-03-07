# Code Audit 2026 — Improvement Session Prompt

Copy everything below the line into a fresh Claude Code session.

---

## Prompt

You are executing the Pawtropolis Tech Code Audit 2026 improvement plan. This is a methodical, multi-pass refactoring session based on a completed 8-round audit with 79 findings (F001-F079).

### Setup

1. Read the master audit file and improvement plan:
   - `docs/audits/CODE-AUDIT-2026.md`
   - `docs/audits/code-audit-2026/IMPROVEMENT-PLAN.md`

2. Read each round's audit report — these contain the exact file paths, line numbers, descriptions, cross-reference warnings, and TODO lists:
   - `docs/audits/code-audit-2026/round-1-foundation.md`
   - `docs/audits/code-audit-2026/round-2-gate-system.md`
   - `docs/audits/code-audit-2026/round-3-review-system.md`
   - `docs/audits/code-audit-2026/round-4-large-commands.md`
   - `docs/audits/code-audit-2026/round-5-feature-modules.md`
   - `docs/audits/code-audit-2026/round-6-shared-utilities.md`
   - `docs/audits/code-audit-2026/round-7-stores-schedulers-config.md`
   - `docs/audits/code-audit-2026/round-8-web-dashboard.md`

3. Run `npm run check` to confirm a clean baseline before ANY changes.

4. Create a task list from the IMPROVEMENT-PLAN.md passes (Pass 1 through Pass 8, plus the deferred large-scope items). Each pass becomes a task. Mark them pending.

### Rules

- **Read before writing.** Before editing ANY file, read it fully first. Do not edit files you haven't read in this session.
- **No explore agents.** Read all files yourself using the Read tool. Load docs, scripts, and source directly.
- **Cross-reference before every change.** Each round report has a "Cross-Reference Warnings" section. Before editing, grep the codebase to verify the change won't break imports, callers, or dependent modules. When a finding says "confirm no consumers," run the grep yourself.
- **Verify after every pass.** Run `npm run check` (typecheck + lint + format + test) after completing each pass. If it fails, fix it before moving on. Do not accumulate broken state.
- **Tiny commits.** One commit per pass (or per logical sub-group within a pass if the pass touches many files). Each commit message should reference the finding IDs it addresses. Author as `watchthelight <admin@watchthelight.org>`. No Co-Authored-By lines.
- **Fix all severities.** Work through HIGH, MED, and LOW findings. Skip only items explicitly marked SKIP or RESOLVED in the audit, or items in the "Deferred (Large Scope)" section of IMPROVEMENT-PLAN.md.
- **Update tracking.** After each pass completes and its commit lands, update the round report files: change the finding's status in the TODO list from `[ ]` to `[x]`. Update `CODE-AUDIT-2026.md` status line.

### Execution Order

Follow the passes in IMPROVEMENT-PLAN.md exactly:

**Pass 1: Dead Code Removal**
- Read each file listed in Pass 1
- Run the grep cross-reference checks listed in the plan
- Remove the dead code
- `npm run check`
- Commit: `chore: remove dead code identified in 2026 audit (F002, F029, F030, F033, F053, F062, F065)`

**Pass 2: Type Safety Quick Fixes**
- Read each file listed in Pass 2
- For F045 (listopen handler params): also read `src/index.ts` lines 1446-1460 and 1642-1660 to see how the handlers are called — confirm the interaction types match
- Apply each fix
- `npm run check`
- Commit: `fix: resolve as-any casts and loose typing (F003, F007, F035, F042, F045, F054)`

**Pass 3: Shared Utility Extraction**
- Read `src/db/db.ts`, `src/db/ensure.ts`, `src/commands/audit.ts`, `src/features/welcome.ts`, `src/lib/retry.ts`
- Create `src/db/utils.ts` with the shared `SQL_IDENTIFIER_RE`
- Replace duplicate `sleep()` calls with imports from `src/lib/retry.ts` (export it if not already exported)
- `npm run check`
- Commit: `refactor: extract shared SQL_IDENTIFIER_RE and sleep utility (F008, F043)`

**Pass 4: Logging & Error Handling Fixes**
- Read each file listed in Pass 4
- Apply each fix (bare catch logging, comment cleanup, logger level change, memberCount optimization, SSH config, SELECT 1)
- For F051 (SSH StrictHostKeyChecking): read the full SSH command context to make sure `accept-new` works with the deployment setup
- `npm run check`
- Commit: `fix: improve logging, error handling, and minor security hardening (F010, F023, F034, F047, F051, F067)`

**Pass 5: Config Column Allowlist Sync**
- Read `src/lib/config.ts` fully
- Compare every field in the `GuildConfig` type (lines ~83-175) against the `ALLOWED_CONFIG_COLUMNS` Set (lines ~608-629)
- Add any missing columns to the Set
- `npm run check`
- Commit: `fix: sync ALLOWED_CONFIG_COLUMNS with GuildConfig type (F016)`

**Pass 6: Hardcoded Guild ID**
- Read `src/index.ts` lines 836-845
- Read `src/lib/env.ts` to check if GUILD_ID is required or optional
- If GUILD_ID is optional: keep the hardcoded fallback with a comment, OR make GUILD_ID required in the env schema (check if that breaks anything)
- If GUILD_ID is required: replace the hardcoded value with `env.GUILD_ID`
- `npm run check`
- Commit: `fix: replace hardcoded guild ID with env reference (F001)`

**Pass 7: Web Dashboard Session Security**
- Read `web/src/lib/server/session.ts` fully
- Read `web/src/hooks.server.ts` and `web/src/routes/auth/callback/+server.ts`
- F072: Encrypt the session cookie. Options (pick one):
  - Option A: Use `crypto.createCipheriv` with AES-256-GCM and a `SESSION_SECRET` env var to encrypt before `cookies.set` and decrypt in `getSession`
  - Option B: Store tokens server-side in SQLite, put only a session ID in the cookie
  - Option A is simpler. Make sure to handle decryption failure gracefully (return null, force re-login).
- F075: Add a `getRequiredEnv(name)` helper or validate GUILD_ID/OAUTH2_REDIRECT_URI at the top of hooks.server.ts
- F079: Add `const MAX_CLIENTS = 200` check in `web/src/lib/server/events/fan-out.ts` addClient()
- `npm run check` (web: `cd web && npm run check` if separate)
- Commit: `security: encrypt session cookies and add web env validation (F072, F075, F079)`

**Pass 8: Documentation Cleanup**
- Read `src/db/ensure.ts` lines 500-670
- Fix orphaned JSDoc blocks (F011)
- Type `runReviewActionMigration` param (F012)
- Read and update `audit/02_DEAD_CODE_REPORT.md` — mark items removed in Pass 1 as resolved, update counts (F050)
- Update all round report TODO lists to mark completed items
- Update `CODE-AUDIT-2026.md` status to "Complete — Passes 1-8 applied"
- `npm run check`
- Commit: `docs: fix orphaned JSDoc, update dead code report and audit tracking (F011, F012, F050)`

### After All Passes

1. Run `npm run check` one final time
2. Run `npm test` to confirm full test suite passes
3. Present a summary of what was changed: files modified, findings resolved, anything deferred
4. Do NOT deploy — I will review and deploy manually

### What NOT to Do

- Do not fix deferred items (F032 action runner refactor, F018 ensure helper, F024 gate helper, F041 audit.ts split, F052 modmail refactor, test coverage items). These are large-scope changes for a separate session.
- Do not add new features, comments, or docstrings beyond what the findings specify.
- Do not refactor code that isn't listed in a finding.
- Do not run `git push` or deploy.
- Do not use explore agents or subagents — read everything directly.
