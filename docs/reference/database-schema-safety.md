# Database schema safety

Pawtropolis Tech evolves its SQLite schema through two mechanisms. They look similar from the outside, but they have different responsibilities and different operational risks.

## The two mechanisms

### Migrations

Files in `migrations/<NNN>_<name>.ts`. Run by `scripts/migrate.ts` (locally) and `scripts/migrate-remote.js` (on the server during deploy.sh step 6.5).

- Numbered, ordered, applied at most once. The `_migrations` table tracks which have run.
- Free to do anything: CREATE TABLE, CREATE INDEX, INSERT seed data, transactional table-recreate to drop a CHECK constraint, etc.
- If a migration fails, the rest of the deploy bails. There is no automatic rollback for migrations that partially succeeded — each migration should run inside its own transaction.

This is the **default** path for schema changes. New columns, tables, indexes, and FK constraints belong here.

### Ensure helpers

Functions in `src/db/ensure.ts`, plus the inline `addColumnIfMissing` block at the top of `src/db/db.ts`. Run at every `Events.ClientReady` startup via `runSchemaSelfHeal` (`src/startup/schema.ts`).

- Idempotent: each call probes `PRAGMA table_info` (or sqlite_master) and either does the work or no-ops.
- Their job is to bring **legacy databases** up to current expectations — DBs that pre-date a given migration, or production rows installed before the migration framework existed.
- They must remain backward-compatible. Changing an ensure helper to require a column that doesn't yet exist would crash startup on an older DB.

This is the **legacy compatibility** path. New work should go through migrations; the ensure layer exists so older DBs still boot cleanly.

## When to use which

| Goal | Mechanism |
|------|-----------|
| Add a new column to an existing table | Migration (default) |
| Add a new column for legacy DBs that missed the migration | Migration first; ensure helper only if the migration has already shipped and you cannot guarantee everyone re-ran it |
| Create a new table | Migration |
| Add an index for a query-perf fix | Migration |
| Drop a CHECK constraint via table-recreate | Migration; the existing pattern in `runReviewActionMigration` is a good template |
| Add a new ensure* helper | Only when you have a reason a migration cannot accomplish the same thing — e.g. a column that needs to exist before the migration runner itself starts |

## Identifier validation

Every ensure helper that takes a table or column name passes it through `SQL_IDENTIFIER_RE` (`src/db/utils.ts`). The regex is `^[a-zA-Z_][a-zA-Z0-9_]*$` — no spaces, no quotes, no semicolons, no parentheses. Anything else throws.

`addColumnIfMissing` (now in `src/db/columnUtil.ts`) extends that with a definition-string check that rejects `;`, `--`, and `/*`. These are the only characters that could chain a second statement or hide arbitrary SQL through a comment.

`tests/db/columnUtil.test.ts` covers this validation.

## Legacy SQL guard

`src/db/db.ts` wraps `db.prepare` to reject any SQL string matching:

```
/__old|ALTER\s+TABLE\s+.+\s+RENAME/i
```

This catches two regressions:

1. References to `__old<thing>` tables. The bot used these as backup snapshots during one-shot migrations; they should never appear in runtime SQL.
2. `ALTER TABLE ... RENAME` statements. Renaming columns or tables at runtime breaks query plans and cached prepared statements; if a rename is needed it belongs in a migration that uses the table-recreate pattern.

If you hit the guard, do not bypass it. Either fix the SQL or move the rename into a migration. `tests/db/legacyGuard.test.ts` asserts the regex still rejects both patterns.

There is also a one-time dev-mode scan in `index.ts` (skipped in production and Vitest) that walks `dist/` for `__old` references and `RENAME TO` matches. It logs warnings but does not fail startup.

## Slow transaction logging

`db.transaction` is wrapped to log a warning whenever a transaction takes longer than 100ms (`SLOW_TX_THRESHOLD_MS` in `src/db/db.ts`). This is a soft signal that something is locking the DB or doing work it shouldn't be doing. The wrapper does not abort slow transactions; the WAL busy_timeout (5 seconds) handles contention.

## PRAGMAs

`src/db/db.ts` sets these on every connection:

| PRAGMA | Value | Why |
|--------|-------|-----|
| journal_mode | WAL | concurrent reads alongside writes |
| synchronous | NORMAL | reduce fsync cost; WAL still safe |
| foreign_keys | ON | enforce declared FKs |
| busy_timeout | 5000ms | fail-soft under brief contention |
| cache_size | -32768 (32MB) | room for hot pages without crowding RSS |
| temp_store | MEMORY | keep large GROUP BY/ORDER BY off disk |

If you change a PRAGMA, document the trade-off here.

## Lazy module-level prepares

`src/features/tickets/counters.ts` and `src/features/artJobs/store.ts` prepare statements at module load time. If those tables are missing (e.g., a fresh test DB without migration 067 applied), the import itself crashes — you cannot even load the module to mock it.

This is the failure pattern that produced the `tests/features/artistRotation/handlers.test.ts` and `tests/commands/registration.test.ts` issues during the May 2026 hardening pass. The Phase 7 fix introduced lazy prepare wrappers (memoize on first call); follow that pattern for any new module-level statements.

If you must keep a module-level prepare:

- Make sure the migration that creates the table has shipped and run on every environment that will import the module.
- Add a test that imports the module under the standard test setup; if the import succeeds, you're safe.

## Where to start when adding a schema change

1. Decide whether a migration is enough. Usually yes.
2. Create `migrations/<next>_<name>.ts`. Use `db.transaction` to keep changes atomic. Add an entry to `migrations/lib/index.ts` if needed.
3. Run `npm run migrate:dry` then `npm run migrate` locally.
4. If you also need an ensure helper for legacy DBs, add it to `src/db/ensure.ts` and append the call to `runSchemaSelfHeal` in `src/startup/schema.ts`.
5. Add a regression test against the new schema (column add, index existence, etc.).
