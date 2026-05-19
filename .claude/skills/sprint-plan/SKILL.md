---
name: sprint-plan
description: >
  Sequence the open backlog into a priority-aware, dependency-aware block of
  work. Solo mode: no team assignment, no rotation. Output is an ordered list
  of todo IDs with rationale. Trigger: /sprint-plan, "plan a sprint",
  "what should I tackle next", "sequence the work".
user_invocable: true
arg_description: '[days] (optional sprint length; default 7)'
---

# /sprint-plan

Produce a sequenced execution plan for the open backlog. Read-only.

## Flow

1. **Gather state**:
   - Parse `_BACKLOG.md` for the open todos.
   - Read each referenced `todo/NNNNN.md` to extract Type, Priority, Status, Blocks, Blocked by.

2. **Identify critical path**:
   - Start with any `Critical` items.
   - For each item, walk `Blocked by` refs until reaching a leaf (something blocked by nothing).
   - The leaves at the start of chains must ship first.

3. **Order**:
   - Tier 1: Critical, unblocked.
   - Tier 2: High, unblocked.
   - Tier 3: Critical / High, blocked - note the blocker.
   - Tier 4: Medium, unblocked.
   - Tier 5: Low / Nominal, unblocked, fit if time remains.

4. **Estimate fit** - given the requested sprint length (days), suggest a cut-line. No magical estimation; ask the user to confirm scope.

5. **Output**:

```
# Sprint plan: 7 days starting 2026-05-19

## Day 1-2: Unblock the critical chain
1. [00021] `Critical` Fix rate-limit bypass in /art endpoint
2. [00025] `Critical` Patch SQL injection in dashboardApi search

## Day 3-4: High-impact follow-through
3. [00012] `High` Refactor large index.ts startup
4. [00018] `High` Migrate scheduler tests to vitest

## Day 5-6: Medium polish (pick 2-3)
- [00027] `Medium` Reduce any types in dashboardApi.ts
- [00030] `Medium` Re-enable disabled gate.spec tests
- [00033] `Medium` Add tests for ticket modal flow

## Day 7: Slack and retro
- Buffer for spillover, retro write-up via /retro.

## Blocked, not in scope this sprint
- [00040] `High` (blocked by [00021] -> ships after rate-limit fix)
```

## Boundaries

- Never assigns work to anyone (solo dev).
- Never writes the plan to a file unless the user asks (the plan is conversational; use `/retro` for written history).
- Never modifies `_BACKLOG.md` ordering.
