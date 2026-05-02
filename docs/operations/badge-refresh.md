# Badge Refresh Operations

The badge refresh scheduler keeps the rendered SVGs in sync with live
Discord data.

## Default behavior

- Runs every `BADGE_REFRESH_INTERVAL_HOURS` (default 24).
- On bot ready, an initial refresh is queued 60 seconds later so startup
  is not blocked.
- Per-badge errors are caught inside `resolveBadge`. The scheduler never
  crashes the bot.
- Pacing: 50ms between badges to avoid hammering the Discord API.

## Forcing a refresh

From a workstation with `.env` configured:

```bash
npx tsx scripts/generate-badges.ts          # refresh every registered badge
npx tsx scripts/generate-badges.ts --id movie-tier-1
npx tsx scripts/generate-badges.ts --list   # print registry without refreshing
npx tsx scripts/generate-badges.ts --dry-run
```

The script reuses `refreshAllBadges`; output mirrors the scheduler.

## Logs

The scheduler emits structured `evt` fields:

| Event | Meaning |
|-------|---------|
| `badge_scheduler_started` | Initial cadence configured. |
| `badge_resolve_fallback` | Per-badge resolve failure; prior cache kept. |
| `badge_resolve_error` | Resolver threw; treated as stale. |
| `badge_write_failed` | Could not write the SVG file. |
| `badge_manifest_write_failed` | Could not write `manifest.json`. |
| `badge_refresh_done` | Summary: resolved + stale counters. |

Look for these in the pino log stream.

## Files written

- `data/badges/generated/<id>.svg` - one SVG per registered badge.
- `data/badges/manifest.json` - source of truth for what we know about
  every badge.

Both paths are gitignored under `/data/`. The SVGs can be deleted at any
time and will be re-rendered on the next refresh or on demand at request
time.

## Disabling the public endpoint

Set `BADGE_ENDPOINT_ENABLED=false` to skip starting the badge HTTP server.
The scheduler still runs and updates the manifest, so docs continue to be
correct as soon as the endpoint is re-enabled.

## Toggling direct ID routes

Direct routes (`/badges/roles/:id.svg`, `/badges/channels/:id.svg`,
`/badges/users/:id.svg`) are off by default. Set
`BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES=true` only if there is a clear
reason to expose them publicly. They allow callers to look up any role or
channel ID, which leaks structure of the guild.
