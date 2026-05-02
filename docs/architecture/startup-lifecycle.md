# Startup lifecycle

This doc describes the order of operations when the bot boots and shuts down. The implementation lives in `src/index.ts`, with cohesive sections extracted into `src/startup/*.ts`.

## Process boot

`main()` runs three things before connecting to Discord:

1. `requireHealthyDatabase()` — fails fast on a corrupted SQLite file.
2. Validates `DISCORD_TOKEN` and warns if `GUILD_ID` is unset.
3. `client.login(DISCORD_TOKEN)` — opens the websocket.

If the token is invalid or the DB is corrupt, the process exits with code 1 before any handlers register.

## ClientReady

Once Discord finishes the IDENTIFY handshake, `Events.ClientReady` fires once. The handler runs the following in order. Each step is wrapped in `runStartupTask` (`src/startup/runStartupTask.ts`) which logs failures and continues — one broken step does not abort startup.

| # | Step | Module |
|---|------|--------|
| 1 | Schema self-heal | `src/startup/schema.ts::runSchemaSelfHeal` |
| 2 | Panic state load | inline in `index.ts` |
| 3 | Movie session recovery + persistence start | inline |
| 4 | Game session recovery + persistence start | inline |
| 5 | Voice session seeding | inline |
| 6 | Movie VC reconciliation | inline (per-guild loop) |
| 7 | Game VC reconciliation | inline (per-guild loop) |
| 8 | Channel cache sync | inline (per-guild loop) |
| 9 | Patreon role dedup sweep | inline |
| 10 | Invite cache init | inline |
| 11 | Open modmail thread hydration | inline |
| 12 | Modmail retrofit (legacy parent overwrites) | inline |
| 13 | Review card refresh | inline |
| 14 | Gate entry panel refresh | inline (per-guild loop with 250ms pacing) |
| 15 | Optional thread migration (env-gated) | inline |
| 16 | Logging channel verification | inline |
| 17 | Web servers (status endpoint + dashboard API) | `src/startup/web.ts::startWebServers` |
| 18 | Schedulers (eight recurring jobs) | `src/startup/schedulers.ts::startSchedulers` |
| 19 | Banner sync | inline |
| 20 | Graceful shutdown handlers | inline (sets up SIGTERM/SIGINT listeners) |
| 21 | Bot presence restore from DB | inline |
| 22 | Owner ID + interaction tracing log | inline |
| 23 | Dev-only legacy SQL dist scan | inline (skipped in production / vitest) |
| 24 | Question-stats summary log | inline |
| 25 | Per-guild slash command sync | `src/commands/sync.ts::syncCommandsToAllGuilds` |
| 26 | Pending ticket attachment backfill | inline |

The order has been preserved 1:1 across the recent extraction. If you reorder, document the change here and in the `runSchemaSelfHeal` etc. modules.

## Drift guard

Before `ClientReady` fires, `src/index.ts` runs an immediate startup-time assertion: every name in `SLASH_COMMAND_NAMES` (from `src/commands/runtimeManifest.ts`) must be present in the runtime `commands` Collection, and vice versa. If the two are out of sync, startup throws and the bot refuses to come up. See `docs/reference/command-registration-invariants.md`.

## Graceful shutdown

`gracefulShutdown(signal)` is wired to both `SIGTERM` and `SIGINT`. It runs in this order:

1. Persist movie sessions; stop session persistence.
2. Persist game sessions; stop session persistence.
3. Stop web servers (`stopWebServers` from `src/startup/web.ts`).
4. Stop schedulers (`stopSchedulers` from `src/startup/schedulers.ts`).
5. Flush message activity buffer.
6. Cleanup banner sync listeners.
7. Cleanup notify limiter.
8. Cleanup flag cooldowns.
9. Cleanup stats rate limiter.
10. Close all open voice sessions.
11. `client.removeAllListeners()`.
12. `client.destroy()` (closes websocket).
13. `db.close()`.
14. `process.exit(0)`.

Each step has its own try/catch so a single failure does not block the rest. The outer try/catch logs at error level and exits with code 1 if anything escapes.

`isShuttingDown` is a guard against re-entry — if a second signal arrives before exit, the second call logs and returns immediately.

## Where new startup work should live

- A new schema column → migration first; ensure helper only if backward-compat with legacy DBs is needed (see `docs/reference/database-schema-safety.md`).
- A new scheduler → add to `src/startup/schedulers.ts` (`startSchedulers` and `stopSchedulers`).
- A new web service → add to `src/startup/web.ts`.
- A one-shot recovery hook → for now, inline in `index.ts` ClientReady. Future work may extract `src/startup/recovery.ts` to flatten the remaining 18 inline blocks.
- A new graceful-shutdown action → add to the numbered list inside `gracefulShutdown` with its own try/catch.

## Why we did not extract everything

Most of the inline ClientReady steps are short, distinct one-shots that touch unrelated subsystems (panic state, voice sessions, modmail, gate panels, presence). Bundling them into a single `runRecoveryHooks()` would obscure why each runs and in what order. The decision was: extract the cohesive groups (schema, schedulers, web, shutdown) and leave the heterogeneous one-shots inline behind clear comments.
