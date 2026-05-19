---
name: issue
description: >
  Interactive builder for new `todo/NNNNN.md` files. Walks through type, title,
  priority, status, body, blocks, evidence; validates against /sync-tasks
  format rules; writes the file; updates `_BACKLOG.md`; auto-runs
  `scripts/ops/sync-tasks.py` to mirror to GitHub; reports the issue URL.
  Trigger: /issue, "new todo", "open an issue", "file a bug".
user_invocable: true
arg_description: '[bug|feat|chore|audit|security|question|refactor] (optional; skips the type prompt)'
---

# /issue

Interactive builder for a new task ledger entry. Gathers fields, validates, writes the file, updates the backlog, pushes to GitHub.

**Scope:** creates new todos only. Does NOT edit / close / complete / delete existing items (hand-edit + run `/sync-tasks`).

## Interaction model

**Multi-choice fields** (Type, Priority, Confirm) use the `AskUserQuestion` tool. Set `header` to a short chip label, provide options, single-select.

**Free-text fields** (Title, Body, Blocks, Blocked by, Evidence) stay as plain-text prompts. One field per turn. Wait for the user's next message.

Never stack multiple unrelated questions in one `AskUserQuestion` call.

## Flow

1. **Type** - if invoked with an arg (`bug`, `feat`, `chore`, `audit`, `security`, `question`, `refactor`), skip this step. Otherwise call `AskUserQuestion`:
   - question: `What kind of issue?`
   - header: `Issue type`
   - options (one of):
     - `bug` - Defect in shipped behavior
     - `feat` - New feature or capability
     - `chore` - Maintenance, deps, CI, infra
     - `audit` - Came from an audit finding
     - `security` - Security or abuse-surface issue
     - `question` - Decision needed before progress
     - `refactor` - Code shape change with no behavior change

2. **Allocate ID.** Run:
   ```bash
   python scripts/ops/sync-tasks.py next-id
   ```
   Use the 5-digit value verbatim. Never invent.

3. **Gather fields** - one per turn.

4. **Scrub + validate** - mechanical scrubs silently (U+2014 -> `--`, U+2013 -> `-`, curly quotes -> straight). On any hard-check failure, stop, report the failure, loop back.

5. **Preview** - print the exact file content and the `_BACKLOG.md` insertion line. Ask:
   > Confirm? `yes` | `no` | `edit <field>`

   `edit <field>` re-asks that field only. `no` aborts. `yes` proceeds.

6. **Write** - on `yes`:
   - `Write` `todo/NNNNN.md` with rendered content.
   - `Edit` `_BACKLOG.md` to insert the bullet under the matching section (Active / Blocked / Audit).

7. **Push** - run:
   ```bash
   python scripts/ops/sync-tasks.py
   ```
   Relay the summary block verbatim. Parse for the new issue URL and print:
   > Issue live: https://github.com/watchthelight/pawtropolis-tech/issues/NNN

8. **Handoff** - remind the user that `git commit` is on them. Skill never runs git.

## Field schemas

Ask in this order:

| Field | Prompt | Validation |
|---|---|---|
| Title | Free-text: `Title? (terse, no '?', no em dash)` | After scrub: at least 3 chars, no `?` for non-question types. Question type: must end with `?`. |
| Priority | `AskUserQuestion`, header `Priority`, options: `Critical` / `High` / `Medium` / `Low` / `Nominal` | One of the five. |
| Status | `AskUserQuestion`, header `Status`, options: `(none)` / `WIP` / `BLOCKED` / `PAUSED` | On `(none)` omit the line. On `WIP` write `WIP`. On `BLOCKED` / `PAUSED` prompt free-text reason. |
| Body | `Body? (what / why / next step; multi-line OK, Enter twice to finish)` | Scrub em/en dash + curly quotes. No length limit. |
| Blocks | `Blocks? (optional comma-separated todo/NNNNN.md refs, blank to skip)` | Each must match `^todo/\d{5}\.md$` and exist. |
| Blocked by | `Blocked by? (optional todo/NNNNN.md ref or external description, blank to skip)` | Free-text accepted; todo refs validated. |
| Evidence | `Evidence? (optional audit/*.md#section ref, blank to skip)` | Path must exist if referenced. |

## Rendered format

### `todo/NNNNN.md`

```
# #NNNNN -- <Title>

**Type:** <type> | **Priority:** <Priority>[ | **Status:** `<tag>`]

<body>

[**Blocks:** `todo/00XXX.md`, `todo/00YYY.md`]
[**Blocked by:** `todo/00ZZZ.md` or external reference]
[**Evidence:** `audit/<file>.md#section`]
```

- Omit the `| **Status:** ...` segment when no tag.
- Omit each Blocks / Blocked by / Evidence line when blank.
- Exactly one blank line between sections.

## `_BACKLOG.md` insertion

Sections in order: `## Active`, `## Blocked`, `## Deferred`, `## Audit`.

- Status `WIP` or `(none)` -> `## Active`
- Status `BLOCKED:` -> `## Blocked`
- Status `PAUSED:` -> `## Deferred`
- Type `audit` or `security` -> `## Audit` (overrides status)

Bullet format:
```
- [ ] [<Title>](todo/NNNNN.md) `<priority>` [`<status-note>`]
```

Append to the bottom of the matching section. Replace `_(empty)_` with the bullet if the section was empty.

## Validation (hard rules)

1. No em dash (U+2014) anywhere after scrub.
2. No en dash (U+2013) anywhere after scrub.
3. Title line must render as `^# #\d{5} -- .+$`.
4. Meta line must render as `**Type:** <type> | **Priority:** <Priority>[ | **Status:** \`<tag>\`]`.
5. Type must be one of: bug, feat, chore, audit, security, question, refactor.
6. Priority must be one of: Critical, High, Medium, Low, Nominal.
7. Question-type title must end with `?`.
8. Block refs must point at existing files at write time.

## Push failure handling

- Exit 0: parse stdout for the new issue URL. Report it.
- Exit 2 (validation): the local file violated a rule. Report verbatim. Tell user to fix and rerun `python scripts/ops/sync-tasks.py`. Do not delete the file.
- Other non-zero: environment problem. Report stderr verbatim. File stays on disk. Do not retry.

## Boundaries

- Never creates BMAD stories.
- Never edits existing todos.
- Never closes issues or moves to `done/`.
- Never runs git.
- Never invents the next id.
