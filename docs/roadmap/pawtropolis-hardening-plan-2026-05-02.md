# Pawtropolis Tech Hardening Plan — 2026-05-02

Branch: `hardening/reliability-test-orchestration-pass`

## Current state summary

Pawtropolis Tech is a high-complexity production Discord operations platform. v5.1.1, Node 20+, TypeScript, Discord.js v14, better-sqlite3, Vitest, PM2, Fastify dashboard API, EC2 deploy. Roughly 165 test files / 4455 passing tests. 74 migrations. 47 slash commands plus 2 context menus.

### Baseline check results (2026-05-02)

| Check | Status | Notes |
|------|--------|-------|
| `npm ci` | OK (assumed; node_modules present) | not re-run; lock files unchanged |
| `npm run typecheck` | FAIL — 2 errors | both in `src/commands/cleanup.ts` |
| `npm run lint` | FAIL — 2000 errors / 1456 warnings | almost entirely in `web/`, `workers/`, generated `dist/` |
| `npm run format:check` | FAIL — 1064 files | mixed `web/` + `src/` |
| `npm test` | FAIL — 1 suite (`tests/features/artistRotation/handlers.test.ts`) | 165 of 166 suites pass; 4455 tests pass |
| `npm run build` | OK | dist + scan:legacy clean |
| `npm run check` | FAIL (typecheck) | composite of above |

### Detailed failures

1. **Typecheck**:
   - `src/commands/cleanup.ts:58` — `requireMinRole(interaction, ROLE_IDS.MODERATOR)` is missing the third `options` arg.
   - `src/commands/cleanup.ts:158` — `("name" in channel ? channel.name : channel.id)` — TS narrows `channel` to `never` after the exhaustive type check above; needs assertion.

2. **Tests**:
   - `tests/features/artistRotation/handlers.test.ts` — `SqliteError: no such table: ticket_counter`. Root cause: `src/features/tickets/counters.ts` runs `db.prepare(UPDATE ticket_counter ...)` at import time. Migration 067 creates the table. The test setup imports the file transitively without running migrations.

3. **Lint** (selected): hundreds of `'$state' is not defined`, `'document' is not defined`, `URLSearchParams` etc. inside `web/` (Svelte runes / browser globals not configured in eslint), plus a bunch in `workers/discord-proxy/` (Cloudflare Workers globals). These are config gaps, not real defects.

4. **Format**: mostly `web/` Prettier drift, several config files. No critical files in `src/` blocking work.

## Complexity diagnosis

The biggest sources of accidental complexity right now:

1. `src/index.ts` is 2688 lines and orchestrates: command registration, schema self-heal, recovery hooks, scheduler boot, web server boot, modmail hydration, review-card refresh, ID-card refresh, all event handlers, the full interaction router, and shutdown.
2. Commands are registered both in `src/commands/buildCommands.ts` (for Discord registration) and again in `src/index.ts` (for runtime dispatch). No automated alignment.
3. CI tolerates failures with `continue-on-error` on typecheck, lint, format, and tests. Real issues hide behind the soft gate (cleanup.ts typecheck error has been there a while).
4. Dashboard API (`src/web/dashboardApi.ts`, 1782 lines) is a parallel mutation surface — approve/reject/kick/permreject/vote_out/claim/unclaim/modmail/QOTD/config/art jobs/etc. — with its own tier-check helper duplicated per-route.
5. Review approve/reject/kick are tested for the transaction layer but not in fully isolated DB; tests rely on mocked `db` rather than an in-memory better-sqlite3.
6. Modmail routing has 11 test files but lacks coverage of: closed-ticket-no-route, null-thread-id, DM-send-fail user feedback, transcript persistence, cache eviction.
7. Schema split: 74 formal migrations *and* a heavy `src/db/db.ts` + `src/db/ensure.ts` self-heal layer. Boundary undocumented.
8. `deploy.sh` has `set -euo pipefail` and a post-deploy health check, but no SSH timeouts, no deploy lock, no env override for `REMOTE_HOST`/`REMOTE_USER`, no rollback path.
9. `src/web/dashboardApi.ts` validates auth via header secret but has no tests for tier enforcement.
10. `tests/features/artistRotation/handlers.test.ts` failure indicates `src/features/tickets/counters.ts` runs DDL-dependent code at import time — fragile pattern.

## Top risks ranked by production impact

| Rank | Risk | Surface | Failure mode |
|------|------|---------|--------------|
| R1 | Command drift between `buildCommands.ts` and `index.ts` | every slash command | "Unknown command" reply or silent dead alias |
| R2 | Approve/reject/kick transaction state corruption | `src/features/review/flows/*` | terminal state regressions, double-approve, lost audit row |
| R3 | Dashboard API mutation without proper tier check | `src/web/dashboardApi.ts` | unauthorized approve/reject/kick from web |
| R4 | Modmail routing edge cases (closed, null thread, DM fail) | `src/features/modmail/routing.ts` | dropped user messages, no staff feedback |
| R5 | Startup failure cascade in `index.ts` | every recovery path | bot enters a half-up state |
| R6 | Schema self-heal regression | `src/db/db.ts`, `src/db/ensure.ts` | column-missing crash on startup |
| R7 | Deploy mid-flight collision (no lock) | `deploy.sh` | overlapping deploys, partial dist |
| R8 | Module-level DB prepare on missing table | `src/features/tickets/counters.ts` and similar | import-time crash, hard to test in isolation |
| R9 | CI hides real typecheck/test failures | `.github/workflows/ci.yml` | regressions land on main unnoticed |
| R10 | Observability gaps in dashboard mutation paths | `src/web/dashboardApi.ts` | hard to debug a botched action |

## Phase plan

The phases below preserve behavior. No commands, customId formats, dashboard contracts, or features change. New tests, extracted modules, and documentation only.

### Phase 0 — Baseline verification (DONE)

Captured above.

### Phase 1 — Command registration drift protection

- Extract a `src/commands/runtimeRegistry.ts` that returns the runtime command name → handler-name map (no Discord client needed).
- Add `tests/commands/registration.test.ts`:
  - every name in `buildCommands()` has a matching entry in `runtimeRegistry`
  - aliases (`accept`, `reject`, `kick`, `unclaim`) handled correctly
  - context menus excluded (`isitRealContextMenu`, `modmailContextMenu`)
  - no orphan runtime handlers
- Add `docs/reference/command-registration-invariants.md`.

Behavior: zero. Pure inspection.

### Phase 2 — Review transaction tests

Existing `tests/features/review/approve.test.ts` and `reject.test.ts` cover most cases. Add:

- `tests/features/review/kick.test.ts` (currently missing) covering kickTx state transitions: submitted/needs_info → kicked, approved/rejected → terminal, kicked → already, draft → invalid, missing app → throws. kickFlow tests already partially live in actionRunners.test.
- Strengthen approve test for `missing app → throws` path (add the explicit case).
- Strengthen reject test for `permanent_reject_at` SET only when permanent=true (currently only checks SQL pattern, not args).

Behavior: zero.

### Phase 3 — Dashboard API safety tests + extraction

- Extract `src/web/dashboardAuth.ts`:
  - `TIER_ORDER`
  - `hasMinTier(userTier, minTier)`
  - body validation helpers (`requireFields(body, ...names)`)
- Extract `src/web/dashboardResponses.ts` for `ApiSuccess` / `ApiError` shape (already implicit; promote to typed helper).
- Add `tests/web/dashboardAuth.test.ts`:
  - tier ordering: owner > cm > cdl > sa > admin > sm > mod > jm > gk > viewer > none
  - hasMinTier closes properly (owner vs gk, viewer vs gk, unknown tiers fail closed)
  - admin required for permreject
  - GK can claim/approve/reject/kick
- Add `docs/reference/dashboard-api-security.md` covering: header secret, tier enforcement, claim ownership rules, admin override semantics for unclaim.

Behavior: zero. dashboardApi keeps the same routes; helpers move to a sibling module.

### Phase 4 — Modmail routing/lifecycle tests

Add to existing test files (or new ones):

- `tests/features/modmail/routing.test.ts`:
  - closed ticket does not route
  - ticket with null thread_id does not route
  - thread fetch fails — non-fatal, logged
  - DM send fails — staff sees a useful warning
  - allowedMentions: SAFE_ALLOWED_MENTIONS is applied
- `tests/features/modmail/transcript.test.ts`:
  - successful relay calls `captureMessage` (or transcript persistence)
- `tests/features/modmail/dashboardBridge.test.ts`:
  - successful relay triggers dashboard notify
- `tests/features/modmail/cacheEviction.test.ts`:
  - forwarded message cache stays bounded under heavy traffic.

Behavior: zero. Privacy preservation (hide staff identity in DMs) is not changed.

### Phase 5 — Startup decomposition

Extract from `src/index.ts` only — preserve behavior, no reordering except where documented:

- `src/startup/schema.ts` — all `ensure*` calls
- `src/startup/recovery.ts` — panic state, movie/game session recovery, voice seeding, channel cache sync, modmail hydration, modmail retrofit, gate panel refresh, review card refresh, banner sync, invite cache, patreon dedup sweep
- `src/startup/schedulers.ts` — start* + stop* for all schedulers
- `src/startup/web.ts` — status endpoint + dashboard API start/stop
- `src/startup/discordRefresh.ts` — `syncCommandsToAllGuilds` hydration
- `src/startup/shutdown.ts` — gracefulShutdown
- `src/commands/runtimeRegistry.ts` — already in Phase 1, just plug in here

Result: `src/index.ts` orchestrates phases by name with `try/catch + log` per phase, preserving fail-soft behavior.

Tests: `tests/startup/runStartupTasks.test.ts` — orchestrator runs every task even if one fails; logs evt-tagged warnings; uses mocked task functions.

### Phase 6 — DB schema boundary hardening

- Extract `addColumnIfMissing` from `src/db/db.ts` into a testable utility `src/db/columnUtil.ts`.
- Add `tests/db/columnUtil.test.ts`:
  - rejects unsafe table/column names
  - rejects unsafe definitions (containing `;`, `--`, `/*`)
  - tolerates "no such table" errors
- Add `tests/db/legacyGuard.test.ts`:
  - prepare() rejects `__old` substring
  - prepare() rejects `ALTER TABLE ... RENAME`
- Document migrations vs ensure boundary in `docs/reference/database-schema-safety.md`:
  - migrations: durable, numbered, recorded in `_migrations` table
  - ensure helpers: idempotent backward-compat repair for legacy DBs only — every new column should land via a migration first.

Behavior: zero. Function relocation only.

### Phase 7 — CI honesty pass

Realistic fixes only:

1. Fix the two typecheck errors in `src/commands/cleanup.ts` (real bug — missing options arg) and remove `continue-on-error: true` from the Typecheck step.
2. Lint and format are huge (web/ Svelte/Cloudflare globals); these stay soft for this pass with a comment pointing to a follow-up. Keep continue-on-error but link to a TODO with measurable exit conditions.
3. Tests: fix the import-time crash in `src/features/tickets/counters.ts` by making `incrementStmt` lazy (memoized on first call). This unblocks `tests/features/artistRotation/handlers.test.ts`. Then remove `continue-on-error: true` from the Tests step.

Update `docs/operations/ci-policy.md` documenting hard vs soft gates and exit conditions for each soft gate.

### Phase 8 — Deployment hardening

`deploy.sh` changes that are non-destructive and preserve every flag:

- `REMOTE_USER`, `REMOTE_HOST`, `REMOTE_PATH`, `PM2_PROCESS` become env-overridable defaults (`: "${REMOTE_USER:=ubuntu}"` etc.).
- All `ssh`/`scp` calls use `-o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3`.
- Deploy lock via `mkdir /tmp/pawtropolis-deploy.lock` on remote before tar-extract; cleanup via `trap`.
- Optional pre-deploy DB backup: gated by `BACKUP_BEFORE_DEPLOY=1` env, runs `cp data/data.db data/backups/data.db.<ts>` on remote before the new tarball lands.
- Rollback path: keep prior `dist.bak` (one slot) on remote; document `--rollback` switch (separate, additive — does NOT change current default behavior).
- Optional `--dry-run` mode that prints commands without executing.
- Clearer preflight summary at the top of FULL deploy mode.

Add `docs/operations/deployment-hardening.md`.

### Phase 9 — Observability spot-check

- Verify `SAFE_ALLOWED_MENTIONS` use in dashboardApi confirmation messages (already present at line 119 — confirm coverage in tests).
- Check `withSql`/`withStep` wrap around dashboardApi mutations. If missing in critical paths, document in next-pass section rather than retrofit at scale.
- Update `docs/reference/observability-and-error-cards.md` only if missing or stale.

Behavior: zero. Pure documentation + spot tests.

### Phase 10 — Docs + TODO reconciliation

Update:

- `TODO.md` — mark CI deploy, deploy lock, REMOTE_HOST env, etc. as done where they are.
- `CHANGELOG.md` — Unreleased section with hardening pass entries grouped by area.
- New docs: see references in earlier phases.

### Phase 11 — Final validation

Re-run the baseline command set. Document any remaining failures with cause + next step.

## Test strategy

- Unit tests for pure helpers (tier ordering, body validation, addColumnIfMissing).
- Mock-based tests for transactions (no real DB) — keeps existing pattern.
- For the ticket-counter import crash fix: make import lazy and add `tests/features/tickets/counters.test.ts` covering missing-row throw.
- Startup orchestrator tests use mocked task functions to validate fail-soft semantics.
- No new integration tests against Discord; preserve discord.js mocking pattern already in use.

## Refactor boundaries

| Module | What moves | What does not |
|--------|------------|---------------|
| `src/index.ts` → `src/startup/*` | schema, recovery, schedulers, web, discord refresh, shutdown | imports, command map, event listeners, interaction router |
| `src/web/dashboardApi.ts` → `src/web/dashboardAuth.ts` | TIER_ORDER, hasMinTier, body validators | every route handler |
| `src/db/db.ts` → `src/db/columnUtil.ts` | `addColumnIfMissing` | DB connection, PRAGMAs, prepare wrapper, tx wrapper, table bootstrap |
| `src/features/tickets/counters.ts` | top-level prepared statement → lazy memoized prepare | external API |

## Files likely to change

```
src/index.ts                         (decomposed)
src/startup/schema.ts                (NEW)
src/startup/recovery.ts              (NEW)
src/startup/schedulers.ts            (NEW)
src/startup/web.ts                   (NEW)
src/startup/discordRefresh.ts        (NEW)
src/startup/shutdown.ts              (NEW)
src/commands/runtimeRegistry.ts      (NEW)
src/web/dashboardAuth.ts             (NEW)
src/db/columnUtil.ts                 (NEW, extracted)
src/db/db.ts                         (uses extracted util)
src/features/tickets/counters.ts     (lazy prepare)
src/commands/cleanup.ts              (typecheck fix)
deploy.sh                            (hardened, behavior-preserving)
.github/workflows/ci.yml             (typecheck + tests no longer soft)
docs/roadmap/pawtropolis-hardening-plan-2026-05-02.md (THIS)
docs/architecture/startup-lifecycle.md (NEW)
docs/reference/command-registration-invariants.md (NEW)
docs/reference/dashboard-api-security.md (NEW)
docs/reference/database-schema-safety.md (NEW)
docs/operations/deployment-hardening.md (NEW)
docs/operations/ci-policy.md         (NEW)
TODO.md                              (reconciled)
CHANGELOG.md                         (Unreleased entries)
tests/commands/registration.test.ts  (NEW)
tests/features/review/kick.test.ts   (NEW)
tests/web/dashboardAuth.test.ts      (NEW)
tests/features/modmail/routing.test.ts (additions)
tests/features/modmail/dashboardBridge.test.ts (NEW)
tests/db/columnUtil.test.ts          (NEW)
tests/db/legacyGuard.test.ts         (NEW)
tests/startup/runStartupTasks.test.ts (NEW)
tests/features/tickets/counters.test.ts (NEW)
```

## Behavior compatibility rules

- No command name changes.
- No customId format changes.
- No dashboard API route or response shape changes.
- No SQL schema changes (no new migrations).
- No removed features.
- Startup task order preserved; only the *file housing each task* changes.
- Error logs keep the same `evt:` field values where possible.

## Rollback strategy

This branch is one PR per phase commit-grouping. If a phase introduces a regression, revert the phase commit set and the others stay intact:

```
git revert <phase-N-first-commit>..<phase-N-last-commit>
```

For deploy.sh: the changes are flag-additive and env-fallback; old invocations (`./deploy.sh`, `./deploy.sh --bot`, etc.) keep working.

## Definition of done

- `npm run typecheck` passes.
- `npm test` passes (all 166 suites).
- `npm run build` passes.
- New tests cover every helper extracted.
- Plan, hardening docs, and TODO updated.
- CI workflow is no longer soft on typecheck/tests.
- Deploy script supports env overrides, lock, optional backup, rollback path, dry-run — without breaking current invocations.
- Final validation report attached at end of pass.

## TODO summary

See live tasks in TaskList. ~14 phase-level tasks plus per-phase sub-actions tracked there.
