---
name: retro
description: >
  Post-epic learning capture. Prompts: what was built, what worked, what
  slowed me down, what is the next risk. Writes the response to
  `_retros/YYYY-MM-DD-<epic-name>.md`. Trigger: /retro, "retrospective",
  "post-mortem", "what did we learn".
user_invocable: true
arg_description: '<epic-name>'
---

# /retro

Capture lessons from a completed epic or sprint. Writes one file.

## Flow

1. **Arg required** - epic name (kebab-case). Example: `/retro welcome-editor-overhaul`.

2. **Gather context**:
   - Read `_DONE.md` for the past 14 days (configurable).
   - Read `git log --since="14 days ago" --format="%H %s"`.
   - Pull todo IDs referenced in commits.

3. **Prompt the user** for four short answers (one per turn):
   - `What was built?` (1-3 bullets)
   - `What worked well?` (1-3 bullets)
   - `What slowed me down?` (1-3 bullets)
   - `What is the next risk?` (1-3 bullets)

4. **Render** the file:

```markdown
# Retro: <epic name>

Date: YYYY-MM-DD

## What was built
- bullet 1
- bullet 2

## What worked
- bullet 1
- bullet 2

## What slowed me down
- bullet 1

## Next risk
- bullet 1

## Related todos
- [00012](https://github.com/watchthelight/pawtropolis-tech/issues/N) Refactor index.ts startup
- [00018](https://...) Welcome editor preview polish

## Commits in scope
- ab12c3d feat(welcome): preview shows ping role chip
- 4d5e6f7 fix(rate): tighten /art bucket size
```

5. **Write** `_retros/YYYY-MM-DD-<epic-name>.md`. Create `_retros/` if missing.

6. **Report** the file path.

## Boundaries

- Never modifies todo files.
- Never modifies `_BACKLOG.md` or `_DONE.md`.
- Never runs git operations (commit is on the user).
- Never overwrites an existing retro file - if `_retros/YYYY-MM-DD-<epic-name>.md` exists, append `-2`, `-3`, etc.
