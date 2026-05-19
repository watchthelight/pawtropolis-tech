---
name: sync-tasks
description: >
  Reconcile local task files (`todo/`, `done/`) with GitHub Issues. One-way
  push: files are source of truth, Issues are the mirror. Wraps
  `scripts/ops/sync-tasks.py`. Reports created / updated / closed / reopened
  counts. Trigger: /sync-tasks, "sync issues", "mirror todos".
user_invocable: true
arg_description: '[--dry-run] [--verbose] (optional flags forwarded to the engine)'
---

# /sync-tasks

Push local task state to GitHub. The Python engine does the actual work; this skill provides the invocation surface and result formatting.

## Flow

1. **Pre-flight** - confirm `gh auth status` succeeds and the user is on the `pawtropolis-tech` repo. If either fails, abort with the underlying error.

2. **Invoke** the engine. Forward any args:
   ```bash
   python scripts/ops/sync-tasks.py [args]
   ```

3. **Parse output** - the engine prints structured summary:
   - `Parsed N items from local files.`
   - `Fetched N issues from GitHub.`
   - Per-action lines: `CREATE`, `UPDATE`, `CLOSE`, `REOPEN`, `ORPHAN`
   - Final `Summary:` block with counts.

4. **Report** - relay the summary block verbatim. Add a one-line headline:
   > Sync complete: created N, updated N, closed N, reopened N. Cursor at `<sha>`.

5. **Handle failures**:
   - Exit 2 (validation): print the validation error block verbatim. Do not retry.
   - Other non-zero: print stderr verbatim. Do not retry.

## Common arguments

- `--dry-run` - print what would change without writing to GitHub.
- `--no-pull` - skip the `git pull --ff-only` step (useful when branch lacks an upstream).
- `--verbose` (or `-v`) - emit per-issue diff details.

## When to invoke

- After `/issue` (auto-invoked).
- After `/goodnight` (auto-invoked, after moves).
- After any hand-edit to `todo/` or `done/` files.
- After git operations that change branch state (manual; engine pulls before reconciling).

## Boundaries

- Never edits local files. Files are authoritative.
- Never invents IDs.
- Never deletes GitHub issues (only closes them; deletes are manual via `gh issue delete`).
- Never touches labels outside the managed set.
