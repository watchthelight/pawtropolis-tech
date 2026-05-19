---
name: code-review
description: >
  Adversarial triple-lens self-review. Three passes: Blind Hunter (find bugs),
  Edge Case Hunter (find edge cases), Acceptance Auditor (verify acceptance
  criteria met). Output: findings list, severity-tagged, file:line referenced.
  No approval gate; the user decides to ship or fix. Trigger: /code-review,
  "review this branch", "review the diff", "check my work".
user_invocable: true
arg_description: '[ref|file] (optional; default: current branch diff vs main)'
---

# /code-review

Read-only self-review through three adversarial lenses.

## Flow

1. **Resolve scope**:
   - No arg: `git diff main...HEAD` and the list of changed files.
   - Arg is a git ref: `git diff <ref>...HEAD`.
   - Arg is a file path: review that file in its current state.

2. **Pass 1: Blind Hunter** - read the diff cold, ignoring the commit messages. Hunt for:
   - Null / undefined / empty-array bugs.
   - Off-by-one in loops, slicing, ranges.
   - Resource leaks (handles not closed, listeners not removed).
   - Concurrency issues (race conditions, await missing, promise chains broken).
   - Error swallowing (catch blocks that lose context, ignored rejections).
   - Type coercion surprises (loose equality, truthy/falsy traps).

3. **Pass 2: Edge Case Hunter** - same diff, but think about inputs:
   - Empty inputs, single-element inputs, huge inputs.
   - Unicode, surrogates, RTL, zero-width.
   - Negative numbers, zero, Infinity, NaN.
   - Permissions: what if the user lacks access?
   - State: what if this fires twice? What if it fires before init?
   - Network: what if the request times out? Returns 429? Returns malformed JSON?

4. **Pass 3: Acceptance Auditor** - find the linked todo via `#NNNNN` in commit messages or PR body. Read `todo/NNNNN.md`. Check that the diff actually delivers on the body of the todo, not just adjacent work.

5. **Output**:

```markdown
# Code review: <branch-or-ref>

Files reviewed: 4 | Lines added: 187 | Lines removed: 62

## Critical findings (must fix before ship)
- `src/web/dashboardApi.ts:142` - Missing parameter binding on `db.prepare(\`SELECT * FROM users WHERE id = ${id}\`)`. SQL injection.

## High findings
- `src/features/gate.ts:521` - The `for (const role of roles)` loop calls `await api.assignRole(role)` sequentially; for 50+ roles this exceeds Discord's interaction reply window.

## Medium findings
- `src/lib/rateLimiter.ts:88` - The bucket reset uses `setTimeout` without clearing on shutdown; minor leak.

## Acceptance check
- Todo #00018 (Welcome editor preview polish) - covered, except: the spec says "fall back to default greeting when editor is empty" - I see the conditional but it does not handle the "all whitespace" case.

## Notes (low priority)
- Three `any` types added in `dashboardApi.ts:201-209`. Worth tightening if you have a free hour.
```

## Severity guide

- **Critical** - data loss, security, crashes, broken core flow.
- **High** - regression in shipped feature, perf cliff, missing error handling at boundary.
- **Medium** - test gap, code smell with concrete impact, minor leak.
- **Low** - style, naming, marginal improvements.

## Boundaries

- Never writes code, never fixes anything.
- Never opens issues from findings (user does that via `/issue`).
- Never modifies the diff, never amends commits.
- Never approves or rejects - the verdict is the user's.
