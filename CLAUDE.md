# Pawtropolis Tech: Conventions for Claude Code

Single-developer Discord bot + SvelteKit web dashboard. This file documents the conventions that should be followed when assisting on this repo.

## Identity + commits

- Author: `watchthelight <admin@watchthelight.org>`. Always commit as this identity.
- No `Co-Authored-By: Claude` lines on commits.
- Conventional Commits: `feat(scope):`, `fix(scope):`, `chore:`, `test:`, `docs:`, `refactor:`, `audit:`. Also in use: `perf(scope):`, `style:`, `ci:`.
- Tiny, purposeful commits. One thing per commit.
- Reference todo IDs in commit messages with bare ID: `feat(welcome): handle empty template (#00042)`. This enables `/issue-update` to detect activity.

## Issue / task system

File-first; GitHub Issues are a mirror.

- Open todos: `todo/NNNNN.md`. Done todos: `done/NNNNN.md`. IDs are sequential, never reused.
- Index of open todos: `_BACKLOG.md`. Index of done: `_DONE.md`.
- Full spec, label vocabulary, skill list: [docs/issue-system.md](./docs/issue-system.md).
- Skills available: `/issue`, `/sync-tasks`, `/issue-update`, `/whatdoido`, `/goodnight`, `/sprint-plan`, `/sprint-status`, `/retro`, `/code-review`.
- Format rules (hard-enforced by sync engine):
  - No em-dash (U+2014) or en-dash (U+2013) anywhere.
  - No curly quotes.
  - Title line: `# #NNNNN -- <Title>` exactly.
  - Meta line: `**Type:** <type> | **Priority:** <Priority>[ | **Status:** \`<tag>\`]`.

## Build + run

- Node 20.9.0 or newer (`engines` in `package.json`; sharp 0.35 needs it). CI runs Node 24, with a second test leg on Node 20.
- Install: `npm ci` in the root, and `npm ci` in `web/` (its own package and lockfile).
- Bot: `npm run dev` (tsx watch), `npm run build` (tsup, then `scripts/scan-legacy.ts`), `npm start`.
- The build writes two ESM bundles: `src/index.ts` to `dist/index.js` and `scripts/commands.ts` to `dist/scripts/commands.js`.
- Dashboard, inside `web/`: `npm run dev`, `npm run check` (svelte-check), `npm run build`.

## Quality gates

What CI enforces is in [docs/operations/ci-policy.md](./docs/operations/ci-policy.md). Update that doc when a gate changes.

| Gate                    | Command                                            | CI   |
| ----------------------- | -------------------------------------------------- | ---- |
| Typecheck               | `npm run typecheck`                                | HARD |
| Lint                    | `npm run lint` (0 errors; warnings allowed)        | HARD |
| Dead code               | `npm run knip`                                     | HARD |
| Tests + coverage floors | `npm run test -- --coverage`                       | HARD |
| Build                   | `npm run build`, then `node --check dist/index.js` | HARD |
| Dashboard               | in `web/`: `npm run check`, `npm run build`        | HARD |
| Format                  | `npm run format:check`                             | SOFT |

- Format is soft because about 800 files that predate v26 fail the check. A new file has to pass `npx prettier --check <file>`, and so does a file that passed before the edit. An older file that already fails is edited as it is: do not format it in the same commit, and do not run `npm run format` over the whole repo as part of other work. That commit is planned on its own (todo #00286).
- prettier wants LF line endings. A file checked out with CRLF on Windows fails the check on that alone, so a local count can be higher than the one in `docs/operations/ci-policy.md`.
- `npm run check` chains typecheck, lint, format check and tests, so it stops at the format check until that commit lands. Run the gates one by one.
- knip and the full test suite both need the dashboard prepared: `npm ci` and `npx svelte-kit sync` in `web/`. In a fresh clone without them knip stops with `Error loading web/vite.config.ts`.
- `tsconfig.json` covers `src/` and `scripts/` only. Tests are type-checked by nobody; vitest strips types.
- Coverage counts every file in `src/`. The floors are in `vitest.config.ts`, one point under the measured values. Raise them when coverage rises.

## Code style + structure

- TypeScript strict mode, ESM, `NodeNext` resolution: relative imports end in `.js`.
- A new source file carries `// SPDX-License-Identifier: LicenseRef-ANW-1.0` and a WHAT/WHY header block, like the existing ones.
- `no-explicit-any` is an error in `src/`, a warning in `scripts/` and off in tests and migrations.
- Prefer editing existing files; avoid new files unless needed.
- No defensive over-engineering. Trust framework guarantees.
- No em-dashes in user-facing prose. Use colons or restructure.
- Default to writing no comments. Add one only when the WHY is non-obvious.

## Architecture

- `src/index.ts`: creates the client, wires every command into the `commands` map with `wrapCommand`, registers the event handlers and hands the rest to `src/startup/`.
- `src/startup/`: `ready.ts` runs the boot steps, `schedulers.ts` starts and stops the background jobs, `web.ts` starts the internal dashboard API.
- `src/commands/`: one file or folder per slash command, each exporting `data` and `execute`. `buildCommands.ts` collects the payloads sent to Discord. `runtimeManifest.ts` is the string list of command names that tests and startup check against.
- `src/features/`: the logic behind the commands and events (gate and review, modmail, tickets, artist rotation, stats, bot detection and so on).
- `src/features/artistInvestigation/`: everything behind `/investigate-artist`. `criteria.ts` holds the handbook's verification criteria, `collect.ts` and `ticketContext.ts` read the ticket, `images.ts` fetches and downsizes images, `provenance/` holds the lookup services and their cache, `analysis.ts` calls the Claude API, `budget.ts` keeps the cost ledger and the monthly cap, `render.ts` builds the ephemeral report, `run.ts` ties them together.
- `src/events/`, `src/listeners/`: gateway event handlers. `events/interactionCreate.ts` routes slash commands, buttons and modals. `src/scheduler/`: the background jobs.
- `src/db/`: better-sqlite3 in WAL mode. `src/db/db.ts` opens `DB_PATH` when it is imported. `src/store/`: small persistence helpers.
- `src/web/`: the bot's HTTP side. `dashboardApi.ts` is the Fastify API the dashboard calls; it binds to `127.0.0.1` by default (`DASHBOARD_API_HOST`) and checks a shared secret. The linked-roles, badge and status endpoints live here too.
- `src/lib/`: shared helpers. Environment parsing is in `src/lib/env.ts`.
- `web/`: the SvelteKit dashboard. It reads SQLite directly and calls the bot API through `web/src/lib/server/botApi.ts` when it needs the Discord client.
- `migrations/`: numbered TypeScript migrations. `scripts/`: operational scripts. `docs/`: handbooks, references, operations docs and release notes.

## Tests

- Unit + integration tests via Vitest. Coverage via @vitest/coverage-v8.
- Tests are a HARD gate in CI, coverage floors included.
- `tests/setup.ts` gives every worker its own SQLite file under `tests/.tmp/`, seeded from `tests/fixtures/schema.sql`. Tests never touch `data/data.db`.
- Dashboard tests live under `tests/web/` and import from `web/src`, so `web/` must be installed and `npx svelte-kit sync` run there before the full suite.
- `tests/docs/` holds parity tests: the handbook, command reference, permission matrix, env examples, dashboard config editor and the artist verification criteria are checked against the code. A new env variable has to be in `.env.example` (or `web/.env.example`). Markdown files must not contain raw Discord mentions such as `<@&id>`.
- Mock every external service. Nothing in the suite talks to Discord, the Claude API or a lookup service.
- `.claude/worktrees/` is skipped by vitest, eslint and prettier: each worktree is a full copy of the repo.

## Adding a slash command

Tests fail until all of these are done:

1. `src/commands/<name>.ts` exporting `data` and `execute`.
2. Its payload in `src/commands/buildCommands.ts` and its name in `src/commands/runtimeManifest.ts`.
3. `commands.set(...)` with `wrapCommand` in `src/index.ts`.
4. An entry in `src/commands/help/registry.ts`, or the name in the hidden list of `tests/commands/help/registryParity.test.ts`.
5. A heading in `docs/BOT-HANDBOOK.md`, a row in the quick reference of `docs/reference/slash-commands.md` and a mention in `docs/PERMS-MATRIX.md`.

A permission that matters is checked in the handler, never only through Discord's command permissions.

## Database + migrations

- Migrations are `migrations/NNN_descriptive_name.ts`; conventions are in `migrations/README.md`. `npm run migrate` applies the pending ones, `npm run migrate:dry` lists them.
- After a schema change, regenerate `tests/fixtures/schema.sql` (`npm run gen:test-schema` against a migrated database) and the schema reference (`npm run docs:schema`).
- Destructive or hard-to-reverse migrations need the owner's say first.

## Deploy

- Production: PM2 on EC2 (pawtropolis instance, i-036253b06d0ab8546).
- Deploy script: `./deploy.sh` with lock, a database backup first (on by default; `BACKUP_BEFORE_DEPLOY=0` skips it) and a health check. It runs the tests, builds, uploads, runs pending migrations on the host and registers the slash commands there.
- Slash-command sync by hand: `npm run deploy:cmds` (run on EC2; local hangs).
- A push to `main` that touches `docs/**` or `web/**` starts the dashboard deploy workflow. It deploys once CI has passed on that commit; started by hand it does not wait for CI.
- See `docs/operations/deployment-hardening.md` for the full procedure.

## Releases

- The version lives in `package.json`, `web/package.json` and both lockfiles: `npm version <x> --no-git-tag-version` in the root and in `web/`.
- `CHANGELOG.md` gets a section per release and the version list at its top gets a link. Release notes with the host steps go in `docs/releases/<version>.md`.
- The current release is 26.0.0. Its audit, deferred work and open owner decisions are in `MODERNIZATION_PLAN.md`.

## Web dashboard design

- "Indie game feel": polished, animated, handcrafted. Not gamified.
- No cheap gradients or generic SaaS aesthetic.
- Dynamic Discord identity theming (accent / avatar / banner colors).
- Performance: 60fps animations, Lighthouse 95+, zero jank.
- No component libraries with defaults; build from scratch.

## Decisions baked in

- Monorepo: web dashboard lives in `web/` alongside bot in `src/`.
- Dashboard reads SQLite directly (WAL mode concurrent reads). No API layer for reads.
- 7-tier progressive reveal based on real permission hierarchy from PERMS-MATRIX.md.
- Caveman mode default for token efficiency (SessionStart hook).

## What this is not

- Not a team project. No PR reviewers, no assignees, no Code Owners.
- Not gamified. No XP bars, achievements, level-up dialogs.
- Not generic-AI-built. Distinctive aesthetic over speed.
