# Issue System

File-first task tracking with GitHub Issues mirror. Ported from `blue-walmart` and adapted for solo development.

## Source of truth

Files in this repo are authoritative:

- `todo/NNNNN.md` - one file per open todo
- `done/NNNNN.md` - completed todos (moved from `todo/`)
- `_BACKLOG.md` - one-line rollup index of open todos
- `_DONE.md` - one-line dated ledger of completed todos
- `OPEN-QUESTIONS.md` - unresolved decisions (optional; create on demand)

GitHub Issues are a mirror. The sync engine pushes changes one-way (file -> GH). The local file is always the latest truth; GH is the notification surface.

## File format

`todo/NNNNN.md` schema:

```markdown
# #NNNNN -- <Title in plain prose>

**Type:** <bug|feat|chore|audit|security|question|refactor> | **Priority:** <Critical|High|Medium|Low|Nominal> [ | **Status:** `<WIP|BLOCKED: reason|PAUSED: reason>`]

<body paragraphs>

[**Blocks:** `todo/NNNNN.md`, ...]
[**Blocked by:** `todo/NNNNN.md` or external reference]
[**Evidence:** `audit/<file>.md#section`]
```

### Validation rules

The sync engine enforces these on every push. Failure aborts the sync.

- Title line must match `^# #\d{5} -- .+$` exactly. One space between `#NNNNN`, two hyphens, one space, then the title.
- No em-dash (U+2014) or en-dash (U+2013) anywhere in the body. The engine auto-scrubs these to a single space on write, but a follow-up edit that re-introduces one is a hard error.
- No curly quotes (U+2018, U+2019, U+201C, U+201D). Auto-scrub to straight quotes on write.
- Type and Priority are required on the meta line.
- Status tag is optional. Use `WIP`, `BLOCKED: <reason>`, or `PAUSED: <reason>`.
- ID is sequential, zero-padded to 5 digits, never reused.

### Title prefix anchor

Every GH Issue title is prefixed with `[NNNNN]` for cross-reference. Example: `[00012] -- Refactor large index.ts startup into modules`. This prefix is permanent and never changes.

### Body fidelity

The engine renders the file body to the issue body verbatim (after mechanical humanize: dashes scrubbed, blank lines collapsed). No additional formatting. The issue body always reflects the file as of last push.

## Label taxonomy

Sixteen labels total: 8 type + 5 priority + 3 status. Every issue gets one type label and one priority label. Status is added only when relevant.

### Type labels

| Label | Color | Meaning |
|-------|-------|---------|
| `TODO` | blue (`#1f6feb`) | Every managed todo carries this. Distinguishes ported issues from any manual ones. |
| `bug` | red (`#d73a4a`) | Defect in shipped behavior. |
| `feat` | cyan (`#a2eeef`) | New feature or capability. |
| `chore` | gray (`#cfd3d7`) | Maintenance, deps, CI, infra. |
| `audit` | salmon (`#e99695`) | Came from an audit finding. |
| `security` | dark red (`#b60205`) | Security or abuse-surface issue. |
| `question` | purple (`#d876e3`) | Decision needed before progress. |
| `refactor` | yellow (`#fbca04`) | Code shape change with no behavior change. |

`security` trumps `audit` when a finding is both.

### Priority labels

| Label | Color | Maps to |
|-------|-------|---------|
| `Critical` | dark red (`#b60205`) | P0 |
| `High` | orange (`#d93f0b`) | P1 |
| `Medium` | yellow (`#fbca04`) | P2 |
| `Low` | green (`#0e8a16`) | P3 |
| `Nominal` | gray-blue (`#bfd4f2`) | Background work |

### Status labels

| Label | Color | Set when |
|-------|-------|----------|
| `IP` | green (`#0e8a16`) | Commit activity detected against the todo ID. |
| `Blocked (Internal)` | purple (`#5319e7`) | Blocked on a decision or upstream todo. |
| `Blocked (External)` | dark red (`#b60205`) | Blocked on a vendor or external party. |

## Skills

Nine slash commands drive the system.

### Core (5)

- `/issue` - Interactive builder for new todos. Prompts for type, title, priority, body. Validates, writes `todo/NNNNN.md`, updates `_BACKLOG.md`, runs `/sync-tasks`.
- `/sync-tasks` - Reconcile files <-> GH Issues. Wraps `scripts/ops/sync-tasks.py`. Reports created/updated/closed/reopened counts.
- `/issue-update` - Read-only annotation. Posts status comments to GH reflecting commit activity. Applies minimal label transitions. Never closes or edits files.
- `/whatdoido` - Triage snapshot. Lists open issues by priority, recent commits, next moves. Read-only.
- `/goodnight` - End-of-session closeout. Proposes moving completed todos to `done/`, updates `_DONE.md`, closes GH issues, commits incrementally.

### Planning + review (4)

- `/sprint-plan` - Sequence the backlog into priority-aware, dependency-aware blocks. Solo mode: no team assignment.
- `/sprint-status` - Solo standup snapshot. WIP, blocked, next 3 priorities.
- `/retro` - Post-epic learning capture written to `_retros/YYYY-MM-DD-<epic-name>.md`.
- `/code-review` - Triple-lens self-review: Blind Hunter (find bugs), Edge Case Hunter (find edge cases), Acceptance Auditor (verify acceptance criteria). Findings list with file:line refs. No approval gate.

## Workflows

### Opening a todo

1. Run `/issue`. Provide type, title, priority, body.
2. Skill validates, writes the file, updates `_BACKLOG.md`, calls `/sync-tasks`.
3. Skill reports the GH issue URL.

### Working on a todo

1. Edit `**Status:** \`WIP\`` on the meta line in `todo/NNNNN.md`.
2. Commit referencing `#NNNNN` in the message so `/issue-update` can detect activity.
3. If blocked, change status to `BLOCKED: <reason>` and run `/sync-tasks`.
4. Periodically run `/issue-update` to sync status comments and labels to GH.

### Marking done

1. Run `/goodnight` at end of session. It proposes moves based on commit activity.
2. Confirm each move. Skill writes the file move (`git mv todo/NNNNN.md done/NNNNN.md`), appends resolution to the body, updates `_DONE.md`.
3. Skill commits per move (one commit per todo) and runs `/sync-tasks` to close the GH issue.

### Triaging

1. Run `/whatdoido`. Get a ranked list of next moves.
2. Optionally run `/sprint-plan` to sequence into a block of work.

### Audit cadence

Run a fresh audit on a fixed monthly cadence (first Monday). Each finding becomes a `todo/NNNNN.md` with `**Type:** audit` (or `security`) and `**Evidence:** audit/<file>.md#section`.

## Files reference

| File | Purpose |
|------|---------|
| `_BACKLOG.md` | Open-todo index, grouped by Active / Blocked / Deferred / Audit |
| `_DONE.md` | Dated ledger of completed todos |
| `todo/NNNNN.md` | Open todo detail |
| `done/NNNNN.md` | Completed todo detail |
| `OPEN-QUESTIONS.md` | Unresolved decisions (optional) |
| `scripts/ops/sync-tasks.py` | The sync engine |
| `scripts/ops/sync-labels.sh` | Idempotent label seeder |
| `.github/labels.yml` | Declarative label config |
| `.github/ISSUE_TEMPLATE/config.yml` | Disables blank issues, routes to file workflow |
| `.github/pull_request_template.md` | PR template with linked-todo + test plan + risk |
| `.claude/state/sync-tasks-sidecar/cursor.json` | Sync engine state (last synced SHA) |
| `.claude/skills/<name>/SKILL.md` | The 9 skill definitions |

## Commit conventions

- Author: `watchthelight <admin@watchthelight.org>`. No `Co-Authored-By: Claude` lines.
- Conventional Commits: `feat(scope):`, `fix(scope):`, `chore:`, `test:`, `docs:`, `refactor:`.
- Reference todo IDs in commit messages with the bare ID: `feat(welcome): handle empty template (#00042)`. This enables `/issue-update` to detect activity.
- Tiny, purposeful commits. One thing per commit.

## Troubleshooting

- **Sync engine reports "no managed labels found"** - Run `scripts/ops/sync-labels.sh` to seed the label set.
- **Engine aborts with "em-dash detected"** - Open the file, grep for U+2014 and U+2013, replace with a space.
- **GH issue exists but file does not** - Manual orphan. Either close the issue on GH or recreate the file with a matching `[NNNNN]` prefix.
- **`gh auth status` fails** - Re-authenticate with `gh auth login`.
- **`/sync-tasks` reports nothing changed but issues are stale** - Force a re-render with `python scripts/ops/sync-tasks.py --no-pull --verbose` to see the diff calculation.
