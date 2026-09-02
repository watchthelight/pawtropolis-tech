# Changelog

All changes to Pawtropolis Tech are tracked here.

**Versions:** [Unreleased](#unreleased) | [6.2.1](#621---2026-09-02) | [6.2.0](#620---2026-09-01) | [6.1.0](#610---2026-08-29) | [6.0.0](#600---2026-05-15) | [5.2.0](#520---2026-05-02) | [5.1.1](#511---2026-01-27) | [5.1.0](#510---2026-01-17) | [5.0.0](#500---2026-01-12) | [4.9.2](#492---2026-01-07) | [4.9.1](#491---2026-01-07) | [4.9.0](#490---2026-01-04) | [4.8.0](#480---2025-12-08) | [4.7.1](#471---2025-12-03) | [4.7.0](#470---2025-12-03) | [4.6.0](#460---2025-12-03) | [4.5.0](#450---2025-12-02) | [4.4.4](#444---2025-12-03) | [4.4.3](#443---2025-12-03) | [4.4.2](#442---2025-12-03) | [4.4.1](#441---2025-12-03) | [4.4.0](#440---2025-12-03) | [4.3.0](#430---2025-12-02) | [4.2.0](#420---2025-12-01) | [4.1.0](#410---2025-12-01) | [4.0.3](#403---2025-12-01) | [4.0.2](#402---2025-12-01) | [4.0.1](#401---2025-12-01) | [4.0.0](#400---2025-12-01) | [Earlier versions](#earlier-versions)

## [Unreleased]

Nothing yet.

## [6.2.1] - 2026-09-02

Housekeeping release after the 6.2.0 performance pass: dead code out, documentation checked against the code by tests, the dashboard config editor completed.

### Added

- Dashboard config editor covers every column the bot accepts: QOTD review channel and role, verify thread parent, unverified rules channel, level reward DMs, pulse excluded categories and the vote-out threshold (#00273).
- Documentation parity tests under `tests/docs/`: handbook and command reference against the registered commands, permission matrix against `roles.ts`, both env example files against the variables the code reads, and the config editor against the bot's allowlist (#00272).
- `npm run knip` dead-code report, also a soft CI step; `npm run docs:schema` regenerates the database schema reference from the fixture schema (#00271, #00272).
- Handbook sections for `/modmail`, `/movie`, `/event`, `/attendance` and `/resetprofile`; permission matrix rows for `/attendance`, `/modmail` and `/resetprofile` (#00272).

### Changed

- Google Vision pauses avatar scans for six hours after a 403 or 429 instead of failing every member join (#00275).
- The public handbook page no longer shifts its layout when the Inter web font loads (#00275).
- `.env.example` documents every variable the bot reads (38 operator knobs were missing) and drops five keys nothing read; `web/.env.example` gains the twelve dashboard keys it lacked (#00272).
- README, deployment and troubleshooting docs describe the current deploy flow, the operator knobs, backup pruning, the VACUUM procedure and how to read the performance log events (#00272).

### Removed

- 196 unused exports and 103 unused types across 60 files, found by knip and confirmed by `tsc` (#00271).
- 20 finished one-off scripts; `scripts/README.md` indexes what remains (#00271).
- The `pawtropolis-backfill` pm2 app, whose run completed (#00276).
- Generated documentation snapshots from March to June (moved to `docs/_archive/2026-scan/`) and the tracked `graphify-out`, `_charts_out`, `charts` and `design_handoff` output directories (#00272, #00261).

## [6.2.0] - 2026-09-01

Performance release. Nothing here changes what the bot does for members; it changes how much work each event, command and scheduler costs, and it makes that cost visible.

### Performance

- Interaction and member-event handlers import their modules statically instead of with `await import()` inside the click path (#00263).
- Prepared statements are cached in both the bot and the dashboard, so repeated SQL no longer compiles per call (#00263).
- The message path checks in-memory state (open modmail threads, active DM sessions, first-message and non-ticket channel caches) before touching the database (#00263).
- Modmail and ticket private threads add staff four members at a time; overwrites that are already granted are skipped (#00263).
- Reviewer permissions read from the config cache; short-code lookups and draft collision checks use indexes (#00263).
- The gate reads its banner asset once per process and waits for the review card event instead of polling (#00263).
- Invite tracking writes only changed invites; leave classification does one audit-log fetch (#00263).
- Mod metrics recalculate hourly; the Patreon sweep, security audit and NSFW audit read the member cache instead of fetching, and the security audit only posts when something changed (#00277, #00264).
- The NSFW avatar audit skips Vision calls for avatars it has already scored and found clean (#00264).
- Observatory rolling-author and cohort queries are set-based; search resolves usernames from `user_cache` instead of REST (#00264).
- Attendance is recorded in one transaction; inventory capture fetches the audit log once per guild per drain (#00264).
- The database is memory-mapped, the WAL is capped at 64 MB, and the dashboard page cache is smaller (#00265).
- Migrations back up with the online backup API and keep two copies (#00265).
- Startup warm-ups run concurrently, the message cache is smaller, `PRAGMA optimize` runs before close, and canvas and sharp load on demand (#00266).
- Logging writes through an asynchronous stream that is flushed on shutdown and fatal errors; Sentry profiling is opt-in (#00266).
- Badge SVGs and the manifest are served from memory; backup checksums stream instead of reading whole files (#00266).
- The dashboard streams backfill progress every 3 seconds with change-only payloads, caches the handbook what's-new walk per tier and day, streams ticket attachments from disk, and decodes one art upload at a time (#00267).
- The `GuildPresences` intent is gone: nothing reads presence, and the online count comes from the guild snapshot (#00266).
- User identity upserts are skipped when nothing changed (#00267).

### Operations

- The database integrity check runs in a child process every 6 hours instead of inline on every 60 second health tick; the boot check defaults to `quick` in production (#00277).
- Event handler timeout timers are cleared when the handler finishes (#00277).
- New retention scheduler: hourly full-text catch-up for the action log, daily `PRAGMA optimize`, and pruning of expired rows, deploy backups and 30-day-old verification review posts. Deletes run only with `RETENTION_ENABLED=true`; otherwise the scheduler logs what it would remove (#00265, #00269, #00258).
- Slow transaction warnings name the calling file and line (#00270).
- The system page shows database file, WAL and free-page sizes, the archived message count and event-loop lag; `/health` reports the last off-process integrity result (#00277).
- `scripts/cleanup-backups.sh` looks in `data/backups` and matches the names `deploy.sh` writes (#00269).
- New optional environment knobs: `SENTRY_PROFILES_SAMPLE_RATE`, `DB_INTEGRITY_INTERVAL_HOURS`, `SECURITY_AUDIT_INTERVAL_MINUTES`, `PATREON_SWEEP_INTERVAL_MINUTES`, `MOD_METRICS_INTERVAL_MINUTES`, `LOOP_LAG_WARN_P99_MS`, `RETENTION_ENABLED`. The example file now defaults `LOG_LEVEL` to `info` and the Sentry trace rate to 0.05.
- Dropped the unused `@google-cloud/vision` and `adapter-auto` dependencies; `@types/node` moved to dev dependencies (#00266).

### Fixed

- The dashboard modmail filter is whitelisted and bound as a parameter (#00267).

### Tests

- The suite runs against a per-worker temporary database seeded from the fixture schema instead of `data/data.db` (#00274).

## [6.1.0] - 2026-08-29

Everything landed since 6.0.0 (2026-05-15). Three headlines: the public Stats
Observatory page, the Sage Observatory redesign of the whole dashboard, and a
196-finding multi-agent codebase audit worked end to end. Underneath that,
TypeScript strict mode finished, the test framework upgraded, large modules
split apart, and every May security finding cleared.

### Added

- **Sage Observatory design system**: a token-based visual language adopted across
  every dashboard route and component, with three themes plus a Night/Day toggle, a
  Legacy switch, and an Appearance panel. The old four-style switcher and its alias
  token layer are gone. The public Observatory page also gained an optional classic
  Windows 95/98 desktop theme.
- **Handbook bookmarks**: star any section from its heading or from the table of
  contents; saved sections appear in a rail alongside the doc and persist per user
  rather than living in the browser.
- **Handbook diagrams**: ```mermaid fences render as diagrams instead of literal
  source, which fixes the Mod Handbook decision-flow chart.
- **Handbook what's-new highlights**: a section marked with an HTML comment carries a
  "New" badge and appears in a banner on the handbook and the dashboard home for a
  week, then drops off on its own.
- **Stackable reward inventory** (`/stash`, `/redeem`, migration 083): a Discord role
  is binary, so a second copy of a reward role used to be lost. Reward roles are now
  captured into a per-user ledger that stacks. Capture waits out a grace window so
  Mimu and Amari can finish their own post-grant checks, queues in SQLite so a restart
  mid-window still banks the item, and reads the audit log so a role handed out by a
  member of staff is left alone. `/redeem` hands one role back for the existing
  `/redeemreward` and `/usebyte` flows to consume.
- **Claim all open** on the reviews queue, for the bot developer.
- **Level reward DM toggle** (migration 082, wired into `/config`): silence reward DMs
  per guild.
- **Welcome flow**: the welcome embed is sent by DM and chat gets a single grouped
  ping line instead of one message per member.
- **Modmail** acknowledges relayed applicant DMs.
- **`/redeemreward` opened to all staff** (Junior Moderator and above).
- **Verified YCH role** wired into the art channel ping.

- **Stats Observatory** (`/observatory`): a public, zero-JavaScript stats page
  with its own fixed night-sky theme, separate from the rest of the site. Fourteen
  server-rendered SVG and pure-CSS charts (member growth, joins vs leaves, a 7x24
  activity heatmap, cohort retention, channel and voice activity, event turnout,
  QOTD funnel, top reactions, and an anonymized moderation-transparency block). The
  page reads only precomputed rollup tables (migration 078) refreshed out of band by
  `npm run stats:refresh`, so a request is a handful of small indexed reads: 3
  network requests total (1 HTML + 2 CSS), no client JS, no web fonts, no images.
  One-command update path documented in `docs/operations/stats-observatory.md`.
  (#00049 to #00055)
- **`/changelog` web page**: this changelog, rendered and themed on the dashboard.
  `/CHANGELOG.md` redirects here. (#00059)
- **`gen:test-schema` script**: regenerates `tests/fixtures/schema.sql` from a
  fully migrated database so the test fixture cannot silently drift from the real
  schema. (#00045)

### Changed

- **196-finding codebase audit** from a full multi-agent pass, filed as tracked issues
  and worked through in batches across commands, core and schedulers, modmail, review
  handlers, verify and gate, scripts and migrations, and the web dashboard.
- **Tautological tests replaced**, in two waves: suites that asserted against string
  literals now exercise the real modules.
- **Migration runner owns stamping** and supports an optional `verify<Version><Name>`
  post-condition, so a body that half-applies without throwing rolls back instead of
  being recorded as applied (#00141).
- **Observatory churn, cohort and pulse figures** derive from the append-only
  `action_log`, and member departures are logged as events.
- **Byte token config** extracted to `src/constants/byteTokens.ts` so modules needing
  only the role IDs no longer pull in prepared statements at import time.
- **Dead code removed**: the unregistered `/analytics` and `/approval-rate` modules,
  the duplicate review barrel, the help search-session and nonce machinery, the Xenova
  embed pipeline and its production cron entry, and a long tail of unused exports.

- **TypeScript strict mode completed.** Enabled `noUncheckedIndexedAccess`
  (354 errors cleared across `src/lib`, `src/web`, `src/features`, `src/commands`,
  and `scripts`) and `noUnusedLocals` + `noUnusedParameters` (114 unused symbols
  pruned). Index access is now guarded everywhere; dead imports and variables are
  gone. (#00024)
- **Vitest upgraded 3.2.4 to 4.1.7** (with `@vitest/coverage-v8` and `@vitest/ui`).
  Fixed the v4 fallout: mock constructors now use function implementations, default
  mock implementations are re-established between tests (v4 resets them), a stale
  mock path was repointed, and two tests that had been passing for the wrong reason
  now exercise the real code path. (#00032)
- **Large modules split for readability**, no behavior change: `index.ts`
  (2705 to 341 lines) into `src/events/` handlers plus a startup module (#00007);
  `dashboardApi.ts` (1792 to 114) into 11 route modules (#00008); `audit.ts`
  (1760 to 115) into subcommand modules (#00009); `serverAuditDocs.ts` into
  analyze/docs/types modules (#00010); and `gate.ts` (1602 lines) into a
  Discord-independent state machine plus focused handler modules (#00011).
- **TypeScript upgraded to 6.0.3** (#00033) and **typescript-eslint to ^8.59.4**
  (#00034).
- `@anthropic-ai/sdk` moved to devDependencies (offline tooling only), out of the
  production install footprint (#00038).

### Fixed

- **Byte tokens**: redemption is grant-then-consume with rollback, the confirm button
  is guarded against double-clicks, overlapping multipliers resolve longest-wins, and
  expiry reconciles per row (#00062, #00064, #00146, #00166, #00170).
- **Patreon art tickets**: redemptions are tracked, so a tier granting more than one
  ticket re-issues the role instead of permanently under-paying the top tier (#00077,
  #00085).
- **`/redeemreward`**: the next artist is claimed atomically at confirm time, closing a
  race where two back-to-back confirms drew the same artist; a spend now hard-fails
  when the recipient does not hold the ticket role.
- **Modmail**: the 7-day reopen window parses `closed_at` as UTC, threads resolve
  before reopening in place, and `modmail_delete_on_close` is honored (#00114, #00116).
- **Review**: ephemeral claim feedback no longer clobbers the public card, post-defer
  error handlers stay ephemeral, duplicate review cards are guarded, and vote-out
  survives the member leaving (#00073, #00074, #00078, #00079, #00138, #00142).
- **Art**: `art_job` timestamps parse as UTC, the monthly leaderboard boundary is
  computed in SQLite UTC, and the reassign INSERT binds `ticket_id` so the transaction
  commits.
- **Push notifications**: a stale cached tier is no longer trusted at send time, and
  demoted subscriptions are pruned, closing a tier-gated PII leak.
- **Verify**: the Finalize button is acknowledged, and the identity-document log
  channel resolves from per-guild config with an env override (#00162).
- **Gate**: `fetchPins().items` is treated as an array, and DM verification sessions
  are scoped by guild (#00164, #00239).
- **Timers**: the health-check timeout and the rate-limit cleanup interval are cleared
  and unref'd (#00189, #00238).
- **Retention**: the daily `message_activity` prune is actually scheduled (#00250).
- **Stats**: permanent rejections are counted via the `permanently_rejected` flag.
- **Web**: the OAuth state cookie is scoped to the apex domain, the bot owner can log
  in without guild membership, and the review queue cache busts on review events.

- **Error-card "Ping developer" is now rate limited per trace** (10 minutes). One
  error pings the bot dev once no matter how many times the button is clicked;
  blocked clicks get an ephemeral reply instead of another public ping. (#00058)
- **Dashboard reset-to-Discord theme button restored**: a refactor had removed the
  function and its backing state while the button kept calling it, so it threw at
  runtime. Also fixed the remaining web type errors (scan-session null narrowing,
  art job `thumbnailUrl`, two async GSAP callbacks): web `svelte-check` is now at
  zero errors. (#00057)
- **`/api/export`**: removed two routes that referenced a nonexistent table and
  column and returned 500 in production. (#00044)
- **Migration runner**: repaired migrations the runner could not apply, and guarded
  `applied_at` formatting against millisecond and invalid values. Regenerated
  `schema.sql` from the post-077 dump (88 tables) and dropped all `MISSING_DDL`
  shims. (#00045)
- **Litestream**: the replication data directory must be writable; corrected a
  read-only mount assumption.

### Security

- Patched all HIGH and CRITICAL npm vulnerabilities across root and `web/`: removed
  the unused `@xenova/transformers` (32 transitive packages dropped), upgraded
  fastify, discord.js, and the web Vite/SvelteKit/Svelte chain, and added overrides
  for protobufjs, fast-uri, jws, minimatch, and ws. (#00002, #00003, #00004)
- Upgraded Sentry packages (`@sentry/node`, `@sentry/profiling-node`) 26 patches
  forward. (#00005)
- `npm audit fix`: rollup path-traversal (HIGH) and ajv ReDoS (moderate) in the root
  build chain (#00048); postcss XSS and brace-expansion DoS in `web/` (#00056).
  Both audits are now clean of all non-`cookie`-chain issues.
- **CSRF**: state-changing dashboard routes now require an `Origin` in the
  configured allowlist (#00006).
- Guild slash commands hidden in DMs via `setDMPermission(false)` (#00025); deploy
  lock moved out of world-writable `/tmp` (#00028); SSH host validation added to
  `deploy.sh` (#00039); database auto-backup before deploy is now the default
  (#00031).

### Internal

- **Performance**: SSE-driven cache invalidation plus bounded review, modmail, heatmap
  and pulse queries (#00094, #00149, #00176, #00177, #00244).
- **Documentation**: `/stash` and `/redeem` documented in the bot handbook, the
  permissions matrix and the slash-command reference; the stale `/sync` row removed
  (it is not a registered command); the missing `/usebyte` row added; and the
  Moderation category row that appeared twice with different contents merged.

- **Test coverage expanded** without booting the bot: web API route and dashboard
  page tests (about 125 tests, new `tests/web/` helpers) (#00012); SSE handler tests
  (#00043); `flagsStore` CRUD (#00047); `securityDiff` and `avatarScan` helpers
  (#00016, #00017); scheduler smoke tests (#00018); `health` timeout and
  `hasStaffPermissions` suites restored (#00015, #00014). The suite is now 252 files
  / 5457 tests, green, no skips.
- CI: smoke-check the built artifact with `node --check dist/index.js` (#00030);
  Discord webhook alert on cron failures (#00027).
- Operational hardening: PM2 `kill_timeout` raised for graceful shutdown (#00029);
  `/listopen` rate limited per guild (#00019); ESLint env configured for
  scripts/workers/web/Svelte runes, cutting `no-undef` noise about 91% (#00023);
  `web/` reformatted with Prettier (#00022); `.env.example` synced with the runtime
  variables and stale `.env` backups removed (#00041, #00042).
- Replaced `any` with precise types in `scripts/commands.ts` and `opsHealth.ts`
  (#00020, #00021); resolved or annotated stale `TODO`s in `activityTracker`,
  `art.ts`, and `build-overlay-weekly.mjs` (#00036, #00035, #00037).

## [6.0.0] - 2026-05-15

Major release. Ships a new `/handbook` web page that mirrors every word of
`docs/` and renders it with per-section permission badges sourced from the
viewer's Discord roles. Also folds in the in-flight bot-side work from the
Unreleased section (cookie-cutter `/testidea`, `/help` drift closure, full
docs sweep, error-card buttons).

### Added

- **`/handbook` web page** (`web/src/routes/handbook/**`): Permission-aware
  live documentation at `/handbook` on the dashboard. Server-renders each
  `docs/*.md` file at startup with `marked.lexer()`, then walks the token
  tree to produce custom Svelte components (`MdNode`, `CommandSection`,
  `SectionBlock`, `Heading`, `Paragraph`, `Lists`, `Table`, `CodeBlock`,
  `Blockquote`, `Callout`, `Inline`, `PermissionBadge`, `LoginCta`). Every
  command and section gets a tier badge: green dot for "you can run this",
  lock icon + 55% body opacity for "you can read it, but cannot run it."
  Logged-out visitors see public-tier content with an inline sign-in CTA on
  staff-only sections. Mobile gets a bottom-sheet "On this page" TOC; the
  doc index lives in a left rail on desktop and a sliding drawer on phones.
- **Permission resolver** (`web/src/lib/server/handbook/permissionResolver.ts`):
  Parses "Who can use it" prose into a structured `HandbookTier` requirement.
  Handles `Bot Owner`, `Community Manager+`, `Senior Admin+`, `Admin+`,
  `Senior Mod+`, `Moderator+`, `Junior Mod+`, `Gatekeeper+`, `[GK]` (exact),
  bare `Staff` (treated as Gatekeeper+), Discord permission fallbacks
  (`Manage Messages`/`Manage Guild`/`Manage Roles`), `Mod Team`/`Community
  Ambassador`/`Server Artist` (viewer tier), and hybrid statements like
  `Manage Roles OR Community Ambassador OR Mod Team` (resolves to the
  lowest tier that satisfies the floor).
- **`/testidea` bot-dev cookie cutter** (`src/commands/testidea/currentAction.ts`):
  Rotating mass-action slot for the bot dev. Snapshot/restore are scoped by
  `ACTION_ID` so the action body can be swapped without schema churn or
  cross-contamination of stored state. Bot-owner-only.
- **Error-card action row** (`src/lib/errorCardV2.ts`,
  `src/handlers/errorCardButtons.ts`): Every "Command Failed" embed now
  ships with **Ping bot dev**, **Copy trace**, and **Run trace** buttons.
  *Ping* mentions `OWNER_IDS[0]` with the trace ID (staff-gated). *Copy*
  replies ephemerally with the trace ID in a code block for manual copy.
  *Run trace* invokes the same renderer as `/developer trace <id>` and
  replies ephemerally (staff-gated). All three reuse the existing trace
  cache.

### Changed

- **`/help` drift closed** (`src/commands/help/registry.ts`): 12 commands
  that were registered but missing from `/help` are now documented
  (`welcomebatch`, `verify`, `admin-migrate-unverified`, `cleanup`,
  `restoreroles`, `postticketpanel`, `closeticket`, `assignticket`,
  `review-set-notify-config`, `review-get-notify-config`,
  `review-set-listopen-output`, `qotd`). Six phantom standalone analytics
  entries (`activity`, `approval-rate`, `modstats`, `modhistory`,
  `analytics`, `analytics-export`) folded into one `/stats` parent with
  subcommands, mirroring how `/gate` and `/config` are modeled.
- **Docs sweep** (`docs/`): `BOT-HANDBOOK.md`, `PERMS-MATRIX.md`,
  `ADMIN-GUIDE.md`, `LEADERSHIP-GUIDE.md` now cover every shipped command.
  New `docs/TICKET-SYSTEM-GUIDE.md`. `docs/reference/slash-commands.md`
  converted to a short pointer so we don't sign up to keep two indexes in
  sync.

### Fixed

- **`deploy:cmds` on EC2**: Switched the npm script from
  `npx dotenvx run -- tsx ...` to `npx -y tsx ...`. The unscoped `dotenvx`
  package is now 404 on npmjs (renamed to `@dotenvx/dotenvx`), and EC2's
  `npm ci --omit=dev` strips local `tsx`. `npx -y tsx` fetches the binary
  on demand and runs `deploy-commands.ts` which already imports
  `dotenv/config` itself, so the wrapper was redundant.

### GitHub Discord Badge System (2026-05-02)

GitHub Markdown cannot render Discord mention syntax. Added a self-hosted SVG badge system that renders Discord roles, channels, and users as Discord-style pills using the real names and role colors. Plan: `docs/roadmap/github-discord-badges-plan-2026-05-02.md`.

#### Added

- **Badge feature module** (`src/features/badges/`): `types.ts`, `registry.ts`, `color.ts`, `svgEscape.ts`, `renderSvg.ts`, `store.ts`, `resolve.ts`, `liveUpdates.ts`, `index.ts`. Stable kebab-style badge ids; XML-safe escaping; contrast-aware color helpers; pill renderer with stale + suffix variants; manifest IO with traversal-safe paths.
- **Public HTTP endpoint** (`src/web/badgeEndpoint.ts`): default port 3004. Routes `/badges/<id>.svg`, `/api/badges/manifest.json`, `/api/badges/health`. Direct Discord ID routes are gated behind `BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES=true` (off by default). ETag-based 304 handling.
- **Daily refresh scheduler** (`src/scheduler/badgeRefreshScheduler.ts`): refreshes every `BADGE_REFRESH_INTERVAL_HOURS` hours (default 24); initial refresh delayed 60s after bot ready; per-badge errors fall back to prior cache and mark stale.
- **Live event-driven updates** (`src/features/badges/liveUpdates.ts`): `roleUpdate`, `roleDelete`, `channelUpdate`, `channelDelete`, `userUpdate` listeners refresh just the affected badge within ~1.5s, debounced.
- **CLI helper** (`scripts/generate-badges.ts`): `--list`, `--id <id>`, `--dry-run` for offline regen.
- **Tests**: 60+ new tests covering escape, color, render, registry, store, resolve, endpoint, scheduler, live updates, and a docs guard test that fails on raw Discord mention regressions.
- **Docs**: `docs/reference/github-discord-badges.md`, `docs/reference/documentation-badge-style-guide.md`, `docs/operations/badge-refresh.md`, `docs/architecture/badge-system.md`. README has a Discord Badges section.

#### Changed

- `docs/MOD-QUICKREF.md`, `docs/BOT-HANDBOOK.md`, `docs/MOD-HANDBOOK.md` use generated badge image references instead of raw Discord mention syntax for the movie tier roles, Server Artist role, and `「✍️」writing` / `「🗣️」yapping-space` channels.
- `src/startup/web.ts` and `src/startup/schedulers.ts` mount the badge endpoint, scheduler, and live listeners.
- `.env.example` documents the new badge env vars.

### Reliability / Test / Orchestration Pass (2026-05-02)

Behavior-preserving hardening pass. No commands, customId formats, dashboard contracts, or features were changed. Plan: `docs/roadmap/pawtropolis-hardening-plan-2026-05-02.md`.

#### Added

- **Command registration drift guard**: `src/commands/runtimeManifest.ts` is the single source of truth for runtime command names; `src/index.ts` asserts at startup that the runtime command Collection matches. `tests/commands/registration.test.ts` (8 cases) ties `buildCommands.ts` to the manifest. Doc: `docs/reference/command-registration-invariants.md`.

- **Review kick transaction tests**: `tests/features/review/kick.test.ts` (12 cases) covering submitted/needs_info → kicked, terminal-state rejections, and audit row insertion. Tightened `reject.test.ts` to assert bound values (not just SQL shape) for the permanent rejection path.

- **Dashboard API authorization tests**: Pulled `TIER_ORDER`, `hasMinTier`, `missingStringFields`, `missingIntegerFields` out of `dashboardApi.ts` into a sibling `dashboardAuth.ts`. `tests/web/dashboardAuth.test.ts` (50 cases) covers the seven-tier hierarchy, fail-closed semantics for unknown tiers, body validation, and the `admin` requirement on permreject. Doc: `docs/reference/dashboard-api-security.md`.

- **Modmail routing observability tests**: Added 18 cases to `tests/features/modmail/routing.test.ts` covering image attachment selection, reply-mapping in both directions, `SAFE_ALLOWED_MENTIONS` application, transcript persistence, dashboard notification, forwarded-cache loop guard, and thread-fetch / DM-send failure paths.

- **Startup task wrapper + extracted modules**: `src/startup/runStartupTask.ts` standardizes the fail-soft try/catch shape; `src/startup/{schema,schedulers,web}.ts` host the corresponding ClientReady and gracefulShutdown sections. `tests/startup/runStartupTask.test.ts` (8 cases) verifies isolation. Doc: `docs/architecture/startup-lifecycle.md`.

- **DB schema utility extraction**: `src/db/columnUtil.ts` (extracted from `src/db/db.ts`) holds `addColumnIfMissing`, identifier validation, and definition sanitization. `tests/db/columnUtil.test.ts` (22 cases) and `tests/db/legacyGuard.test.ts` (7 cases) cover SQL identifier safety and the `__old` / `ALTER TABLE ... RENAME` guard regex. Doc: `docs/reference/database-schema-safety.md`.

- **Deployment hardening**: `deploy.sh` now supports env overrides for `REMOTE_USER` / `REMOTE_HOST` / `REMOTE_PATH` / `PM2_PROCESS_BOT` / `PM2_PROCESS_WEB`, SSH/SCP timeouts (`ConnectTimeout=15`, keepalive 30s × 3), an atomic remote deploy lock under `/tmp/pawtropolis-deploy.lock`, optional pre-deploy DB backup (`BACKUP_BEFORE_DEPLOY=1`), `--dry-run`, and a preflight summary. All existing flags (`--logs`, `--restart`, `--status`, `--fast`, `--web`, `--bot`, `--graceful`) keep working unchanged. Doc: `docs/operations/deployment-hardening.md`.

- **Observability and error cards reference**: `docs/reference/observability-and-error-cards.md` documents the structured-logging conventions, `withStep` / `withSql` usage, error card V1 vs V2, and `SAFE_ALLOWED_MENTIONS` policy.

- **CI policy doc**: `docs/operations/ci-policy.md` enumerates HARD vs SOFT gates with explicit promotion conditions for each soft gate.

#### Changed

- **CI typecheck is now a HARD gate**: Removed `continue-on-error: true` from the typecheck step in `.github/workflows/ci.yml` after fixing two real defects in `src/commands/cleanup.ts` (`requireMinRole` was being called with two args instead of three; channel-narrowing collapsed to `never` after the exhaustive type check). Lint, format, and tests remain SOFT with documented exit conditions.

- **Lazy module-level prepare for `src/features/tickets/counters.ts`**: `incrementStmt` is now lazy-prepared on first call rather than at module load, so the file imports cleanly on a fresh DB. The `service.ts` counterpart is tracked for the same treatment in the next pass; the test soft-gate in `docs/operations/ci-policy.md` documents the path forward.

#### Stats

- 6 new test files, 1 file with additions: `tests/commands/registration.test.ts`, `tests/features/review/kick.test.ts`, `tests/web/dashboardAuth.test.ts`, `tests/startup/runStartupTask.test.ts`, `tests/db/columnUtil.test.ts`, `tests/db/legacyGuard.test.ts`, `tests/features/modmail/routing.test.ts` (additions).
- ~125 new test cases.
- 3 new modules: `src/startup/{runStartupTask,schema,schedulers,web}.ts`, `src/commands/runtimeManifest.ts`, `src/db/columnUtil.ts`, `src/web/dashboardAuth.ts`.
- 7 new docs: registration invariants, dashboard API security, database schema safety, observability, startup lifecycle, deployment hardening, CI policy, plus the hardening plan in `docs/roadmap/`.

### Added

- **`/attendance` Command**: Public event attendance stats and leaderboards:
  - `/attendance user [user]`: View your own or another user's movie/game night stats
  - `/attendance leaderboard [type]`: View top event attendees with optional movie/game filter
  - Shows total qualified events, time spent, and recent event history
  - Leaderboard displays top 15 with user's own rank if not listed
  - Available to everyone: no permission requirements
  - See `src/commands/attendance.ts`

### Changed

- **`/event` Permission Update**: Now accessible to Event Host and Events Manager roles, in addition to Moderator+. Allows independent event hosts to manage movie/game nights without needing mod roles.

- **`/config set movie_threshold` → `/config set-advanced movie_threshold`**: Moved to fix Discord's 25-subcommand limit. The `/config set` group was at 26 subcommands which caused command registration to fail.

- **`/report` Command Enhancements**: Updated per manager feedback:
  - **Thread title is now the user ID**: Makes searching for existing reports easier
  - **Mod team ping**: Automatically pings `@Moderation Team` when a report is created
  - **Reuses existing threads**: If a user already has a report thread, new reports post there instead of creating a new thread
  - **Default channel fallback**: Now defaults to `#reports` if no report forum is configured via `/config set report_forum`
  - **New `actions` option**: Reporters can document what actions they took (e.g., "Deleted message", "Issued warning")

---

## [5.1.1] - 2026-01-27

### Fixed

- **Event Voice Channel Switch Tracking**: Previously, users who switched directly between voice channels (e.g., from another VC to Gaming Lounge) weren't tracked for event attendance. Now properly detects channel switches in addition to join/leave from no channel. See `src/index.ts` voiceStateUpdate handler.

- **Event Command Defer Timing**: `/event game start`, `/event game end`, `/event movie start`, `/event movie end` now call `deferReply()` immediately to prevent Discord's 3-second timeout. Previously, database checks ran before defer which could cause "The application did not respond" errors.

- **Interaction Deduplication**: Added protection against Discord sending duplicate interaction events (observed: 4 duplicates within 19ms for a single command). Tracks recent interaction IDs and skips duplicates to prevent race conditions and "Unknown interaction" errors.

### Improved

- **Review Card Debug Logging**: Added info-level logging for member fetch results in `ensureReviewMessage()` to help diagnose "left server" detection issues. Logs whether member was found and their display name.

---

## [5.1.0] - 2026-01-17

### Added

- **`/report` Command**: Ambassador content violation reporting system:
  - Ambassadors and staff can report rule violations with screenshot evidence
  - Creates forum thread in configurable report forum channel
  - Staff resolves reports via Resolve button with optional note
  - Thread automatically archived on resolution
  - Configure with `/config set report_forum channel:#content-reports`
  - See `src/commands/report.ts`, `src/features/report/`

- **Disk Space Monitor**: Scheduler that monitors server disk usage and alerts before outages:
  - Runs every 30 minutes (configurable via `DISK_SPACE_CHECK_INTERVAL_MINUTES`)
  - Warning alert at 80% usage, critical alert at 90%
  - Critical alerts ping bot_dev_role
  - Includes suggested cleanup commands in alert embed
  - 4-hour cooldown between repeated alerts (unless escalating from warning to critical)
  - See `src/scheduler/diskSpaceScheduler.ts`

- **`/usebyte` Command**: Self-service byte token redemption for XP multipliers:
  - Members with Byte Token roles can redeem them without opening support tickets
  - Supports 5 token rarities: Common (2x/12h), Rare (3x/24h), Epic (5x/48h), Legendary (5x/72h), Mythic (10x/168h)
  - Confirmation flow shows token info, multiplier details, and expiration time
  - Warning displayed when redemption would replace an active multiplier
  - Automatic expiration cleanup via scheduler (runs every 60 seconds)
  - Full audit trail logging with new action types
  - See `src/commands/usebyte.ts`, `src/features/byteTokenHandler.ts`, `src/scheduler/byteMultiplierScheduler.ts`
- **New Audit ActionTypes** for byte token system:
  - `byte_token_redeemed`: User redeemed a byte token
  - `byte_multiplier_applied`: Multiplier role granted to user
  - `byte_multiplier_expired`: Scheduler removed expired multiplier role
  - `byte_multiplier_replaced`: User upgraded to higher multiplier
- **Database Table** `active_byte_multipliers`: Tracks active XP multipliers with expiration times
- **Ambassador `/redeemreward` access**: Community Ambassadors can now use `/redeemreward` to assign art rewards, improving ticket response time

### Fixed

- **Trace ID consistency**: Permission denied embeds now use the request context trace ID instead of generating a new one. This ensures `/developer trace` can find the trace for any error. Fixed in:
  - `src/lib/permissionCard.ts`
  - `src/features/review/handlers/buttons.ts`
  - `src/features/review/handlers/modals.ts`
  - `src/features/modmail/threadOpen.ts`

- **Byte token stacking race condition**: Fixed issue where rapidly clicking multiple confirm buttons could stack multiplier roles. Now removes ALL multiplier roles before adding the new one, with post-add cleanup for concurrent requests.

---

## [5.0.0] - 2026-01-12

### Added

- **`/art cancel` Subcommand**: Staff-only command to cancel an art job without counting towards the artist's completed pieces:
  - Use case: Job reassignment, recipient left server, request withdrawn
  - Adds new "cancelled" status to job workflow (separate from "done")
  - Cancelled jobs don't appear in `/art jobs`, `/art all`, or leaderboards
  - Usage: `/art cancel id:<job_number> [reason:<text>]`

- **Security Audit Overhaul**: Major enhancement to `/audit security` with comprehensive permission analysis:
  - **Snapshot & Diff Tracking**: Each audit stores a snapshot for change detection between runs
  - **New Subcommands:**
    - `/audit trends [days]`: Show security issue trends over 7/30 days
    - `/audit diff`: Show permission changes since last audit with dangerous change highlights
  - **New Security Checks:**
    - Role hierarchy inversions (lower role with more perms than higher)
    - ManageRoles scope warnings (position vs assignable roles)
    - Channel sync validation (overrides category denials)
    - Webhook access to sensitive channels detection
    - Gate channel exposure detection
    - Unverified role dangerous permission detection
  - **New Documentation:**
    - `HIERARCHY.md`: Visual role hierarchy with permission analysis
    - `DIFF.md`: Permission changes since last audit (auto-generated)
  - **Enhanced Scheduler:**
    - Now posts diff alerts when dangerous permissions are added
    - Pings leadership for critical issues AND dangerous permission changes
    - Stores snapshots for trend tracking
  - **Database Tables:**
    - `security_audit_snapshots`: Complete audit state for diff tracking
    - `security_issue_history`: Issue counts over time for trends
    - `bot_permission_requirements`: Document expected bot permissions (future)
  - See `migrations/042_security_audit_snapshots.ts`, `src/features/securityDiff.ts`, `src/store/securitySnapshotStore.ts`

- **Automated Security Audit Scheduler**: New scheduler that runs `/audit security` automatically every 30 minutes:
  - Posts results to the logging channel (#bot-logs)
  - Pings Server Dev, Community Manager, and Senior Administrator roles for unacknowledged critical issues
  - Helps catch dangerous permission misconfigurations like INC-002 (Community Apps with Admin)
  - See `src/scheduler/securityAuditScheduler.ts`
- **`/skullmode` Command Registration**: The `/skullmode` command was missing from Discord command registration. Now properly registered in `buildCommands.ts` and `index.ts`.
- **`/developer trace` Command**: Staff can now look up verbose trace details from error card trace IDs:
  - Request overview (command, user, guild, outcome, duration)
  - Execution timeline with individual phase timings
  - Database queries with SQL and timing
  - User context (roles, permissions)
  - Full error details (kind, code, message, stack trace in dev)
  - Custom attributes and affected entities
  - Traces stored in-memory for 30 minutes (500 trace max)
- **`/developer stats` Command**: Shows trace cache statistics (size, TTL, memory estimate)
- **Slash Command System Documentation**: Comprehensive developer guide at `docs/SLASH-COMMANDS.md` covering:
  - Command file structure and required exports
  - Registration in `buildCommands.ts` and `index.ts`
  - Deployment process and runtime auto-sync
  - Interaction handlers (buttons, modals, autocomplete)
  - Helper patterns (withStep, withSql, permissions)
  - Troubleshooting guide and checklist for new commands
- **`metrics_reset` ActionType**: New audit trail action type for `/resetdata` command. Previously used `modmail_close` as a workaround.
- **New Audit ActionTypes**: Added 5 new action types for unified audit trail logging:
  - `flag_added`: User manually flagged as suspicious
  - `flag_removed`: User unflagged
  - `message_purge`: Bulk message deletion
  - `dm_sent`: Anonymous DM sent via `/send`
  - `user_unblocked`: Permanent rejection removed
- **Audit Trail Logging**: Added `logActionPretty` calls to `/flag`, `/purge`, `/send`, and `/unblock` commands for unified audit trail visibility.

### Security

- **Rate Limit on `/send`**: Added 60-second cooldown per user to prevent DM spam abuse via the anonymous message command.
- **Rate Limit on `/poke`**: Added 60-second cooldown per user to prevent notification spam.
- **Rate Limit on `/stats export`**: Added 5-minute cooldown per user to prevent expensive CSV generation abuse.
- **DM Permission Restrictions**: Added `.setDMPermission(false)` to prevent guild-only commands from being used in DMs:
  - `/roles`: Role automation configuration
  - `/flag`: User flagging system
  - `/art`: Artist job management
  - `/artistqueue`: Artist rotation queue management

### Fixed

- **`/resetdata` ActionType**: Changed from incorrect `"modmail_close"` to proper `"metrics_reset"` action type for accurate audit logging.

### Changed

- **Command Instrumentation Unification (Complete: 10 Phases)**: Standardized execution tracing across 50+ command handlers using `withStep()` and `withSql()` patterns:
  - **Config Handlers (11 files)**: setRoles, setChannels, setAdvanced, setFeatures, get, artist, movie, game, poke, isitreal, toggleapis
  - **Gate Commands (5 files)**: gateMain (10 subcommands), accept, reject, kick, unclaim
  - **Event Commands (3 files)**: event/index (router), event/movie (7 handlers), event/game (7 handlers)
  - **Complex Commands (9 files)**: send, purge, backfill, resetdata, panic, audit (5 subcommands), database, update (4 subcommands), help
  - **Remaining Commands (5 files)**: poke (verified), redeemreward (4 phases), review/setNotifyConfig (6 phases), review/getNotifyConfig (6 phases), review-set-listopen-output (4 phases)
  - All commands now have consistent phase tracking for debugging via `/developer trace`
  - Database operations are properly instrumented for query timing in error cards
  - Updated `withStep()` to accept all interaction types (ChatInput, Modal, Button)
- **Structured Logging `evt` Fields**: Added `evt` (event type) field to all logger calls in commands for consistent log aggregation and filtering:
  - `/unblock`: 8 event types: `unblock_success`, `unblock_error`, `unblock_dm_sent`, `unblock_dm_failed`, etc.
  - `/search`: 3 event types: `search_executed`, `search_unauthorized`, `search_error`
  - `/stats user`: Added `stats_user_view` event
  - `/stats export`: Added `stats_export` event
- **Deployment Script Robustness**: Improved `deploy.sh` reliability:
  - Added `set -euo pipefail` for stricter error handling
  - Added post-deploy health check (waits 3s, verifies PM2 process status)
  - Added remote tarball cleanup step
  - Updated step count from 7 to 9 steps

### Deprecated

- **`/movie` Command**: This command is deprecated in favor of `/event movie`. All subcommands (start, end, attendance, add, credit, bump, resume) show a deprecation notice in the response footer. Target removal: **v6.0.0**. Migration path: Use the equivalent `/event movie *` subcommands which are part of the unified event tracking system.

### Removed

- **Dead Code Cleanup**: Removed 9 unused exports and 2 unused imports:
  - `invalidateDraftsCache` from listopen.ts
  - `clearMetricsEpoch` from metricsEpoch.ts
  - `APPLICANT_ACTIONS`, `getModeratorMetrics`, `getTopModerators` from modPerformance.ts
  - `getConfiguredGuilds` from notifyConfig.ts
  - `getAssignmentHistory`, `getRecentAssignments` from roleAutomation.ts
  - `OAUTH_RATE_LIMIT_MAX_REQUESTS` from constants.ts
  - Unused `ensureDeferred` imports from movie.ts and unblock.ts

---

## [4.9.2] - 2026-01-07

### Fixed

- **`/audit acknowledge` & `/audit unacknowledge` Timeout**: Fixed "The application did not respond" error that occurred when these commands took too long. Interaction is now deferred immediately before permission checks.
- **`/audit security` Git Sync**: Fixed push failures when the server's git repo was out of sync with remote. The command now auto-syncs (fetch, stash, pull --rebase, pop) before pushing.

### Changed

- **`/audit security` Verbose Progress**: Now shows real-time progress updates instead of "is thinking":
  - Fetching server roles
  - Analyzing permissions
  - Git operations (sync, commit, push)
  - Final summary with issue breakdown

---

## [4.9.1] - 2026-01-07

### Changed

- **`/unclaim` Admin Override**: Administrators+ can now unclaim applications claimed by other staff members. Previously, only the person who claimed an application could unclaim it. This allows admins to resolve stalemates when a staff member is unavailable.

---

## [4.9.0] - 2026-01-04

### Added

- **GitHub Actions CI/CD** - Automated quality checks on every push/PR:
  - Typecheck, lint, format check, and test jobs
  - Coverage reports uploaded as artifacts
  - Build verification for production readiness
- **Dynamic README Badges** - Auto-updating badges via GitHub Gist:
  - Commands count, lines of code, test count, coverage percentage, version
  - Updated automatically on push to main (every 6 hours fallback)
  - Scripts in `scripts/generate-badge-metrics.js`
- **Status Endpoint** - Bot now serves `/api/status` and `/api/health` endpoints:
  - Shields.io-compatible JSON format for status badges
  - Shows online/offline status, uptime, WebSocket latency
  - Runs on port 3002 (configurable via `STATUS_PORT` env var)
- **Auto-Commit Assets** - `/update banner` and `/update avatar` now auto-push to GitHub:
  - Assets saved to `assets/` folder and committed automatically
  - Requires `GITHUB_BOT_TOKEN`, `GITHUB_BOT_USERNAME`, `GITHUB_BOT_EMAIL`, `GITHUB_REPO` env vars
  - Reply includes link to GitHub commit on success
- **Professional README** - Redesigned with centered banner, avatar, and badge rows

- **Security Issue Acknowledgments** - Staff can now acknowledge security warnings that are intentional:
  - `/audit acknowledge <issue-id> [reason]` - Mark a security warning as intentional (e.g., Chat Reviver needs MentionEveryone)
  - `/audit unacknowledge <issue-id>` - Remove acknowledgment if you change your mind
  - Acknowledged issues appear in a separate "Acknowledged Issues" section in CONFLICTS.md
  - Acknowledgments auto-reset when underlying permissions change (forcing re-review)
  - Shows who acknowledged each issue and when, with optional reason
- **Server Audit Documentation** - Comprehensive internal documentation of server structure:
  - `docs/internal-info/ROLES.md` - All 219 roles with positions, colors, member counts, and full permission matrix
  - `docs/internal-info/CHANNELS.md` - All 225 channels with categories, types, and permission overwrites
  - `docs/internal-info/CONFLICTS.md` - Security analysis identifying 7 issues (2 critical, 1 high, 4 medium)
  - `docs/internal-info/SERVER-INFO.md` - Server metadata, settings, and statistics
  - `/audit security` - Bot command to regenerate documentation, auto-commit, and push to GitHub with link
  - `scripts/audit-server-full.ts` - Re-runnable script to regenerate documentation
- **Unclaim Button** - Review cards have an "Unclaim" button that requires typing "UNCLAIM" to confirm. Only the person who claimed it can unclaim.
- **Incident Log** - Added `INCIDENTS.md` to track production incidents and resolutions
- **Game Night Tracking** - New `/event game` command for game night attendance tracking with percentage-based qualification:
  - `/event game start #channel` - Start tracking attendance in a voice channel
  - `/event game end` - End event and calculate qualification based on % of event duration attended
  - `/event game attendance` - View attendance stats (live during event, historical after)
  - `/event game add/credit/bump` - Manual attendance adjustments
  - `/config set game_threshold` - Configure qualification percentage (default: 50%)
  - `/config get game_config` - View game night configuration
- **Game Night Tier Roles** - Automatic tier role rewards for game night attendance:
  - `/roles add-game-tier` - Configure tier roles (e.g., 1 game = T1, 5 games = T2)
  - `/roles remove-game-tier` - Remove a game tier
  - `/roles list` - View configured game tiers
  - Automatically assigns roles when users qualify, removes lower tiers
  - DMs users with progress updates after each game night
- **Unified Event System** - `/event movie` now mirrors `/movie` (which is deprecated). Both movie and game nights use the same underlying tracking system.
- **Combined Event Stats** - Movie and game night attendance tracked in same database for unified statistics

### Security

- **Guild Allowlist** - Bot now only operates in Pawtropolis (guild ID `896070888594759740`). Automatically leaves any other server it's added to. See INC-001 in `INCIDENTS.md`.

### Fixed

- **Movie Night DM Role Display** - DMs now show the actual role name (e.g., "Movie Buff") instead of "@unknown-role" since role mentions don't render in DMs

### Changed

- **Repository Renamed** - Repo renamed from `pawtech-v2` to `pawtropolis-tech`. All URLs and references updated throughout codebase.
- **Documentation Unified Events** - All staff docs now reference both movie and game nights under unified "Events" section:
  - BOT-HANDBOOK: Combined Movie Night + Game Night into single Events section
  - MODERATOR-GUIDE, MOD-QUICKREF: Updated with both event types and commands
  - ADMIN-GUIDE: Added game tier role commands
- **Badge Files Reorganized** - Moved badge JSON files from root to `.github/badges/` for cleaner project structure
- **Modmail Open Message** - Now includes clearer instructions: explains that replies go to staff only, are confidential, and verification continues after modmail closes
- **Permission System Redesign** - Commands now use specific role names instead of generic "staff" permissions. Each command requires a minimum role level. Bot owners and server devs can bypass all restrictions. Error messages show which roles you need. See `PERMS-MATRIX.md` for details.
- **Analytics Command Consolidation** - Unified analytics commands under `/stats`:
  - `/activity` → `/stats activity`
  - `/approval-rate` → `/stats approval-rate`
  - `/modstats leaderboard` → `/stats leaderboard`
  - `/modstats user` → `/stats user`
  - `/modstats export` → `/stats export`
  - `/modstats reset` → `/stats reset`
  - `/modhistory` → `/stats history`

### Removed

- **`/activity`** - Replaced by `/stats activity`
- **`/approval-rate`** - Replaced by `/stats approval-rate`
- **`/modstats`** - Replaced by `/stats`
- **`/modhistory`** - Replaced by `/stats history`
- **`/analytics`** and **`/analytics-export`** - Replaced by `/stats activity`

### Deprecated

- **`/movie` command** - Use `/event movie` instead. The `/movie` command still works but will be removed in a future version.

### Security

- Added cooldowns to prevent spam and abuse:
  - Avatar NSFW scans: 1 hour per user
  - `/search`: 30 seconds per user, 50ms delay between API calls
  - `/backfill`: 30 minutes per server
  - `/purge`: 5 minutes per user
  - `/flag`: 15 seconds (increased from 2)
  - `/artistqueue sync`: 5 minutes per server
- Added 30-second lockout after wrong passwords on `/resetdata` and `/purge`
- Hide sensitive data in error messages and logs
- Added input validation to prevent malicious code injection
- Limited modmail memory to 10,000 entries to prevent crashes
- Limited flagged user queries to 10,000 entries

---

## [4.8.0] - 2025-12-08

### Added

- **Better Permission Errors** - Permission denied messages now show which roles you need to use a command
- **"Is It Real?" Context Menu** - Right-click any message → Apps → "Is It Real?" to check if images are AI-generated
- **Skull Mode** - Random skull emoji reactions. Use `/skullmode chance:N` to set odds, `/config set skullmode` to toggle on/off

### Removed

- Removed right-click context menu for opening modmail threads

### Fixed

- **Welcome Card Retry Logic** - Welcome cards now retry up to 3 times when network errors occur
- **Bot Dev Ping** - Fixed bug where bot devs weren't getting pinged on new applications even when enabled

### Changed

- `/update status` without text now clears the status instead of showing an error
- **AI Detection API Switch** - Switched from Illuminarty to RapidAPI. Update your `.env` file with `RAPIDAPI_KEY`

---

## [4.7.1] - 2025-12-03

### Fixed

- Fixed autocomplete and select menus not working in `/help` command

### Changed

- Only the person who ran `/help` can use its buttons and menus
- Removed all emojis from help system for a cleaner look

---

## [4.7.0] - 2025-12-03

### Added

- **Interactive Help System** - New `/help` command with search, categories, autocomplete, and navigation. Only shows commands you have permission to use.

- **Movie Night Improvements**:
  - Users already in voice chat get credit when `/movie start` runs
  - Sessions save every 5 minutes and recover after bot restarts
  - New commands: `/movie add`, `/movie credit`, `/movie bump` for manual attendance adjustments
  - Use `/movie resume` to check recovered session status

- **AI Detection Setup Wizard** - New `/config isitreal` command to set up API keys with a visual dashboard. Test keys before saving. No restart needed.

---

## [4.6.0] - 2025-12-03

### Added

- **AI Detection Command** - New `/isitreal` command checks if images are AI-generated using Hive, SightEngine, and Optic APIs. Shows average score and breakdown per service. Staff-only.

### Documentation

- Added cross-links between all handbooks
- Fixed outdated references and dates

### Removed

- Removed ~1,400 lines of unused code and 14 old migration files
- Fixed duplicate migration numbers
- Cleaned up 10 empty folders

---

## [4.5.0] - 2025-12-02

### Database

- Improved database query speed by caching prepared statements across 10 files
- Added transaction wrapping to ensure atomic operations
- Added validation helpers for Discord IDs and empty values

### Security

- Prevented SQL injection attacks with input validation
- Moved API keys out of URLs to prevent log exposure
- Added permission checks for dangerous `/database recover` command
- Added rate limiting to expensive commands
- Prevented path manipulation attacks in file handling
- Limited reason text to 512 characters to prevent bloat

### Refactored

- Cleaned up file structure by merging scattered utilities
- Fixed naming conflicts between types
- Updated import paths across 15 files

### Changed

- Better error handling with debug logging instead of silent failures
- Notify users when critical operations fail

### Performance

- **Much faster queries**: Fixed slow database patterns that were making too many requests
- **Faster NSFW audits**: Changed from one-at-a-time to batch processing (100+ seconds → ~15 seconds for 1000 members)
- **New database indexes**: Added 5 indexes to speed up common searches
- **Memory protection**: Added limits to prevent crashes during high traffic

### Cleanup

- Removed unused code and functions
- Dropped empty database tables
- Cleaned up unused test files

---

## [4.4.4] - 2025-12-03

### Changed

- Split large files into smaller, easier-to-maintain modules:
  - Modmail threads code split into 5 files
  - Modstats split into 5 files
  - Gate commands split into 7 files
  - Config commands split into 11 files

---

## [4.4.3] - 2025-12-03

### Changed

- Split review handlers into 6 smaller files
- Extracted modmail thread state code

---

## [4.4.2] - 2025-12-03

### Changed

- Removed website references (website no longer exists)

---

## [4.4.1] - 2025-12-03

### Added

- Added AI detection tool links to moderator handbook

---

## [4.4.0] - 2025-12-03

### Added

- **Auto NSFW Avatar Scan** - Bot now scans avatars automatically when users change them. Alerts go to logging channel.
- **Resume NSFW Audits** - Can now resume interrupted audits. Progress saves to database.
- `/health` command now shows active event listeners

### Changed

- NSFW audit progress updates more frequently with better feedback

---

## [4.3.0] - 2025-12-02

### Added

- **New `/audit nsfw` command** - Scan avatars for NSFW content using Google Vision API. Can scan all members or only flagged users.

### Changed

- Split `/audit` into `/audit members` and `/audit nsfw` subcommands

### Removed

- Removed unused suggestions feature (~1,700 lines of code)

---

## [4.2.0] - 2025-12-01

### Changed

- Added many new configuration options to `/config` command

---

## [4.1.0] - 2025-12-01

### Changed

- More configuration options and improvements

---

## [4.0.3] - 2025-12-01

### Changed

- Minor handbook fixes

---

## [4.0.2] - 2025-12-01

### Changed

- Expanded documentation

---

## [4.0.1] - 2025-12-01

### Changed

- Minor documentation updates

---

## [4.0.0] - 2025-12-01

### Added

- **Art Jobs System** - New `/art` command to track commissions and requests. Fully integrated with search.

---

## Earlier Versions

### [3.1.2] - 2025-11-30
- Added moderator handbook
- Removed cage command

### [3.1.1] - 2025-11-30
- Cleaned up 89 roadmap files

### [3.1.0] - 2025-11-30
- Fixed memory leaks with LRU cache
- Added scheduler health monitoring
- Fixed 40+ bugs from codebase audit

### [3.0.0] - 2025-11-30
- Full codebase audit (48 issues found and fixed)
- Fixed SQL injection bug
- Fixed memory leaks
- Security improvements

### [2.3.1 - 2.3.11] - 2025-11-29
- Created BOT-HANDBOOK and MOD-QUICKREF documentation

### [2.3.0] - 2025-11-29
- **Artist Rotation System** - Queue management for rotating artist role

### [2.2.0] - 2025-11-28
- Added `/search` command
- Added suggestions system (later removed)
- Added approval rate analytics
- Added stale application checker

### [2.1.0] - 2025-11-27
- Cleaned up project structure

### [2.0.0 - 2.0.4] - 2025-11-26
- **Major error handling overhaul**
- Added comprehensive error system
- Security hardening
- Bug fixes

### [1.1.0 - 1.1.5] - 2025-11-25
- Added role automation system
- Added `/movie` command for movie night voting
- Added `/panic` emergency lockdown
- Added documentation

### [1.0.0] - 2025-11-25
- **Initial release**
- Gate system for application review
- Modmail system
- Review system with claim tracking
- Mod tools (`/flag`, `/modstats`, `/purge`, etc.)
- Analytics and activity tracking
- Full configuration system

