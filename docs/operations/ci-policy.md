# CI policy

This doc explains what CI enforces, what it tolerates, and the conditions for promoting each soft gate to a hard gate.

## Gate hierarchy

| Gate | Status | Job | Step |
|------|--------|-----|------|
| Typecheck | HARD | check | `npm run typecheck` |
| Lint | SOFT | check | `npm run lint` |
| Format | SOFT | check | `npm run format:check` |
| Tests | HARD | test | `npm run test -- --coverage` |
| Build | HARD | build | `npm run build` (depends on check + test passing or soft-skipped) |

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

### Build

Has always been hard. Build = `tsup` plus `scripts/scan-legacy.ts`. Unaffected by the lint/format soft gates.

## Soft gates today

### Lint

`npm run lint` reports roughly 2000 errors and 1500 warnings across the repo. The vast majority live in `web/` (Svelte runes like `$state` not configured in eslint, browser globals like `document`/`URLSearchParams`/`fetch`/`EventSource`) and `workers/discord-proxy/` (Cloudflare Workers globals like `Response`/`btoa`).

Almost none are real defects in `src/`. The few that are (unused imports, empty blocks) are non-load-bearing.

**Promotion conditions:**

1. eslint config in `web/` declares Svelte runes and browser globals so those warnings disappear.
2. eslint config in `workers/` declares Cloudflare Workers globals.
3. Real defects in `src/` are either fixed or autoflagged with `// eslint-disable-next-line` plus a comment.

When all three are done, drop `continue-on-error: true` from the Lint step.

### Format

`npm run format:check` reports about 1000 file drifts, almost all in `web/`. Running `npm run format` would fix every one in a single commit, but doing so without coordination breaks open PRs.

**Promotion conditions:**

1. Open `web/` PRs are merged or rebased.
2. Run `npm run format` against the whole repo and commit the result.
3. Drop `continue-on-error: true` from the Format Check step.

## What CI does not check

- Bot production deploy (handled by `deploy.sh`, run manually). The **web dashboard is
  not manual**: `.github/workflows/deploy-handbook.yml` ships `web/` to EC2 and restarts
  `pawtropolis-web` on every push to `main` touching `docs/**` or `web/**`.
- Vulnerability scanning (no Dependabot or `npm audit` step today).
- Migration dry-run (`npm run migrate:dry`): could be added cheaply.

## Coverage thresholds are a hard gate

`vitest.config.ts` sets `lines: 20, functions: 40, branches: 35, statements: 20`. The test
job runs `npm run test -- --coverage` with no `continue-on-error`, and vitest exits non-zero
when a threshold is unmet, so an unmet threshold fails CI.

These numbers sit well below actual coverage (lines and statements are around 43%), so today
they catch only a severe regression rather than a small one. Re-baselining them belongs on a
fresh coverage run.

## Why we keep soft gates

Removing CI's tolerance for failures the moment they appear forces every contributor to fix the backlog before they can merge their feature. That backlog can be huge: the lint backlog here is 3500 items. It would freeze the project. Soft gates with documented promotion conditions strike the balance: real regressions get caught (typecheck, build), legacy backlog stays visible (the warning lights still glow yellow), and contributors can still ship.

The promotion conditions above keep the team honest: each soft gate has a measurable exit condition, and the doc must be updated when one is met.
