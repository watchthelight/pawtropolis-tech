# Stats Observatory: operations

The public stats page at `https://pawtropolis.tech/observatory` is a zero-JavaScript,
server-rendered page that reads ONLY precomputed rollup tables. All heavy aggregation
happens out of band in a refresh script, so the page render is a handful of small
indexed reads and is trivially cacheable.

See `docs/stats-observatory/design-brief.md` for the metric catalog and the rationale.

## One-click update

The page shows whatever is in the rollup tables. To recompute the rollups from the
live bot data and publish them:

```bash
npm run stats:refresh && ./deploy.sh --web
```

- `npm run stats:refresh` runs `scripts/refresh-public-stats.ts` for the configured
  `GUILD_ID`, rebuilding all ten rollup tables in a single transaction (well under a
  second on the prod DB). It needs only `DB_PATH` and `GUILD_ID` in the environment.
- `./deploy.sh --web` ships the web process. This is only needed when the page code
  changed; if only the data changed, the next request picks up fresh rollups after the
  page cache window (`public, max-age=300`) elapses, so a bare `npm run stats:refresh`
  on the box is enough to refresh the numbers.

### Keeping it live (optional cron)

The rollups are a snapshot. To keep the page fresh without manual runs, schedule the
refresh on EC2 every 15 minutes (the guild snapshot and online estimates only update on
that cadence, so faster buys nothing):

```cron
*/15 * * * * cd /home/ubuntu/pawtropolis-tech && /usr/bin/npm run stats:refresh >> /var/log/pawtropolis/stats-refresh.log 2>&1
```

## Architecture

| Piece | Path | Notes |
| --- | --- | --- |
| Rollup schema | `migrations/078_public_stats_rollups.ts` | Ten additive tables. Mirrored into `tests/fixtures/schema.sql`. |
| Refresh logic | `src/features/statsObservatory/refresh.ts` | `refreshPublicStats(db, guildId, nowS)`. Pure, testable, idempotent. |
| Refresh CLI | `scripts/refresh-public-stats.ts` | Thin wrapper; opens its own writable connection. |
| Read layer | `web/src/lib/server/queries/observatory.ts` | Reads ONLY rollup tables. No raw-table access at request time. |
| Page | `web/src/routes/observatory/+page.{server.ts,svelte}` | `csr=false` (zero hydration), public, hard-cached. |
| Theme | `web/src/lib/styles/observatory.css` | Fixed "Observatory" night-sky theme, hardcoded tokens, no `var(--hue)` inheritance. |
| Charts | `web/src/lib/components/observatory/*.svelte` | Server-rendered SVG and pure CSS. No client JS, no chart library. |

## Correctness rules baked into the refresh

These are load-bearing; do not change without re-reading the brief:

- Moderation decisions come from `action_log` terminal verbs only
  (`approve`, `reject` + `perm_reject`, `kick`). Never union `review_action`: the bot
  dual-writes and a union double-counts every decision.
- Voice minutes cap each session at 6 hours, so a session whose `left_at_s` was swept to
  "now" on a bot restart cannot inflate a day.
- Response-time p50/p95 come from the precomputed `mod_metrics` table.
- Reactions are scoped to the guild by joining `messages_archive` (the
  `message_reactions_archive` table has no `guild_id`).
- Moderator identities are anonymized to `Mod A/B/C` for the public page; the real
  `moderator_id` never reaches the rendered HTML.
- All times are UTC. `online_count` is never shown as a precise number (it is a coarse
  ~30-minute estimate); `member_count` is the exact figure.

## Performance

Measured on the production build (Chrome DevTools trace, desktop, no throttling):

- Network: 3 requests total (1 HTML document + 2 CSS). Zero scripts, zero web fonts,
  zero images.
- LCP about 116 ms, CLS 0.00, no INP (the page has no interactivity).
- The route ships no client JavaScript: `csr=false` disables hydration, and the
  site-wide inline theme-preference script in `app.html` is stripped for `/observatory`
  by a guarded `transformPageChunk` in `web/src/hooks.server.ts`.

Production nginx should serve the HTML with gzip/brotli (the document is highly
compressible; about 76 kB of the ~113 kB uncompressed HTML is recoverable).

## Production prerequisite

The page reads the migration-078 rollup tables. If those tables do not yet exist in the
production database (migration 078 not applied), `getObservatoryData` throws, the load
catches it, and the page renders its graceful empty state ("The sky is clear for now")
rather than crashing. Applying migration 078 in production depends on the prod migration
runner being unblocked (see `todo/00046.md`). Once 078 is applied and the first
`stats:refresh` has run, the page populates.

## Local preview

To preview the populated page locally, point the web build at a DB that has the rollup
tables seeded, with `DB_PATH` and `GUILD_ID` set, then `npm --prefix web run preview`.
Note: the native `better-sqlite3` binding under `web/node_modules` may not match the
local Node ABI on a dev box; if `node web/build/index.js` throws `ERR_DLOPEN_FAILED`,
copy the working binary from the root install
(`node_modules/better-sqlite3/build/Release/better_sqlite3.node`). This does not affect
production, where the web process loads the binding normally.
