# Observability and error cards

This doc captures the conventions used across the bot for structured logging, error cards, and safe message construction. It is the reference for "should I add an evt field here? wrap with withSql? include allowedMentions?" decisions.

## Logger conventions

Every log call should pass a structured object as the first argument and a static template string as the second:

```ts
logger.info(
  { evt: "review_approve_complete", appId, reviewerId, traceId },
  "[review] approve complete",
);
```

Field conventions:

- `evt` is the canonical event tag. Use lowercase snake_case. Searching logs by `evt:review_approve_complete` should find every place that step ran.
- `traceId` carries the request-scoped trace id. Set it from `reqCtx().traceId` when inside a wrapped command, or `newTraceId()` when starting a fresh chain (e.g., a scheduler job).
- `err` is reserved for the error object itself. Pino renders it with stack and `code`.
- Identity fields use the canonical names: `userId`, `guildId`, `channelId`, `appId`, `ticketId`, `roleId`, `messageId`. These are searchable across the corpus.
- Avoid putting raw user-controlled content (modal answers, free-text reasons) in log fields without thinking. The `redact()` helper in `src/lib/logger.ts` strips most token-like substrings, but not user prose.

The static template string lets log aggregators group identical messages even when the structured fields vary.

## Wide events

`src/lib/wideEvent.ts` builds one wide event per command invocation. The `wrapCommand` wrapper (`src/lib/cmdWrap.ts`) assembles it automatically; you do not normally write a `WideEventBuilder` by hand.

What you DO write:

- `ctx.step("phase_name")` at every meaningful execution boundary inside a command. Phases are short verbs: `validate`, `db_begin`, `db_commit`, `discord_role_add`, `reply`. Search by `phase:` to time individual phases.
- `ctx.setLastSql(sql)` before any DB call that you want surfaced on error cards. The `withSql(ctx, sql, () => ...)` helper does this for you and also records timing.

The wide event is emitted once per command, success or failure. Sampling controls how many successful events ship to backend storage; errors are always retained.

## withStep and withSql

The two convenience wrappers in `src/lib/cmdWrap.ts`:

```ts
await withStep(ctx, "fetch_member", async () => {
  return await guild.members.fetch(userId);
});

const row = withSql(ctx, "SELECT ... FROM application WHERE id = ?", () =>
  db.prepare("SELECT ... FROM application WHERE id = ?").get(appId),
);
```

Use `withStep` when the work is async and you want timing. Use `withSql` for any DB read or write: it tracks the SQL string for error cards and records query duration in the wide event.

For module-level prepared statements that you re-use, pass the SQL string to `setLastSql` immediately before `.run()` / `.get()` / `.all()`:

```ts
ctx.setLastSql("UPDATE application SET status = 'approved' WHERE id = ?");
updateStmt.run(appId);
```

## Error cards

Two error card implementations live in the codebase:

- `src/lib/errorCard.ts`: legacy v1 card. Used by the catch-all router safety net in `src/index.ts`.
- `src/lib/errorCardV2.ts`: current card. Used by `wrapCommand`. Includes build identity (version, SHA, age, deploy ID), response state (deferred / replied / outcome), the failing phase, and last SQL.

Wrapped commands use V2 automatically. Loose router-level handlers (button regex matches, modal route misses) fall back to V1.

`tests/lib/errorCardV2.test.ts` and related cover the rendering shape; do not change card field names without updating the snapshots.

## Safe allowed mentions

`SAFE_ALLOWED_MENTIONS` (`src/lib/constants.ts`) is `{ parse: [] }`: no role mentions, no user mentions, no `@everyone`. Apply it to any channel send where the content originates from user input or staff free-text:

```ts
await channel.send({
  content: applicantSubmittedString,
  allowedMentions: SAFE_ALLOWED_MENTIONS,
});
```

Where it is currently applied:

- modmail relays (`src/features/modmail/routing.ts`: covered by tests)
- dashboard API confirmation messages (`src/web/dashboardApi.ts:116, 1141`)
- announcement / log channel posts that include staff-supplied reasons

Where it MUST be applied if you add a new code path:

- any `interaction.reply` / `channel.send` whose `content` field is built from a user or staff free-text input
- any `message.reply` that quotes content back to its author and could include `@role` text

Where it is NOT needed:

- pure embed-only messages (embeds do not parse mentions to ping users)
- bot-controlled content with no user input

## Wrapping new code

When adding a new command:

1. Wrap with `wrapCommand("name", async (ctx) => {...})`. Get a `CommandContext`.
2. Mark phases via `ctx.step(...)` or `withStep(ctx, ..., async () => {...})`.
3. Wrap DB reads/writes via `withSql(ctx, sql, () => stmt.run(...))`.
4. Apply `SAFE_ALLOWED_MENTIONS` on any send that includes user content.
5. Tests should mock the DB and Discord API; the wide event and error card assertions are already covered upstream.

When adding a new event handler (`client.on(...)`):

1. Wrap with `wrapEvent("name", async (...args) => {...})`.
2. Inside, generate or accept a `traceId` for log correlation.
3. Each top-level try/catch should log with `evt:` and `traceId`.

## Spot-check audit (May 2026)

The May 2026 hardening pass spot-checked `src/index.ts`, `src/features/review/`, `src/features/modmail/`, and `src/web/dashboardApi.ts`. Findings:

- modmail relay paths apply `SAFE_ALLOWED_MENTIONS` consistently and are now covered by `tests/features/modmail/routing.test.ts`.
- review approve/reject/kick flows have transaction-level coverage (`tests/features/review/`) and clear `evt:` tags.
- dashboardApi has 3 explicit `allowedMentions` on its TextChannel sends; mutations rely on the underlying transaction or feature module to enforce safety. No regressions found.
- a handful of inline `try { ... } catch (err) { logger.warn ... }` blocks during ClientReady have been replaced by `runStartupTask` (Phase 5 of the May 2026 pass) which standardizes the `evt:startup_task_failed` shape.

No additional retrofits were applied in this pass. Future drift on these conventions should be caught by code review and by the test suites added in Phases 1-6.
