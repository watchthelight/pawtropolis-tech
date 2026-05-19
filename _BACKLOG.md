# Pawtropolis: Backlog

One-line index. Detail in [`todo/`](./todo/). Completed items move to [`done/`](./done/) and roll up into [`_DONE.md`](./_DONE.md).

See [`docs/issue-system.md`](./docs/issue-system.md) for the file format, label vocabulary, and skill workflow.

This file is a parallel index for the new file-first issue system. The legacy narrative TODO list lives in [`TODO.md`](./TODO.md) and remains untouched.

## Active

_(empty)_

## Blocked

_(empty)_

## Deferred

_(empty)_

## Audit

Findings from [audit/2026-05-19/](./audit/2026-05-19/) converted to tracked todos.

### Critical

_(none)_

### High

- [ ] [Refactor src/index.ts (2705 lines) into event modules](todo/00007.md) `High`
- [ ] [Refactor src/web/dashboardApi.ts (1792 lines) into route modules](todo/00008.md) `High`
- [ ] [Refactor src/commands/audit.ts (1760 lines) into subcommand modules](todo/00009.md) `High`
- [ ] [Refactor src/features/serverAuditDocs.ts (1740 lines) into 3 modules](todo/00010.md) `High`
- [ ] [Refactor src/features/gate.ts (1602 lines) into a state machine](todo/00011.md) `High`
- [ ] [Add web/ API route and dashboard page tests](todo/00012.md) `High`

### Medium

- [ ] [Add Origin header CSRF check on dashboard API](todo/00006.md) `Medium`
- [ ] [Refactor src/features/flagsStore.ts for testability](todo/00013.md) `Medium`
- [ ] [Refactor hasStaffPermissions for testability](todo/00014.md) `Medium`
- [ ] [Re-enable health.ts timeout test](todo/00015.md) `Medium`
- [ ] [Add tests for src/features/avatarScan.ts](todo/00016.md) `Medium`
- [ ] [Add tests for auditRunner.ts and securityDiff.ts](todo/00017.md) `Medium`
- [ ] [Add tests for 5 untested schedulers](todo/00018.md) `Medium`
- [ ] [Replace lazy any types in scripts/commands.ts](todo/00020.md) `Medium`
- [ ] [Run prettier format on web/ (925 drifts)](todo/00022.md) `Medium`
- [ ] [Enable tsconfig noUncheckedIndexedAccess and unused checks](todo/00024.md) `Medium`
- [ ] [Upgrade Vitest to 4.x (major)](todo/00032.md) `Medium`
- [ ] [Upgrade TypeScript to 6.x (major)](todo/00033.md) `Medium`

### Low

- [ ] [Add setDMPermission(false) to guild-only commands](todo/00025.md) `Low`
- [ ] [Validate Litestream configuration in CI / pre-deploy](todo/00040.md) `Low`
