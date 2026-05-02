# Badge System Architecture

## Modules

| Module | Responsibility |
|--------|----------------|
| `src/features/badges/types.ts` | Shared type definitions. |
| `src/features/badges/registry.ts` | Static, checked-in list of badges. |
| `src/features/badges/color.ts` | Hex parsing, contrast, role tinting. |
| `src/features/badges/svgEscape.ts` | XML-safe text + safe-id pattern. |
| `src/features/badges/renderSvg.ts` | SVG pill renderer (no scripts, no fonts). |
| `src/features/badges/resolve.ts` | Discord lookup -> ResolvedBadge. |
| `src/features/badges/store.ts` | Manifest + generated SVG IO. |
| `src/web/badgeEndpoint.ts` | Public HTTP server (default port 3004). |
| `src/scheduler/badgeRefreshScheduler.ts` | Daily refresh loop. |

## Data flow

```
Discord guild
  -> resolveBadge(definition, { client, guildId, prior })
    -> fetch role / channel / user via discord.js
    -> on success: build ResolvedBadge with fresh name + color
    -> on failure: clone the prior cache, set stale=true
  -> renderBadgeSvg(entry)
    -> svgEscape(text), pill geometry, stale variant
  -> writeBadgeSvg / writeManifest
GitHub
  <- /badges/<id>.svg (cached SVG file, 1h Cache-Control)
  <- /api/badges/manifest.json (full registry state)
```

## Persistence

- Manifest: `data/badges/manifest.json`, JSON, schema version 1, atomic
  rename on write.
- Per-badge SVGs: `data/badges/generated/<id>.svg`, atomic rename, traversal
  blocked by `isSafeBadgeId` and `safePathJoin`.
- All paths sit under `/data`, which is gitignored.

## Failure modes

| Failure | Behavior |
|---------|----------|
| Guild not in cache and fetch throws | Prior cache kept; badge marked stale. |
| Role missing | Prior cache kept; stale. |
| Manifest write fails | Logged at error level; SVGs still on disk. |
| SVG write fails | Logged at warn level; manifest still updated. |
| Bot not ready at refresh | Refresh skipped with a warn log. |
| Endpoint disabled | Scheduler still runs; manifest stays current. |

## Security

- All Discord input passes through `svgEscape` before reaching SVG output.
- Badge ids are restricted to `^[a-z0-9][a-z0-9_-]{0,63}$` and validated
  before any filesystem use.
- Generated paths are re-checked against the configured generated dir to
  refuse traversal attempts.
- SVGs contain no `<script>`, no external `<image>`, no remote font
  imports, and no foreign DOM. Safe under GitHub's Camo image proxy.
- Direct Discord ID routes are gated off by default to avoid leaking the
  guild structure.

## Wiring

- Started in `src/startup/web.ts` via `runStartupTask("web_badge_endpoint", ...)`.
- Stopped in `src/startup/web.ts:stopWebServers` alongside the dashboard
  API.
- Refresh scheduler is added to `src/startup/schedulers.ts` as
  `scheduler_badge_refresh` (start) and the matching stop call.

## Testing

- Unit tests cover SVG escape, color contrast, renderer output shape,
  registry uniqueness, store traversal safety.
- Endpoint tests exercise health, manifest, registry SVG, fallback,
  direct-id gating, and ETag handling.
- Scheduler tests use a mocked Discord client to assert success and
  fallback paths.
- Docs guard test scans every checked-in `.md` for raw mention syntax.
- No tests touch real Discord, real Sentry, real PM2, or real production
  databases.
