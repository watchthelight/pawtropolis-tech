# GitHub Discord Badges

Pawtropolis Tech renders Discord roles, channels, and users as
GitHub-compatible Markdown badges. They look like Discord mention pills,
use the real role color, and refresh daily from the live server.

## Why we need them

GitHub Markdown does not understand Discord mention syntax. Strings like
`<@&1388676461657063505>`, `<#1446602187655610461>`, and `<@123>` show up as
raw text. Worse, they leak Discord IDs and hide the actual name. The badge
system replaces them with `![alt](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/<id>.svg)`.

## How it works

```
Live server snapshot (docs/internal-info/ROLES.md, CHANNELS.md)
  -> scripts/generate-badges.ts --from-snapshot
  -> features/badges/snapshotResolve.ts (resolve names + colors offline)
  -> features/badges/renderSvg.ts       (render pill SVG)
  -> docs/badges/svg/<id>.svg            (committed to repo)
  -> GitHub Markdown                     (![alt](raw URL))

In parallel, the running bot:
  -> features/badges/resolve.ts          (live Discord lookup)
  -> features/badges/liveUpdates.ts      (event-driven refresh)
  -> data/badges/generated/<id>.svg      (runtime cache)
  -> web/badgeEndpoint.ts                (serves status.pawtropolis.tech)
```

Two URLs serve the same content:

- **Canonical for docs (recommended):**
  `https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/<id>.svg`
  Renders on GitHub immediately when committed; no infra required.
- **Live fallback for non-GitHub consumers:**
  `https://status.pawtropolis.tech/badges/<id>.svg`
  Served by the bot's HTTP endpoint; reflects the bot's runtime cache.

## Embedding a badge

Use the registry id as the file name:

```markdown
![@Red Carpet Guest - 1+ movies](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/movie-tier-1.svg?v=bc6a0468)
```

Examples:
- ![@Red Carpet Guest - 1+ movies](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/movie-tier-1.svg?v=bc6a0468)
- ![@Popcorn Club - 5+ movies](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/movie-tier-2.svg?v=87441842)
- ![@Director's Cut - 10+ movies](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/movie-tier-3.svg?v=2aeb1605)
- ![@Cinematic Royalty - 20+ movies](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/movie-tier-4.svg?v=a14bc801)
- ![@Server Artist](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/role-server-artist.svg?v=e0398b83)
- ![#「✍️」writing](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/channel-writing.svg?v=69f5397e)
- ![@Holographic](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/role-holographic.svg?v=94efddd4) (animated gradient shimmer)

## Gradient + holographic roles

Discord 2024 added two/three-stop gradient roles (Nitro feature) and the
"Holographic" role effect. The renderer supports both:

- **Gradient roles**: `BadgeDefinition.gradient = { primary, secondary, tertiary? }`.
  The pill background and text use a `<linearGradient>` with the role's
  configured stops. Live refresh reads `role.colors.{primary,secondary,tertiary}`
  from discord.js when the API exposes them.
- **Holographic shimmer**: set `holographic: true` on the definition. The
  SVG embeds SMIL `<animate>` elements that pan the gradient endpoints,
  producing a continuous iridescent shimmer. No scripts; safe under
  GitHub's image proxy.

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
   `![alt](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/<id>.svg)`.

## Regenerating badges manually

Daily refresh is automatic (bot scheduler, GitHub Actions). To force a
refresh from a workstation:

```bash
# offline; reads docs/internal-info/ROLES.md + CHANNELS.md, no Discord login
npx tsx scripts/generate-badges.ts --from-snapshot

# live; requires DISCORD_TOKEN + GUILD_ID, refreshes runtime cache
npx tsx scripts/generate-badges.ts

# inspection-only
npx tsx scripts/generate-badges.ts --list
npx tsx scripts/generate-badges.ts --id movie-tier-1
```

After `--from-snapshot`, commit `docs/badges/svg/*.svg` and push; jsdelivr
picks up the change within minutes.

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
