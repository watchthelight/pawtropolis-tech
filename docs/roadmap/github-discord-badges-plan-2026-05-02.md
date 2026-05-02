# GitHub Discord Badge System; Plan (2026-05-02)

Branch: `feature/github-discord-badges-docs`
Author: watchthelight
Status: Draft

## Problem statement

GitHub Markdown cannot render Discord mention syntax. Strings like
`<@&1388676461657063505>`, `<#1446602187655610461>`, and `<@123>` show up as raw text
in our docs (README, BOT-HANDBOOK, MOD-QUICKREF, MOD-HANDBOOK). They look broken,
they leak unfriendly numeric IDs, and they obscure the actual role or channel name.

Goal: render Discord roles, channels, users, and configured custom labels as
GitHub-compatible Markdown badges that visually resemble Discord mentions, use the
real names and role colors, and stay current via daily refresh.

## Why GitHub cannot render Discord mentions directly

- GitHub Markdown does not interpret `<@&id>` / `<#id>` / `<@id>` syntax.
- GitHub strips most inline HTML; SVG via `<img>` is the only widely supported
  way to embed scripted graphics, and GitHub also proxies images through Camo
  which forbids scripts and external resources inside SVG.
- We therefore generate static, self-contained, sanitized SVG pills hosted on
  our own status server and reference them from Markdown as `![alt](url.svg)`.

## Architecture

```
Discord (roles/channels/users)
  -> badgeRefreshScheduler (daily; on-demand)
  -> features/badges/resolve.ts (resolve names/colors)
  -> features/badges/store.ts (persist manifest + generated SVG)
  -> features/badges/renderSvg.ts (render pill SVG)
  -> web/badgeEndpoint.ts (serve /badges/:id.svg + /api/badges/manifest.json)
  -> GitHub Markdown ![Movie Tier 1](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/movie-tier-1.svg)
```

New modules:
- `src/features/badges/types.ts`
- `src/features/badges/registry.ts`         (static badge definitions)
- `src/features/badges/resolve.ts`          (Discord -> ResolvedBadge)
- `src/features/badges/renderSvg.ts`        (SVG pill renderer)
- `src/features/badges/svgEscape.ts`        (XML-safe text escaping)
- `src/features/badges/color.ts`            (hex + contrast helpers)
- `src/features/badges/store.ts`            (manifest IO + SVG IO)
- `src/features/badges/index.ts`            (public surface)
- `src/web/badgeEndpoint.ts`                (Fastify routes; mounted on dashboard API)
- `src/scheduler/badgeRefreshScheduler.ts`  (daily refresh)
- `scripts/generate-badges.ts`              (offline regen helper)

## URL scheme

Public badge base URL: `https://status.pawtropolis.tech` (configurable via
`PUBLIC_BADGE_BASE_URL`).

- `GET /badges/:badgeId.svg`             registry-driven, public, cacheable
- `GET /badges/roles/:roleId.svg`        direct Discord ID; off by default
- `GET /badges/channels/:channelId.svg`  direct Discord ID; off by default
- `GET /badges/users/:userId.svg`        direct Discord ID; off by default
- `GET /api/badges/manifest.json`        list of registered badges + metadata
- `GET /api/badges/health`               quick liveness JSON

Direct ID routes are gated behind `BADGE_ALLOW_DIRECT_DISCORD_ID_ROUTES=true` so
arbitrary callers cannot enumerate guild roles/channels by guessing IDs.

## Data model

```ts
type BadgeKind = "role" | "channel" | "user" | "custom";
type BadgeStyle =
  | "discord-role" | "discord-channel" | "discord-user"
  | "discord-custom" | "compact" | "shield";

type BadgeDefinition = {
  id: string; guildId: string; kind: BadgeKind;
  discordId?: string; label?: string; suffix?: string;
  style: BadgeStyle; linkUrl?: string; enabled: boolean;
};

type ResolvedBadge = {
  id: string; kind: BadgeKind; guildId: string; discordId?: string;
  displayName: string; prefix: "@" | "#" | "";
  suffix?: string;
  colorHex: string; backgroundHex: string; foregroundHex: string;
  linkUrl?: string;
  stale: boolean; resolvedAt: string;
};
```

Persistence:
- A manifest file at `data/badges/manifest.json` lists every registered badge
  with last-resolved metadata; this is the source of truth for the web layer.
- Pre-rendered SVGs at `data/badges/generated/<id>.svg` are written on refresh
  and re-rendered on demand at request time if missing.
- The on-disk artifacts are gitignored runtime data; the registry is checked in.

## Rendering strategy

- Self-contained SVG, no external fonts, no scripts, no external URLs.
- Discord-pill geometry: rounded rect, ~22px tall, padding 8/6, prefix glyph
  inside a tinted background, name in white-or-black depending on contrast,
  optional suffix segment with a subtle separator.
- Width derived from a deterministic per-character width estimate so the SVG
  has stable dimensions without measuring fonts.
- Stale badges render in a muted gray with the `displayName` if known, else
  `unknown <kind>`.
- All text passes through `svgEscape.ts`; no raw user input is interpolated.

## Refresh strategy

- `badgeRefreshScheduler` runs every `BADGE_REFRESH_INTERVAL_HOURS` (default 24).
- On bot ready, an initial refresh is scheduled (delayed) so we do not block
  startup.
- For each registered badge:
  - Fetch the Discord entity (role, channel, user) via the live client.
  - On success: update name/color, clear stale flag, write SVG + manifest.
  - On failure: keep prior cached values, set `stale = true`, log a warn-level
    structured event, continue with the next badge.
- The scheduler exposes `refreshAllBadges(client)` for tests and a future
  `/badges refresh` admin command.

## Documentation migration strategy

Pass 1 (this branch):
- Replace raw `<@&...>` / `<#...>` mentions in `docs/MOD-QUICKREF.md`,
  `docs/MOD-HANDBOOK.md`, `docs/BOT-HANDBOOK.md` with badge image references.
- Leave intentional examples that teach Discord mention syntax inside fenced
  code blocks; add an allowlist in the docs guard test.
- Add a new reference page `docs/reference/github-discord-badges.md` and a
  short style guide `docs/reference/documentation-badge-style-guide.md`.
- Add an operations page `docs/operations/badge-refresh.md` and an
  architecture page `docs/architecture/badge-system.md`.

Pass 2 (later, optional): migrate `docs-audit/` artifacts. Out of scope here
since those are dated audit snapshots, not living docs.

## Testing strategy

- Unit tests for SVG escape, color contrast, and renderer output shape.
- Registry: known badges resolve to expected definitions, no duplicates.
- Store: manifest read/write round-trip, atomic-ish writes, file path
  sanitization rejects traversal.
- Resolve: mocks Discord client; verifies stale-on-failure and color extraction.
- Endpoint: serves SVG with correct `Content-Type`, returns fallback SVG for
  unknown registry IDs, returns 404 JSON for unknown manifest entries on the
  JSON API, refuses direct ID routes when the gate is off.
- Scheduler: refresh marks bad fetches stale, writes SVG for good fetches.
- Docs guard: fails on any new raw `<@&...>` or `<#...>` outside the allowlist.
- No tests touch real Discord, real network, real Sentry, real PM2, real prod DB.

## Files likely to change

Code (new):
- `src/features/badges/*`, `src/web/badgeEndpoint.ts`,
  `src/scheduler/badgeRefreshScheduler.ts`, `scripts/generate-badges.ts`.

Code (touched):
- `src/lib/env.ts` (new env vars)
- `src/startup/web.ts` (mount badge routes on dashboard API)
- `src/startup/schedulers.ts` (start/stop badge refresh)
- `.env.example`, `.gitignore`

Docs (touched):
- `README.md`, `CHANGELOG.md`, `TODO.md`,
  `docs/BOT-HANDBOOK.md`, `docs/MOD-QUICKREF.md`, `docs/MOD-HANDBOOK.md`
- new docs under `docs/reference/`, `docs/operations/`, `docs/architecture/`.

## Backward compatibility

- Status endpoint behavior unchanged.
- Dashboard API routes unchanged; we add new routes under `/badges` and
  `/api/badges/*`.
- Schedulers list grows by one entry; existing schedulers untouched.
- Env defaults make local dev work without any new variables.

## Failure and fallback behavior

- Missing entity at refresh: keep last cache, mark stale, log warn.
- Missing on-disk SVG at request: render on-the-fly from manifest; if manifest
  also missing, return a generic "unknown badge" SVG (200) for image routes
  and `{ error: "unknown_badge" }` JSON for the manifest API (404).
- Discord client not ready: refresh is skipped with a warn-level log.

## Security considerations

- All text rendered into SVG passes through `svgEscape`.
- File paths derived from badge IDs are validated with a strict allowlist
  (`/^[a-z0-9][a-z0-9_-]{0,63}$/`); no traversal possible.
- Direct Discord ID routes default to off so the public cannot enumerate
  arbitrary guild roles by guessing IDs.
- No secrets are read or logged in the badge subsystem.
- SVGs contain no `<script>`, no external `<image>` references, no foreign DOM.

## Cache behavior

- `Content-Type: image/svg+xml; charset=utf-8`.
- `Cache-Control: public, max-age=3600` for badge SVGs.
- Optional `ETag` derived from SVG sha256 for conditional GETs.
- GitHub Camo will cache aggressively; we accept up to a day of staleness as a
  consequence and document it.

## Definition of done

- Renderer + registry + endpoint compile and have tests.
- Scheduler is wired into startup and graceful shutdown.
- README explains the system in a paragraph.
- `docs/MOD-QUICKREF.md` and `docs/BOT-HANDBOOK.md` movie/game tier sections
  use badges instead of raw mentions.
- A docs guard test fails if a new raw mention appears outside the allowlist.
- `npm run typecheck` and `npm test` are green for the new code.
