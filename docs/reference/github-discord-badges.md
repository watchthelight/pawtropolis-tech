# GitHub Discord Badges

Pawtropolis Tech renders Discord roles, channels, and users as
GitHub-compatible Markdown badges. They look like Discord mention pills,
use the real role color, and refresh daily from the live server.

## Why we need them

GitHub Markdown does not understand Discord mention syntax. Strings like
`<@&1388676461657063505>`, `<#1446602187655610461>`, and `<@123>` show up as
raw text. Worse, they leak Discord IDs and hide the actual name. The badge
system replaces them with `![alt](https://status.pawtropolis.tech/badges/<id>.svg)`.

## How it works

```
Discord (roles/channels/users)
  -> badgeRefreshScheduler        (daily)
  -> features/badges/resolve.ts   (resolve names + role colors)
  -> features/badges/renderSvg.ts (render pill SVG)
  -> features/badges/store.ts     (write data/badges/generated/<id>.svg)
  -> web/badgeEndpoint.ts         (serve /badges/<id>.svg + manifest)
  -> GitHub Markdown              (![alt](url))
```

The bot does the rendering. The badge HTTP server hosts the SVG. GitHub
embeds the SVG via `<img>`. No external services are involved.

## Embedding a badge

Use the registry id as the file name:

```markdown
![@Red Carpet Guest - 1+ movies](https://status.pawtropolis.tech/badges/movie-tier-1.svg)
```

Examples:
- ![@Red Carpet Guest - 1+ movies](https://status.pawtropolis.tech/badges/movie-tier-1.svg)
- ![@Popcorn Club - 5+ movies](https://status.pawtropolis.tech/badges/movie-tier-2.svg)
- ![@Director's Cut - 10+ movies](https://status.pawtropolis.tech/badges/movie-tier-3.svg)
- ![@Cinematic Royalty - 20+ movies](https://status.pawtropolis.tech/badges/movie-tier-4.svg)
- ![@Server Artist](https://status.pawtropolis.tech/badges/role-server-artist.svg)
- ![#「✍️」writing](https://status.pawtropolis.tech/badges/channel-writing.svg)

## URL scheme

| Route | Purpose | Notes |
|-------|---------|-------|
| `GET /badges/<id>.svg` | Registry-driven badge | Public, cacheable |
| `GET /api/badges/manifest.json` | All known badges | Public JSON |
| `GET /api/badges/health` | Liveness check | Public JSON |
| `GET /badges/roles/<roleId>.svg` | Direct role lookup | Off by default |
| `GET /badges/channels/<channelId>.svg` | Direct channel lookup | Off by default |
| `GET /badges/users/<userId>.svg` | Direct user lookup | Off by default |

Direct ID routes are off unless `BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES=true`
so the public cannot enumerate guild roles by guessing IDs.

## Refresh cadence

The badge refresh scheduler runs every `BADGE_REFRESH_INTERVAL_HOURS` (default
24). On boot, an initial refresh is delayed 60 seconds so we do not block
startup. If a Discord fetch fails, the prior cached value is kept and the
badge is marked `stale`; the SVG renders in muted gray instead of the role
color.

## Adding a new badge

1. Open `src/features/badges/registry.ts`.
2. Add a `BadgeDefinition` to the relevant block (movie tier, channel, etc.).
3. Pick a stable kebab-style id (matches `^[a-z0-9][a-z0-9_-]{0,63}$`).
4. Run `npx tsx scripts/generate-badges.ts --list` to confirm it shows up.
5. Reference the badge in docs as
   `![alt](https://status.pawtropolis.tech/badges/<id>.svg)`.

## Regenerating badges manually

Daily refresh is automatic. To force a refresh from a workstation:

```bash
npx tsx scripts/generate-badges.ts        # refresh all
npx tsx scripts/generate-badges.ts --list # list registry only
npx tsx scripts/generate-badges.ts --id movie-tier-1
```

## Troubleshooting

- **Badge shows in muted gray**: marked stale; the last Discord fetch
  failed. Check bot logs for `badge_resolve_fallback`.
- **Wrong name or color**: the role was renamed or recolored. Wait for the
  next daily refresh, or run `scripts/generate-badges.ts`.
- **Image not loading on GitHub**: GitHub proxies images through Camo and
  caches aggressively. Force a refresh by appending a query string in your
  Markdown (`?v=2`).
- **404 on a direct ID route**: the gate is off by default. Enable with
  `BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES=true` only if you know what you are
  exposing.
