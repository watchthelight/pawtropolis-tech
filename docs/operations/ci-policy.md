# CI policy

This doc explains what CI enforces, what it tolerates, and the conditions for promoting each soft gate to a hard gate.

## Gate hierarchy

| Gate | Status | Job | Step |
|------|--------|-----|------|
| Typecheck | HARD | check | `npm run typecheck` |
| Lint | HARD | check | `npm run lint` (0 errors; warnings allowed) |
| Format | SOFT | check | `npm run format:check` |
| Dead code | HARD | check | `npm run knip` |
| Tests | HARD | test | `npm run test -- --coverage` (Node 24 and Node 20 legs) |
| Coverage thresholds | HARD | test | enforced by vitest, see below |
| Dashboard | HARD | web | `npm run check` (svelte-check) and `npm run build` in `web/` |
| Build | HARD | build | `npm run build` (depends on check + test) |

A HARD gate fails the workflow if it errors. A SOFT gate uses `continue-on-error: true` and emits a warning that does not fail the workflow. CI promotes a soft gate to hard once the underlying backlog is gone.

## Hard gates today

### Typecheck (promoted 2026-05-02)

Was soft until the May 2026 hardening pass. Promoted after fixing two errors in `src/commands/cleanup.ts`:

- `requireMinRole` was being called with two args instead of three; the third (`PermissionDenialOptions`) was missing.
- `("name" in channel ? channel.name : channel.id) ?? channel.id` narrowed the channel to `never` after the exhaustive type check above. Fixed via a structural cast that lets us read either field without losing TS narrowing.

Both were real bugs that the soft gate had been hiding.

### Tests (promoted 2026-05-04)

Was soft until both pre-existing failures were resolved:

- `tests/features/artistRotation/handlers.test.ts`: `src/features/tickets/service.ts` was eager-preparing seven statements against tables created by migration 067. Converted to the lazy-prepare pattern already used in `counters.ts`. The handler test additionally mocks `TicketService` so the legacy data DB schema does not interfere.
- `tests/lib/roles.test.ts`: assertion now matches the current role name `"Community Founder"`.
- `tests/scheduler/badgeRefreshScheduler.test.ts`: real SVG rendering across ~80 badges legitimately exceeds the 5s default; bumped to 20s.

### Lint (promoted with #00283)

Was soft while the backlog stood at 1274 errors. The ESLint config now turns `no-undef` off for TypeScript (tsc covers it), turns `no-explicit-any` off for `tests/**` and `migrations/**` and to a warning for `scripts/**`, and ignores generated and scratch directories. The remaining errors in `src/`, `web/` and `scripts/` were fixed. `src/**` keeps `no-explicit-any` as an error. Warnings (unused vars, unused disable directives, `any` in scripts) are allowed and do not fail CI.

### Dead code (knip, promoted with #00283)

Was soft from #00271. `npm run knip` now exits 0: the unused barrel, the unused test helper, the unused exports and the stale config hints are gone. A new unused file, export or type fails the check job.

### Dashboard (added with #00283)

The `web` job installs `web/`, runs `svelte-kit sync`, `npm run check` (svelte-check) and `npm run build`. svelte-check reported 0 errors and 86 warnings when added; warnings do not fail it.

### Build

Has always been hard. Build = `tsup` plus `scripts/scan-legacy.ts`. Unaffected by the lint/format soft gates.

## Soft gates today

### Format

`npm run format:check` reports about 840 file drifts, almost all in `web/`. One mechanical `npm run format` commit over the whole repo fixes them; it is done separately so it does not collide with open work.

**Promotion conditions:**

1. Run `npm run format` against the whole repo and commit the result.
2. Drop `continue-on-error: true` from the Format Check step.

## What CI does not check

- Bot production deploy (handled by `deploy.sh`, run manually). The **web dashboard is
  not manual**: `.github/workflows/deploy-handbook.yml` ships `web/` to EC2 and restarts
  `pawtropolis-web` on every push to `main` touching `docs/**` or `web/**`.
- Vulnerability scanning (no Dependabot or `npm audit` step today).
- Migration dry-run (`npm run migrate:dry`): could be added cheaply.

## Coverage thresholds are a hard gate

`vitest.config.ts` sets `coverage.include: ["src/**/*.ts"]`, so files no test imports count
as uncovered instead of being invisible. Thresholds are `lines: 43, functions: 48,
branches: 37, statements: 43`. The v26 suite measures 44.11, 49.64, 38.99 and 44.05; each
threshold is one point under, rounded down, because v8 counts differ slightly between Node
versions and CI runs two. The test job runs `npm run test -- --coverage` with no
`continue-on-error`, and vitest exits non-zero when a threshold is unmet.

Raise the numbers as coverage improves; do not lower them to make a run pass.

## Node versions

CI runs on Node 24. The test job has a second leg on Node 20 (end of life) because the
production host's Node version is unconfirmed. Drop that leg once the host is confirmed on
Node 22 or newer.

## Why we keep soft gates

Removing CI's tolerance for failures the moment they appear forces every contributor to fix the backlog before they can merge their feature. Soft gates with documented promotion conditions strike the balance: real regressions get caught (typecheck, lint, knip, tests, build), a remaining backlog (format) stays visible, and contributors can still ship. Only format is soft today.

The promotion conditions above keep the team honest: each soft gate has a measurable exit condition, and the doc must be updated when one is met.
