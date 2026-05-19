---
name: issue-update
description: >
  Non-invasive GH Issue annotation. Reads recent commits referencing todo IDs,
  posts status comments to GH reflecting reality (commits landed, blockers
  cleared), applies minimal managed label transitions (`IP` on activity,
  `Blocked (Internal)` / `Blocked (External)` if status changed). Never
  closes issues, never reopens, never edits local files. Trigger:
  /issue-update, "annotate issues", "update status comments".
user_invocable: true
---

# /issue-update

Sweep recent activity and post status comments to mirror real progress.

## Inputs

- Cursor: `.claude/state/sync-tasks-sidecar/cursor.json` -> `lastHeadSha`. Annotate activity since that SHA.
- Optional arg: `--since <sha-or-ref>` to override the cursor.

## Flow

1. **Resolve range**:
   ```bash
   git log --format="%H %s" <cursor>..HEAD
   ```

2. **Extract todo IDs** from commit messages. Pattern: `#\d{5}` or `#NNNNN` references.

3. **For each referenced ID**:
   - Look up the GH issue via prefix `[NNNNN]`.
   - Read the local file at `todo/NNNNN.md` or `done/NNNNN.md`.
   - Compose a status comment:
     - List commits landed (SHA + subject).
     - Note current status from the file (`WIP`, `BLOCKED`, etc.).
     - Note if blockers referenced by `**Blocked by:**` have moved to `done/`.
   - Post the comment via:
     ```bash
     gh issue comment <num> --body-file -
     ```
   - Apply label transitions:
     - Commits since last sync + file status `WIP` -> add `IP` label.
     - File status `BLOCKED: ...` -> add `Blocked (Internal)` (or `Blocked (External)` if reason mentions vendor/external party).
     - File status changed away from blocked -> remove blocked labels.

4. **Update cursor** - leave cursor.json untouched (only `/sync-tasks` writes it).

## Boundaries

- Never closes or reopens issues (that is `/sync-tasks`'s job).
- Never edits local files.
- Never creates issues.
- Never touches non-managed labels.

## Output

Report a per-ID summary:
```
#00012: 2 commits since 1ab2c3d, label added: IP, comment posted
#00015: status changed BLOCKED -> WIP, labels updated
#00021: no activity, skipped
```
