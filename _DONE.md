# Pawtropolis: Done

One-line dated ledger. Detail in [`done/`](./done/). Pair of [`_BACKLOG.md`](./_BACKLOG.md).

Reverse chronological by completion date.

## 2026-05-31

- [x] [Enable tsconfig noUncheckedIndexedAccess and unused checks](done/00024.md) `Medium` TypeScript strict mode completed. Cleared 354 noUncheckedIndexedAccess errors across 5 layers (src/lib, src/web, src/features, src/commands, scripts) then flipped the flag; enabled noUnusedLocals + noUnusedParameters and pruned 114 unused symbols (8-agent sweep). Two real bug-guards landed (gate/dmVerification zero-questions crash earlier; isitreal unknown-service). typecheck 0, 5455 tests, build green.

## 2026-05-28

- [x] [Stats Observatory: public no-JS stats page with isolated theme](done/00049.md) `High` Epic. Public zero-JS /observatory page, fixed Observatory night-sky theme, ten precomputed rollup tables (migration 078) refreshed via `npm run stats:refresh`. 3 requests (1 HTML + 2 CSS), LCP ~116ms, CLS 0. Prod deploy + 078 apply stay owner-triggered (gated on #00046).
- [x] [Stats Observatory Phase 0: discovery and metric selection](done/00050.md) `High` 16-agent workflow verified schema, enumerated 56 metrics, chose 14 for v1. Brief at docs/stats-observatory/design-brief.md.
- [x] [Stats Observatory Phase 1: isolated theme design](done/00051.md) `High` 11-agent judge-panel; owner picked Observatory. Hardcoded scoped tokens, no --hue, zero webfonts.
- [x] [Stats Observatory Phase 2: rollup migration, refresh script, query module](done/00052.md) `High` Migration 078 + refreshPublicStats + stats:refresh CLI + rollup-only query module. 11 aggregation tests; 5453 total green.
- [x] [Stats Observatory Phase 3: page build with server-rendered SVG charts](done/00053.md) `High` /observatory route (csr=false), 11 zero-JS SVG/CSS chart components, web check + build green.
- [x] [Stats Observatory Phase 4: performance verification](done/00054.md) `High` Chrome DevTools: 0 JS/fonts/images, LCP ~116ms, CLS 0. 8 skeptic agents + contrast pass; donut/a11y/contrast/zero-JS fixes landed.
- [x] [Stats Observatory Phase 5: code review, docs, ship](done/00055.md) `High` Triple-lens review clean; one-click update path documented at docs/operations/stats-observatory.md.

## 2026-05-27

- [x] [Refactor index.ts into event modules](done/00007.md) `High` 2705 -> 341 lines. Handlers extracted to src/events/ + ClientReady to startup/ready.ts; index.ts now registration + lifecycle wiring only.
- [x] [Refactor dashboardApi.ts into route modules](done/00008.md) `High` 1792 -> 114 lines. Routes to src/web/routes/ (11 modules) + shared context.ts; tests per route group also satisfied #00012.
- [x] [Refactor audit.ts into subcommand modules](done/00009.md) `High` 1760 -> 115 lines. Dispatcher routes to src/commands/audit/ (12 modules) + shared.ts + buttonRouter.ts.
- [x] [Refactor serverAuditDocs.ts into 3 modules](done/00010.md) `High` 1740 -> 373 lines. Split to src/features/serverAudit/{analyze,docs,types}.ts; analyzer API now reused by scheduler + subcommands. Gap: no dedicated analyzer unit test (covered indirectly by suite).
- [x] [Refactor gate.ts into a state machine](done/00011.md) `High` 1602 -> 28 lines (barrel). Status lifecycle extracted to src/features/gate/flow.ts (predicates + GATE_TRANSITIONS + classifyDraftStatus, Discord-independent); ensureGateEntry moved to gate/entryPanel.ts. 20 new flow tests. Gap: handlers stayed in one handlers.ts rather than a per-handler subdir.
- [x] [Regenerate schema.sql from post-077 dump](done/00045.md) `Medium` Fixture now reflects all migrations (88 tables vs 63; ticket 17-col post-067). Added scripts/gen-test-schema.ts + `npm run gen:test-schema` (was referenced but missing); dropped all 4 MISSING_DDL shims. Bonus: fixed 5 latent migration-runner bugs (046/055/058/062/063) blocking advance past 045. Note: prod may also be stuck at 045.
- [x] [Un-skip flag.store.test.ts, cover flagsStore CRUD](done/00047.md) `Medium` 13 tests against in-memory DB (getExistingFlag, isAlreadyFlagged, getFlaggedUserIds, upsertManualFlag insert/update/override/truncate). Module was already lazy-init; only the skipped placeholder remained. Audit finding 7. 5425 tests, no skips.
- [x] [Patch current npm audit vulnerabilities](done/00048.md) `High` npm audit fix: rollup 4.52.4 -> 4.60.4 (path-traversal HIGH) + ajv ReDoS (moderate). Transitive build-chain only, package.json unchanged. 0 vulnerabilities now. Security finding 2 (present-day form).

## 2026-05-22

- [x] [Add web/ API route and dashboard page tests](done/00012.md) `High` 13 slices: routes 36/36 (slices 1-9), pages 22/22 (slices 10-13). Around 125 new tests. Established `tests/web/_helpers/{requestEvent,db}.ts` + `tests/web/pages/` directory. Spawned #00043 (sse), #00044 (closed export branches), #00045 (schema regen).

## 2026-05-20

- [x] [SSE handler tests](done/00043.md) `Medium` 7 tests covering auth, fan-out registration, heartbeat cadence, and cancel cleanup. Sibling slice covered backfill/stream with the same fake-timer pattern.
- [x] [api/export: drop broken audit + config_audit branches](done/00044.md) `High` Both queries referenced nonexistent identifiers (`audit_results` table; `config_audit_log.changed_at_s` column) and threw 500 in production. No UI consumers found, so removed rather than guessing intent. Spawn feat todos if anyone wants the exports back.

## 2026-05-19

- [x] [securityDiff tests](done/00017.md) `Medium` 8 tests covering computeSnapshotDiff + hasMeaningfulChanges + getDangerousChanges. auditRunner deferred (orchestration; mock-heavy).
- [x] [avatarScan helper tests](done/00016.md) `Medium` 8 tests for googleReverseImageUrl + getScan. scanAvatar deeper coverage deferred.
- [x] [Scheduler smoke tests x5](done/00018.md) `Medium` 5 new test files (19 tests) covering start/stop/disable for byteMultiplier, diskSpace, eventTimeout, guildSnapshot, securityAudit.
- [x] [TypeScript 6.0.3 upgrade](done/00033.md) `Medium` Clean: 0 typecheck errors, all 4927 tests pass.
- [x] [Litestream pre-deploy status check](done/00040.md) `Low` deploy.sh now verifies systemctl is-active litestream before bot/full deploys.
- [x] [setDMPermission(false) on guild commands](done/00025.md) `Low` 16 commands now hide in DMs. Discord deploy:cmds still required.
- [x] [health.ts timeout test re-enabled](done/00015.md) `Medium` Fixed stale .ephemeral assertion to MessageFlags pattern. All 7 tests pass.
- [x] [hasStaffPermissions tests restored](done/00014.md) `Medium` Skip premise was wrong (no require() in function). Implemented 5 tests, all pass.
- [x] [Origin CSRF check on dashboardApi](done/00006.md) `Medium` State-changing routes now require Origin in allowlist (env DASHBOARD_ALLOWED_ORIGINS).
- [x] [Refactor flagsStore.ts for testability](done/00013.md) `Medium` Lazy-prepare statements via memoized lazyStmt factory; unblocks vi.mock interception.
- [x] [Prettier format web/](done/00022.md) `Medium` 139 files reformatted. .prettierignore expanded for build artifacts.
- [x] [Replace any in scripts/commands.ts](done/00020.md) `Medium` 16 any -> CmdOption/CommandSpec + unknown catches. Typecheck clean.
- [x] [Replace any in opsHealth.ts](done/00021.md) `Medium` 12 any -> unknown + errMsg helper. Typecheck clean.
- [x] [CI smoke check on built artifact](done/00030.md) `Medium` Added node --check dist/index.js to build job.
- [x] [/listopen rate limit](done/00019.md) `Medium` LISTOPEN_MS=60s per guild. Ephemeral cooldown reply on hit.
- [x] [Eslint env for scripts/workers/web/svelte](done/00023.md) `Medium` 1038 -> 95 no-undef (-91%). Added Node18 web globals + browser globals + Svelte 5 runes + Workers runtime.
- [x] [Discord webhook for cron failures](done/00027.md) `Medium` Failure step added to both badge workflows; gracefully no-ops if webhook secret unset.
- [x] [Deploy lock moved out of /tmp](done/00028.md) `Medium` Lock now lives in /home/ubuntu (user-owned), not /tmp (world-writable).
- [x] [PM2 kill_timeout raised for graceful shutdown](done/00029.md) `Medium` Bot 5s -> 15s, web default -> 10s. Lets in-flight work drain.
- [x] [Default BACKUP_BEFORE_DEPLOY=1](done/00031.md) `Medium` Production deploys now auto-backup DB; override with =0.
- [x] [Resolve TODO in activityTracker (JSON fallback)](done/00036.md) `Low` Replaced with Pino-covers-it note; feature redundant.
- [x] [Resolve TODO in art.ts (circular dep workaround)](done/00035.md) `Low` Replaced vague TODO with deliberate-choice comment.
- [x] [Add SSH host validation to deploy.sh](done/00039.md) `Low` Checks ~/.ssh/config + known_hosts before deploy; fails fast with clear error if alias missing.
- [x] [Sync .env.example with runtime variables](done/00041.md) `Low` Added 15 missing vars across NSFW/GitHub/SSH/Anthropic sections. Diff now empty.
- [x] [Upgrade typescript-eslint to ^8.59.4](done/00034.md) `Low` 13 patches integrated cleanly. Typecheck green.
- [x] [Clean stale .env backups](done/00042.md) `Low` Deleted 3 local files (.env.build, .env.migration-backup, .env.pre-new-bot.bak). Already gitignored via `.env.*` pattern.
- [x] [Remove 5 unused exports](done/00026.md) `Low` No-op close: 4 of 5 already absent from source (stale audit), 5th (OAUTH_RATE_LIMIT_MAX_REQUESTS) actually in use.
- [x] [Fix empty block in build-overlay-weekly.mjs](done/00037.md) `Low` Annotated intentional empty catch with inline comment.
- [x] [Move @anthropic-ai/sdk to devDeps](done/00038.md) `Low` Used by scripts/llm-label.mjs (offline tool). Moved out of prod install footprint instead of removing.
- [x] [Upgrade Sentry packages (26 patches behind)](done/00005.md) `High` Bumped @sentry/node + @sentry/profiling-node ^10.20.0 -> ^10.53.1. No API changes, typecheck clean.
- [x] [Patch HIGH and CRITICAL npm vulnerabilities](done/00002.md) `Critical` Root + web/ npm audit clean of HIGH/CRITICAL in production. Five commits: removed @xenova, upgraded fastify, upgraded discord.js, added root overrides for protobufjs+fast-uri+jws+minimatch+ws, upgraded web vite/sveltekit/svelte.
- [x] [Remove or isolate @xenova/transformers](done/00003.md) `Critical` Confirmed unused via grep + Vision-only inference path. Removed cleanly. 32 transitive packages dropped.
- [x] [Upgrade Vite in web/ to patch dev-server path traversal](done/00004.md) `High` Bundled into #00002 step 5; web build verified clean.
- [x] [Smoke test the new issue system](done/00001.md) Round trip verified end to end: file created, GH issue 1 mirrored with correct labels (TODO/chore/Nominal/IP), file moved to done/, sync closed the issue.
