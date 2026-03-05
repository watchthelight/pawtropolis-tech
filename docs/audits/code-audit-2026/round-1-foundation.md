# Round 1: Foundation (P0) — Audit Report

Audited: 2026-03-05
Files: 5 | Total Lines: 4,977

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `src/index.ts` | 2172 | Migration Evolved | 42 | None |
| `src/db/db.ts` | 386 | Migration Evolved | 11 | None (dbHealthCheck has tests) |
| `src/db/ensure.ts` | 917 | Migration Evolved | 8 | None |
| `src/lib/config.ts` | 1258 | Migration Evolved | 16 | `tests/lib/config.test.ts` |
| `src/lib/env.ts` | 244 | Migration Evolved | 11 | `tests/env.test.ts` |

---

## Findings

### F001 — Hardcoded guild ID in guildCreate handler
- **File**: `src/index.ts:838`
- **Severity**: MED
- **Category**: Dead Code / Portability
- **Description**: `const ALLOWED_GUILD = "896070888594759740"` is hardcoded. If GUILD_ID env var already exists, this should reference it instead. Currently if someone deploys a fork or tests in a different server, the bot auto-leaves.
- **Risk**: Low runtime risk (single-server bot), but bad practice.
- **Fix**: Replace with `env.GUILD_ID` or a dedicated env var.

### F002 — Unused destructured variable `role` in guildMemberUpdate
- **File**: `src/index.ts:1016`
- **Severity**: LOW
- **Category**: Dead Code
- **Description**: `for (const [roleId, role] of addedRoles)` — `role` is never referenced. Should be `[roleId]` only.
- **Risk**: None, cosmetic. Would be caught by `noUnusedLocals` if enabled.
- **Fix**: Change to `for (const [roleId] of addedRoles)`.

### F003 — `(interaction as any).customId` in owner override logging
- **File**: `src/index.ts:1137`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: Uses `as any` to access `customId` on a union type. Could use a type guard or optional chaining with `'customId' in interaction`.
- **Fix**: Replace with `('customId' in interaction ? interaction.customId : 'unknown')` or similar.

### F004 — `interaction as never` casts in error handler
- **File**: `src/index.ts:1989,1991`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `ensureDeferred(interaction as never)` and `postErrorCard(interaction as never, ...)` — workaround for union type not narrowing in catch block. The `never` cast is technically unsafe.
- **Fix**: Could type-narrow with a helper or accept the cast as intentional.

### F005 — No test file for index.ts
- **File**: `src/index.ts`
- **Severity**: MED
- **Category**: Test Coverage
- **Description**: The entry point has zero test coverage. Startup sequence, interaction routing, graceful shutdown, deduplication — all untested. The `if (!process.env.VITEST_WORKER_ID)` guard at line 2167 shows testing was considered but never implemented.
- **Risk**: Regressions in routing logic would go undetected.
- **Fix**: Defer — would require significant mocking infrastructure.

### F006 — db.prepare monkey-patch uses `as any` extensively
- **File**: `src/db/db.ts:43-87`
- **Severity**: MED
- **Category**: Type Safety
- **Description**: The traced prepare wrapper casts `db`, `statement`, and `method` through `as any` (6 casts). The wrapping itself is sound (intercepts run/get/all to add error logging), but a better-sqlite3 major version bump could break it silently since the type contract is erased.
- **Risk**: Medium — if better-sqlite3 changes method signatures, errors would be opaque.
- **Fix**: Could type the wrapper more precisely using `Database` and `Statement` types from better-sqlite3.

### F007 — Error extraction uses `(err as any)` pattern
- **File**: `src/db/db.ts:74-77`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `(err as any)?.name`, `(err as any)?.code`, etc. The catch variable is typed `unknown` implicitly but accessed via `as any`. Standard pattern would be `err instanceof Error ? err.name : String(err)`.
- **Fix**: Use `unknown` narrowing pattern.

### F008 — SQL_IDENTIFIER_RE duplicated across files
- **File**: `src/db/db.ts:177` and `src/db/ensure.ts:485`
- **Severity**: LOW
- **Category**: Duplication
- **Description**: Same regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/` defined in both files. Should be a shared constant.
- **Fix**: Extract to a shared `src/db/constants.ts` or `src/db/utils.ts`.

### F009 — Schema creation mixed with connection setup in db.ts
- **File**: `src/db/db.ts:89-382`
- **Severity**: MED
- **Category**: Pattern Consistency
- **Description**: `db.ts` creates 8 tables (review_card, review_claim, transcript, modmail_ticket, modmail_message, artist_queue, artist_assignment_log, art_job, audit_sessions, audit_scanned_users) and ~15 indexes inline at module load. This mixes two concerns: "open a database connection" and "ensure schema exists". The `ensure.ts` file exists for this purpose but only covers some tables.
- **Risk**: Hard to know which tables are created where. New developers would look in ensure.ts and miss half the schema.
- **Fix**: Defer — large refactor. Could consolidate all CREATE TABLE IF NOT EXISTS into ensure.ts or a dedicated schema.ts.

### F010 — Bare catch on action_log index creation
- **File**: `src/db/db.ts:246`
- **Severity**: LOW
- **Category**: Error Handling
- **Description**: `catch { }` with no error variable or logging. Comment says "Table may not exist yet" but this swallows ALL errors including disk full, corruption, permissions.
- **Fix**: Log at debug level or narrow to specific error message.

### F011 — Orphaned JSDoc blocks in ensure.ts
- **File**: `src/db/ensure.ts:508-515` and `630-636`
- **Severity**: LOW
- **Category**: Documentation
- **Description**: JSDoc for `ensureActionLogSchema` (line 508) is immediately followed by JSDoc for `ensureManualFlagColumns` (line 509) before the actual function. The `ensureActionLogSchema` function is at line 550. Similarly, `ensureActionLogFreeText` JSDoc at 630 is followed by `ensureSearchIndexes` JSDoc at 637, but `ensureActionLogFreeText` is at 669.
- **Fix**: Move JSDoc blocks to directly above their functions.

### F012 — `runReviewActionMigration(db: any)` parameter
- **File**: `src/db/ensure.ts:278`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: The `db` parameter is typed `any` even though it's the same `Database` instance imported at the top of the file. The function is only called once with the module-level `db`.
- **Fix**: Type as `Database` from better-sqlite3, or remove the parameter and use the module-level `db` directly.

### F013 — No test files for db.ts or ensure.ts
- **File**: `src/db/db.ts`, `src/db/ensure.ts`
- **Severity**: MED
- **Category**: Test Coverage
- **Description**: No dedicated tests for database bootstrap or schema ensures. Schema migration logic (runReviewActionMigration, ensureActionLogFreeText) runs transactional backup+recreate patterns that could lose data if bugged.
- **Fix**: Defer — would require test database fixtures.

### F014 — Massive re-export block in config.ts
- **File**: `src/lib/config.ts:52-78`
- **Severity**: LOW
- **Category**: Pattern Consistency
- **Description**: config.ts re-exports ~20 symbols from `roles.ts` and `permissionCard.ts`, making it a barrel/facade. This means any file that needs `ROLE_IDS` imports from config.ts, which also pulls in db, logger, env, etc. Increases coupling.
- **Risk**: Circular dependency potential. Import overhead.
- **Fix**: Consumers should import directly from `roles.ts` and `permissionCard.ts`. Remove re-exports. This is a broad change — needs cross-reference.

### F015 — GuildConfig type has 70+ fields, no runtime validation
- **File**: `src/lib/config.ts:83-175`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: The `GuildConfig` type is a 1:1 mapping of the SQL row. No Zod or runtime validation on `getConfig()` — the raw SQL result is cast directly. If a column is missing (e.g., migration not run), the field silently becomes `undefined`.
- **Risk**: Low in practice since ensures run at startup. But fragile if ensure order changes.
- **Fix**: Defer — adding Zod would be a significant change. The current ensure pattern handles this adequately.

### F016 — ALLOWED_CONFIG_COLUMNS set duplicates GuildConfig type
- **File**: `src/lib/config.ts:608-629`
- **Severity**: MED
- **Category**: Duplication / Maintainability
- **Description**: The allowlist of valid column names for upsert is a separate `Set` that must be manually kept in sync with the `GuildConfig` type. If a new config column is added to the type but not the Set, upserts silently drop it with only an error log. The field `nsfw_alert_role_id` is in GuildConfig (line 152) but NOT in ALLOWED_CONFIG_COLUMNS.
- **Risk**: Silent data loss on upsert for forgotten columns.
- **Fix**: Derive the Set from `GuildConfig` keys, or add `nsfw_alert_role_id` and audit for other missing columns.

### F017 — getBotOwnerIds() duplicates owner.ts logic
- **File**: `src/lib/config.ts:897-908`
- **Severity**: LOW
- **Category**: Duplication
- **Description**: `getBotOwnerIds()` parses `env.OWNER_IDS` into an array. `src/lib/owner.ts` already does this with `isOwner()` which checks the same env var. The function is only used in `hasGateAdmin()`.
- **Fix**: Use `isOwner()` from owner.ts instead.

### F018 — 7 nearly identical ensure*Column functions
- **File**: `src/lib/config.ts:259-475`
- **Severity**: MED
- **Category**: Duplication / Pattern
- **Description**: `ensureUnverifiedChannelColumn`, `ensureWelcomeTemplateColumn`, `ensureWelcomeChannelsColumns`, `ensureModRolesColumns`, `ensureDadModeColumns`, `ensureSkullModeColumns`, `ensureListopenPublicOutputColumn` — each follows the exact same pattern: check table exists -> PRAGMA table_info -> ALTER if missing -> add to ensuredMigrations Set. A generic helper like `ensureColumns("guild_config", [{name, def}])` would collapse ~200 lines to ~30.
- **Fix**: Extract a shared `ensureGuildConfigColumns(migrationName, columns)` helper.

### F019 — HEALTH_CHECK_INTERVAL_SECONDS typed as string
- **File**: `src/lib/env.ts:172-175`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: `HEALTH_CHECK_INTERVAL_SECONDS`, `QUEUE_BACKLOG_ALERT`, `P95_RESPONSE_MS_ALERT`, `WS_PING_MS_ALERT` are all typed as `z.string().optional()` but semantically represent numbers. Consumers must parse them manually.
- **Fix**: Use `z.coerce.number().optional()` for these fields.

### F020 — GATE_SHOW_AVATAR_RISK reads process.env directly
- **File**: `src/lib/env.ts:241`
- **Severity**: LOW
- **Category**: Pattern Consistency
- **Description**: `GATE_SHOW_AVATAR_RISK` reads from `process.env` directly with a regex test, bypassing the zod schema. Every other env var goes through the schema. This is a one-off inconsistency.
- **Fix**: Add to the zod schema with a custom transform.

### F021 — console.error in env validation
- **File**: `src/lib/env.ts:225`
- **Severity**: SKIP
- **Category**: Pattern
- **Description**: Uses `console.error` instead of `logger` for env validation failure. This is correct — logger depends on env, so it can't be used before env is validated.
- **Fix**: None needed. Intentional.

---

## TODO List (for improvement pass)

### Quick Fixes (< 5 min each)
- [x] F002: Remove unused `role` variable in index.ts:1016
- [x] F003: Fix `as any` cast for customId in index.ts:1137
- [x] F008: Extract shared SQL_IDENTIFIER_RE to db/utils.ts
- [x] F010: Add debug logging to bare catch in db.ts:246
- [x] F011: Fix orphaned JSDoc blocks in ensure.ts
- [x] F012: Type runReviewActionMigration parameter properly
- [ ] F017: Replace getBotOwnerIds() with isOwner() in config.ts

### Medium Fixes (15-30 min each)
- [x] F001: Replace hardcoded guild ID with env.GUILD_ID
- [x] F016: Audit ALLOWED_CONFIG_COLUMNS for missing columns (nsfw_alert_role_id confirmed missing)
- [ ] F018: Extract shared ensureGuildConfigColumns helper to collapse 7 functions
- [ ] F019: Convert numeric env vars to z.coerce.number()
- [ ] F020: Add GATE_SHOW_AVATAR_RISK to zod schema

### Deferred (large scope or risky)
- [ ] F005: Test coverage for index.ts (needs mocking infra)
- [ ] F006: Improve db.prepare monkey-patch typing
- [ ] F009: Consolidate schema creation (db.ts vs ensure.ts)
- [ ] F013: Test coverage for db.ts and ensure.ts
- [ ] F014: Remove config.ts re-exports (broad import changes)
- [ ] F015: Add runtime validation to getConfig()

### Cross-Reference Warnings
- F008 fix touches db.ts AND ensure.ts — both must be updated together
- F014 re-export removal would touch 50+ importing files — needs grep to verify scope
- F016 column allowlist must stay in sync with GuildConfig type — check after any config column additions
- F018 ensure helper refactor must not change migration behavior — test with existing DB
