# Pawtropolis Tech: Conventions for Claude Code

Single-developer Discord bot + SvelteKit web dashboard. This file documents the conventions that should be followed when assisting on this repo.

## Identity + commits

- Author: `watchthelight <admin@watchthelight.org>`. Always commit as this identity.
- No `Co-Authored-By: Claude` lines on commits.
- Conventional Commits: `feat(scope):`, `fix(scope):`, `chore:`, `test:`, `docs:`, `refactor:`, `audit:`.
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

## Code style + structure

- TypeScript strict mode is enforced. `npm run typecheck` is a HARD gate in CI.
- ESLint is a SOFT gate (warnings allowed). Format is a SOFT gate (drifts allowed). Both are tracked in `docs/operations/ci-policy.md`.
- Prefer editing existing files; avoid new files unless needed.
- No defensive over-engineering. Trust framework guarantees.
- No em-dashes in user-facing prose. Use colons or restructure.
- Default to writing no comments. Add one only when the WHY is non-obvious.

## Tests

- Unit + integration tests via Vitest. Coverage via @vitest/coverage-v8.
- Tests are a HARD gate in CI.
- Test DB: `tests/fixtures/schema.sql` seed.
- Web tests live under `tests/web/` (currently sparse; see todo #00012).

## Deploy

- Production: PM2 on EC2 (pawtropolis instance, i-036253b06d0ab8546).
- Deploy script: `./deploy.sh` with lock, optional backup, health check.
- Slash-command sync: `npm run deploy:cmds` (run on EC2; local hangs).
- See `docs/operations/deployment-hardening.md` for the full procedure.

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
- Caveman mode default for token efficiency (`.claude/hooks` SessionStart hook).

## What this is not

- Not a team project. No PR reviewers, no assignees, no Code Owners.
- Not gamified. No XP bars, achievements, level-up dialogs.
- Not generic-AI-built. Distinctive aesthetic over speed.
