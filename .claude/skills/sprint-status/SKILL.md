---
name: sprint-status
description: >
  Solo standup-style snapshot. Lists WIP (status WIP or label IP), blocked
  items with reasons, next 3 priorities. Concise plain-text output suitable
  for a journal entry. Trigger: /sprint-status, "standup", "status check",
  "where am I".
user_invocable: true
---

# /sprint-status

Plain-text snapshot. Read-only.

## Flow

1. **WIP** - `todo/NNNNN.md` files with status `WIP` OR GH Issues with `IP` label.
2. **Blocked** - status `BLOCKED: <reason>` OR `Blocked (Internal)` / `Blocked (External)` labels.
3. **Next 3** - top three open todos by priority that are neither WIP nor blocked.
4. **Activity** - count commits in the last 24 hours.

## Output format

```
# Status: 2026-05-19

## WIP (2)
- [00012] Refactor large index.ts startup (commits today: 3)
- [00018] Welcome editor preview polish (commits today: 1)

## Blocked (1)
- [00030] Re-enable disabled gate.spec tests (BLOCKED: needs DB fixture; depends on [00027])

## Next up
1. [00021] `Critical` Fix rate-limit bypass in /art endpoint
2. [00024] `High` Migrate scheduler tests to vitest
3. [00027] `Medium` Reduce any types in dashboardApi.ts

## Recent activity
- 5 commits in the last 24h
- Last commit: ab12c3d feat(welcome): preview shows ping role chip (#00018)
```

## Boundaries

- Never writes files.
- Never modifies issues or labels.
- Never suggests new work (use `/sprint-plan` for that).
