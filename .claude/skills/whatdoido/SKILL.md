---
name: whatdoido
description: >
  Read-only triage snapshot. Fetches open GH Issues, reads `_BACKLOG.md` and
  recent commits, ranks next moves by priority. Outputs a one-page "where am
  I, what's next" list with clickable links and todo IDs. Trigger:
  /whatdoido, "what next", "what should I work on", "triage".
user_invocable: true
---

# /whatdoido

Snapshot of current state. No writes.

## Flow

1. **Fetch open issues**:
   ```bash
   gh issue list --state open --limit 100 --json number,title,labels,url,createdAt
   ```

2. **Read backlog**:
   - `_BACKLOG.md` (the index)
   - `todo/*.md` (detail for any item flagged WIP or Blocked)

3. **Read recent commits**:
   ```bash
   git log --format="%H %s" -10
   ```

4. **Rank**:
   - Critical first, then High, Medium, Low, Nominal.
   - Within each priority, items with status `WIP` rank above untouched.
   - Items with `Blocked (Internal)` or `Blocked (External)` go to a separate "Blocked" section at the bottom.

5. **Output** (read-only, no file writes):

```
## In progress
- [00012](https://github.com/watchthelight/pawtropolis-tech/issues/N) `High` Refactor large index.ts startup
- [00018](https://...) `Medium` Welcome editor preview polish

## Next up (priority order)
- [00021] `Critical` Fix rate-limit bypass in /art endpoint
- [00024] `High` Migrate scheduler tests to vitest
- [00027] `Medium` Reduce any types in dashboardApi.ts

## Blocked
- [00030] `Medium` Re-enable disabled gate.spec tests (BLOCKED: needs DB fixture)

## Recent activity
- ab12c3d feat(welcome): preview shows ping role chip (#00018)
- 4d5e6f7 fix(rate): tighten /art bucket size (#00021)
```

## Boundaries

- Never writes any file.
- Never calls `/sync-tasks` or `/issue-update`.
- Never closes or modifies issues.
