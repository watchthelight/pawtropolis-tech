---
name: goodnight
description: >
  End-of-session closeout. Audits which todos have completion evidence in
  recent commits, proposes moves from `todo/` to `done/` (user confirms each),
  updates `_DONE.md` with today's date section, commits incrementally,
  closes GH issues via /sync-tasks. Trigger: /goodnight, "end of session",
  "close out for the night", "ship it".
user_invocable: true
---

# /goodnight

Reconcile the day's work. File moves + GH closes happen per todo, one commit per move.

## Flow

1. **Resolve range**:
   ```bash
   git log --format="%H %s" <cursor>..HEAD
   ```

2. **Extract candidate todos** - todo IDs referenced in commit messages OR todos whose status line says `COMPLETE` or whose body includes `done` markers.

3. **For each candidate**, propose a move:
   - Show the user the todo title, recent commits, current status.
   - Ask via `AskUserQuestion`:
     - `Move to done?`
     - options: `Yes, mark done` / `No, leave open` / `Skip for now`
   - On `Yes`:
     - Append a resolution paragraph to the file body (what shipped, commit SHAs).
     - `git mv todo/NNNNN.md done/NNNNN.md`
     - `Edit` `_DONE.md` - find or create `## YYYY-MM-DD` section (today), append bullet:
       ```
       - [x] [<Title>](done/NNNNN.md) <resolution prose>
       ```
     - `Edit` `_BACKLOG.md` - remove the corresponding bullet from its section.
     - Commit:
       ```bash
       git add todo/NNNNN.md done/NNNNN.md _DONE.md _BACKLOG.md
       git commit -m "chore(done): close #NNNNN <short title>"
       ```

4. **After all moves**, run `/sync-tasks` to push close events to GitHub.

5. **Report**:
   ```
   Closed 4 todos:
   - #00012 Refactor large index.ts startup
   - #00018 Welcome editor preview polish
   - #00021 Fix rate-limit bypass in /art endpoint
   - #00024 Migrate scheduler tests to vitest

   Sync complete: closed 4 on GitHub.
   ```

## Confirmation discipline

- Never auto-move. Always ask per todo.
- Never batch-commit. One commit per move.
- Never close on GitHub directly; the engine handles that on the next sync.

## Boundaries

- Never edits a todo's body except to append the resolution paragraph at end-of-life.
- Never reorders `_DONE.md` (newest date at top is convention but not enforced).
- Never closes issues that have no local file evidence of completion.
