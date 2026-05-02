# CI policy

This doc explains what CI enforces, what it tolerates, and the conditions for promoting each soft gate to a hard gate.

## Gate hierarchy

| Gate | Status | Job | Step |
|------|--------|-----|------|
| Typecheck | HARD | check | `npm run typecheck` |
| Lint | SOFT | check | `npm run lint` |
| Format | SOFT | check | `npm run format:check` |
| Tests | SOFT | test | `npm run test -- --coverage` |
| Build | HARD | build | `npm run build` (depends on check + test passing or soft-skipped) |

A HARD gate fails the workflow if it errors. A SOFT gate uses `continue-on-error: true` and emits a warning that does not fail the workflow. CI promotes a soft gate to hard once the underlying backlog is gone.

## Hard gates today

### Typecheck (promoted 2026-05-02)

Was soft until the May 2026 hardening pass. Promoted after fixing two errors in `src/commands/cleanup.ts`:

- `requireMinRole` was being called with two args instead of three; the third (`PermissionDenialOptions`) was missing.
- `("name" in channel ? channel.name : channel.id) ?? channel.id` narrowed the channel to `never` after the exhaustive type check above. Fixed via a structural cast that lets us read either field without losing TS narrowing.

Both were real bugs that the soft gate had been hiding.

### Build

Has always been hard. Build = `tsup` plus `scripts/scan-legacy.ts`. Unaffected by the lint/format/test soft gates.

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

### Tests

Two pre-existing suite failures, both unrelated to the May 2026 hardening pass:

1. `tests/features/artistRotation/handlers.test.ts`: historically failed at import time because `src/features/tickets/counters.ts` and `src/features/tickets/service.ts` prepare statements at module load against tables (`ticket_counter`, `ticket`) that may not exist on a fresh DB. Phase 7 made `counters.ts` lazy-prepare; `service.ts` still eager-prepares. The deeper fix: running migrations as part of test setup, or making every module-level prepare lazy: is tracked in TODO.md.
2. `tests/lib/roles.test.ts`: assertion expects role name `"Server Owner"`, but the role was renamed to `"Community Founder"` in `src/lib/roles.ts:77`. The test predates the rename. Fix is a one-liner; it has not landed because the test was being hidden by the soft gate.

**Promotion conditions:**

1. Apply the test-setup fix that lets `tests/features/artistRotation/handlers.test.ts` run on a clean DB (either inject migrations into the test setup, or finish making module-level prepares lazy).
2. Update `tests/lib/roles.test.ts` to expect the current role names.
3. Re-run `npm test` and confirm zero suite failures.
4. Drop `continue-on-error: true` from the Tests step.

## What CI does not check

- Real production deploy (handled by `deploy.sh`, run manually).
- Vulnerability scanning (no Dependabot or `npm audit` step today).
- Migration dry-run (`npm run migrate:dry`): could be added cheaply.
- Coverage thresholds beyond the artifact upload (Vitest config has thresholds at lines:50, functions:45, branches:40, statements:50 but these are not enforced as a CI failure).

## Why we keep soft gates

Removing CI's tolerance for failures the moment they appear forces every contributor to fix the backlog before they can merge their feature. That backlog can be huge: the lint backlog here is 3500 items. It would freeze the project. Soft gates with documented promotion conditions strike the balance: real regressions get caught (typecheck, build), legacy backlog stays visible (the warning lights still glow yellow), and contributors can still ship.

The promotion conditions above keep the team honest: each soft gate has a measurable exit condition, and the doc must be updated when one is met.
