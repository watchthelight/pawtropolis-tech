# Phase 0 Design Brief: Public Zero-JS Stats Page

## 1. Goal and constraints

Build a PUBLIC, server-side-rendered stats page for the Pawtropolis community. Hard constraints:

- Zero client JavaScript. No hydration, no JS chart libraries.
- Charts are server-rendered SVG (computed in the load layer, emitted as static markup) or pure CSS (grids, width-driven bars, opacity heat).
- The page reads ONLY precomputed rollup tables. It never touches raw tables (message_activity, voice_session, action_log, etc.) at request time.
- Rollups are refreshed out-of-band on a schedule.
- Aesthetic: "indie game feel", not generic SaaS. All times UTC.

This brief is the primary artifact. It is grounded in verification of the actual repo, not just the candidate catalog. Several catalog metrics were dropped and several missing metrics were added based on what the schema and bot code actually support.

## 2. Ground truth verified against the repo

Before converging, the following load-bearing facts were checked in code (not assumed):

1. guild_snapshot_log is written by the snapshot scheduler with `ON CONFLICT (guild_id, date)` upsert: exactly one row per guild per UTC day, member_count exact. This is the cleanest precomputed source in the whole schema and is the natural hero.
2. message_reactions_archive is LIVE and indexed (idx_react_emoji, idx_react_user) with an emoji column. Reaction metrics are real and cheap. This was the catalog's biggest miss.
3. active_byte_multipliers is a SNAPSHOT, not a log. byteMultiplierStore upserts one row per (guild_id, user_id) and the scheduler DELETEs expired rows. There is no per-day history. All four candidate byte-multiplier time-series metrics are physically impossible and are dropped.
4. general_messages_resonance and friends have NO live bot writer: they are populated only by an offline scripts/*.mjs ML pipeline against a backfilled corpus. In normal prod they are stale or empty. Both resonance metrics are dropped from v1.
5. The existing production stats query layer reads application decisions from action_log (`FROM action_log ... action IN ('approve','reject','perm_reject','kick')` and `action = 'claim'`, `action = 'app_submitted'`), NOT from review_action. action_log is therefore the codebase-canonical decision source. The bot dual-writes decisions to both tables, so a rollup must pick ONE (action_log) or it double-counts every decision.
6. The existing HeatmapGrid.svelte component is NOT zero-JS. It imports prefersReducedMotion, uses Svelte runes ($state, $derived), and binds mouse/touch handlers for tooltips. The cell coloring itself is CSS opacity, but the component as written ships client JS. The public heatmap must be a fresh static server-rendered CSS grid (grid container plus inline opacity per cell, no handlers).
7. voice_session dangling sessions are swept on bot shutdown by setting left_at_s = now (closeAllStmt: `UPDATE voice_session SET left_at_s = ? WHERE left_at_s IS NULL`). Any session spanning a restart gets an artificially long duration, so daily voice-minute sums spike around deploys unless guarded.
8. mod_metrics already stores precomputed p50_response_time_s and p95_response_time_s per moderator. The response-time metric should read these, not reconstruct latency from review_claim (which holds only currently-open claims, app_id PRIMARY KEY).
9. The cache layer ships CACHE_HEADERS.default = "private, max-age=60, ...". The public page must override this to a PUBLIC cache header.
10. There is no (public) route group today: every existing +page.server.ts gates on hasMinTier. The new route must simply omit that check and scope to the public GUILD_ID env.

## 3. Information architecture

Recommended direction: Hero metric then progressive drill-downs (the BMAD recommendation), adjusted for the verification above. A first-time visitor gets an instant "is this place alive" answer and can stop; an operator keeps scrolling into detail. The "hero then sections" shape already exists in the repo (splash hero, handbook landing), so it inherits the established public voice and minimizes design risk. It also maps onto the cheapest renders: a static CSS heatmap and CSS-width bars carry the page, with hand-built server SVG reserved for the hero area and a few trend lines.

Sections, top to bottom:

### Hero: "Is this community alive and growing?"
- Daily Member Count Trend as a full-width server-rendered SVG area (about 90 days).
- One giant current-member number plus a net-growth delta badge ("4,210 members, +128 this month").
- Reads only daily_metrics.

### Summary band: the executive line
Four to five KPI cards, each a single precomputed value. De-duped: these numbers do NOT reappear as drill-band headers.
- Net joins minus leaves (30d)
- Messages (7d) with a WoW up/down arrow
- Daily active authors (DAU, latest day)
- Application approval rate (window)
- Median decision time (p50, from mod_metrics)

### Drill 1: Membership and Retention
- Daily Joins vs Leaves (server-SVG diverging bars)
- Cumulative Net Growth (server-SVG area)
- Member Tenure Distribution (CSS-width horizontal bars)
- Cohort Retention Curve (pure-CSS stacked table, opacity = retention %)

### Drill 2: When the city is awake (Activity)
- Hour-of-Day x Day-of-Week Heatmap (STATIC CSS grid, 7x24, inline opacity) - the visual centerpiece
- Daily Message Volume (server-SVG area, 90d)
- Daily Active Authors / DAU line (server-SVG, same window)
- Top 5 Channels by message share (CSS-width bars plus "other")

### Drill 3: Community life (Voice, Events, Engagement)
- Daily Voice Minutes (server-SVG area, restart-spanning sessions excluded)
- Movie/Game Night participation per event (CSS-width bars, qualified count)
- QOTD Funnel: submitted vs approved vs used per week (CSS stacked bars)
- Top Reactions by Emoji (CSS-width horizontal-bar leaderboard)

### Drill 4: Who keeps the gate (Moderation transparency)
Framed as transparency. Moderator names anonymized by default (see open decisions).
- Decision Mix: approve vs reject (perm_reject folded in) vs kick (donut/stacked, terminal verbs only, from action_log)
- Daily Decisions Volume (server-SVG area)
- Response Time p50/p95 (CSS sparkline-grid, from mod_metrics)
- Per-Moderator Accepts leaderboard (CSS-width bars, anonymized or opt-in)

### Footer: provenance
- "Data as of <date>, all times UTC"
- Link back to the main site / handbook

## 4. v1 chart set (14 metrics)

All 14 are high-signal, visually striking, and precompute cleanly into the rollup tables in section 5.

1. Daily Member Count Trend (HERO) - server-SVG area - src: guild_snapshot_log
2. Daily Joins vs Leaves - server-SVG diverging bars - src: user_activity
3. Cumulative Net Growth - server-SVG area - src: user_activity, guild_snapshot_log
4. Member Tenure Distribution - CSS-width h-bar - src: user_activity
5. Cohort Retention Curve - CSS stacked table - src: user_activity
6. Hour x Day Heatmap - static CSS grid - src: message_activity
7. Daily Message Volume - server-SVG area - src: message_activity
8. Daily Active Authors (DAU/WAU) - server-SVG line - src: message_activity (ADDED: top community-health metric, was absent)
9. Top Channels by Share - CSS-width h-bar - src: message_activity, channel_cache
10. Daily Voice Minutes - server-SVG area - src: voice_session (restart-guarded)
11. Movie/Game Night Participation - CSS-width h-bar - src: movie_attendance (count, not rate)
12. QOTD Funnel - CSS stacked bars - src: qotd_suggestion
13. Top Reactions by Emoji - CSS-width h-bar - src: message_reactions_archive (ADDED: live data, real engagement)
14. Decision Mix + Daily Decisions Volume + Response p50/p95 + Accepts leaderboard - donut/stacked + server-SVG + CSS bars - src: action_log, mod_metrics (the moderation transparency block)

### Dropped from the catalog (with reasons)
- All 4 active_byte_multipliers metrics: snapshot table, no per-day history. Impossible as time series.
- Both message-resonance metrics: offline-only ML pipeline, no live writer, stale in prod.
- Peak Concurrent Voice Users per hour: requires sweep-line interval-overlap, does not precompute into daily GROUP BYs. Cheap proxy if ever wanted: guild_snapshot_log.voice_users_now (sampled every 5 min).
- Movie "Attendance Rate %": the denominator (total eligible) is not stored. Ship qualified COUNT instead.
- Role Assignment Action Breakdown: actual actions are only {add, remove, skipped} plus a stray role_grant. Pie collapses to ~2 slices. Low information.

### Correctness rules baked into the chosen metrics
- Decision Mix and Daily Decisions Volume: filter action_log to terminal verbs {approve, reject, perm_reject, kick}, fold perm_reject into reject, exclude claim/unclaim/vote_out. Source action_log ONLY (never union review_action).
- Voice minutes: exclude or cap sessions spanning a bot restart.
- Response p50/p95: read mod_metrics, do not derive from review_claim.
- Message volume / DAU: capped at the 90-day message_activity prune horizon. No multi-month or YoY claims.
- Cohort retention and any first-message metric: caveat early cohorts (first_message_at is left-censored to when tracking began).
- online_count: never present as precise (coarse ~30-min Discord estimate). member_count is the exact figure.

## 5. Rollup schema (migration 078 sketch)

The page reads ONLY these tables. Next migration number is 078 (highest live is 077). All days are 'YYYY-MM-DD' UTC text to match guild_snapshot_log.

```sql
-- 1) Spine: one wide row per guild per UTC day.
CREATE TABLE IF NOT EXISTS daily_metrics (
  guild_id            TEXT NOT NULL,
  day                 TEXT NOT NULL,
  member_count        INTEGER,
  member_count_delta  INTEGER,
  joins               INTEGER NOT NULL DEFAULT 0,
  leaves              INTEGER NOT NULL DEFAULT 0,
  cumulative_net      INTEGER,
  message_count       INTEGER NOT NULL DEFAULT 0,
  message_count_prev7 INTEGER,
  active_authors      INTEGER NOT NULL DEFAULT 0,
  active_authors_7d   INTEGER,
  voice_minutes       INTEGER NOT NULL DEFAULT 0,
  dec_approve         INTEGER NOT NULL DEFAULT 0,
  dec_reject          INTEGER NOT NULL DEFAULT 0,  -- perm_reject folded in
  dec_kick            INTEGER NOT NULL DEFAULT 0,
  apps_submitted      INTEGER NOT NULL DEFAULT 0,
  apps_approved       INTEGER NOT NULL DEFAULT 0,
  refreshed_at_s      INTEGER NOT NULL,
  PRIMARY KEY (guild_id, day)
);

-- 2) Hour x day heatmap (168 cells per guild).
CREATE TABLE IF NOT EXISTS activity_heatmap (
  guild_id  TEXT NOT NULL,
  dow       INTEGER NOT NULL,   -- 0=Mon .. 6=Sun
  hour      INTEGER NOT NULL,   -- 0..23 UTC
  msg_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, dow, hour)
);

-- 3) Join-week cohort retention.
CREATE TABLE IF NOT EXISTS cohort_retention (
  guild_id    TEXT NOT NULL,
  cohort_week TEXT NOT NULL,
  week_offset INTEGER NOT NULL,  -- 1,2,4,8,12
  cohort_size INTEGER NOT NULL,
  retained    INTEGER NOT NULL,
  PRIMARY KEY (guild_id, cohort_week, week_offset)
);

-- 4) Tenure histogram snapshot.
CREATE TABLE IF NOT EXISTS tenure_buckets (
  guild_id     TEXT NOT NULL,
  bucket       TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, bucket)
);

-- 5) Per-channel daily counts.
CREATE TABLE IF NOT EXISTS channel_daily (
  guild_id   TEXT NOT NULL,
  day        TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  msg_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day, channel_id)
);

-- 6) Event participation.
CREATE TABLE IF NOT EXISTS event_daily (
  guild_id        TEXT NOT NULL,
  event_date      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  qualified_count INTEGER NOT NULL DEFAULT 0,
  total_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, event_date, event_type)
);

-- 7) QOTD weekly funnel.
CREATE TABLE IF NOT EXISTS qotd_weekly (
  guild_id  TEXT NOT NULL,
  week      TEXT NOT NULL,
  submitted INTEGER NOT NULL DEFAULT 0,
  approved  INTEGER NOT NULL DEFAULT 0,
  used      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, week)
);

-- 8) Reaction emoji leaderboard (windowed).
CREATE TABLE IF NOT EXISTS reaction_emoji (
  guild_id TEXT NOT NULL,
  emoji    TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, emoji)
);

-- 9) Moderator leaderboard snapshot.
--    (mod_metrics is ALREADY a rollup with p50/p95; this table holds an
--     anonymized/window-scoped copy for the public page if needed.)
CREATE TABLE IF NOT EXISTS mod_leaderboard (
  guild_id      TEXT NOT NULL,
  moderator_id  TEXT NOT NULL,
  display_label TEXT,
  accepts       INTEGER NOT NULL DEFAULT 0,
  rejects       INTEGER NOT NULL DEFAULT 0,
  kicks         INTEGER NOT NULL DEFAULT 0,
  p50_s         REAL,
  p95_s         REAL,
  PRIMARY KEY (guild_id, moderator_id)
);

-- Footer freshness marker.
CREATE TABLE IF NOT EXISTS rollup_meta (
  guild_id       TEXT PRIMARY KEY,
  refreshed_at_s INTEGER NOT NULL
);
```

Design notes: daily_metrics is wide on purpose so the hero, the KPI band, and three trend charts all read one PK-scanned slice of rows. The 168-row activity_heatmap, the small cohort/tenure/qotd/reaction tables, and the per-day channel_daily are all tiny full reads. Nothing the page reads exceeds a few hundred rows.

## 6. Refresh plan

A single out-of-band Node script (for example scripts/refresh-public-stats.ts) runs on EC2 alongside the bot, reusing src/db/db.ts, and does an idempotent UPSERT pass over the nine rollup tables for the public GUILD_ID.

What it computes:
- daily_metrics: for the last about 95 UTC days (covers the 90-day message_activity horizon plus slack), recompute each day. member_count from the latest guild_snapshot_log row that day; joins/leaves from user_activity (date of joined_at / left_at); message_count and active_authors (DISTINCT user_id) from message_activity; voice_minutes from voice_session as SUM((left_at_s - joined_at_s)/60) EXCLUDING sessions whose interval spans a known bot-restart boundary (or capping any single session at a sane max such as 6 hours); dec_approve/dec_reject/dec_kick from action_log filtered to terminal verbs with perm_reject folded into reject (action_log only, never unioned with review_action); apps_submitted/apps_approved from application timestamps. A second pass fills member_count_delta, cumulative_net, message_count_prev7, and active_authors_7d as window calculations over the rows just written.
- activity_heatmap: full overwrite, one GROUP BY dow, hour over message_activity (rolling window, for example the last 12 weeks).
- cohort_retention, tenure_buckets, channel_daily, event_daily, qotd_weekly, reaction_emoji, mod_leaderboard: recomputed and overwritten as small aggregates. mod_leaderboard can instead be a thin anonymized copy of mod_metrics, which src/features/modPerformance.ts already maintains with p50/p95.
- rollup_meta.refreshed_at_s = now.

Cadence: every 15 to 30 minutes via the existing scheduler or cron. guild_snapshot_log updates on the bot's snapshot cadence and online_count refreshes only every about 30 minutes, so a sub-15-minute refresh buys nothing. Fifteen minutes keeps the hero feeling live without load.

Cost: tiny. All source tables are indexed on (guild_id, time) and message_activity is pruned to 90 days, so each pass is a handful of indexed aggregate scans over at most about 90 days of one guild's rows, writing well under about 1,000 rollup rows total. Wrap the whole pass in one transaction; expect well under a second on the prod DB. The script must tolerate empty or missing source data (for example no movie events yet) by writing zero rows rather than erroring.

Page read path: the new unauthenticated route's +page.server.ts SELECTs only from the rollup tables (PK lookups and full reads of the small tables), wrapped in the existing cached()/CACHE_TTL helper, and sets a PUBLIC cache header (overriding the default "private" one). The page never touches a raw table at request time.

## 7. Open decisions for the owner

1. Moderator anonymity on the public page: show real handles in the accepts leaderboard and p50/p95 grid (full transparency) or anonymize to "Mod A/B/C" / opt-in only. Default proposal: anonymize unless the owner opts in.
2. Rollup tables (migration 078) vs precompute-in-load. The design mandate and recommendation is real rollup tables. mod_metrics is already a rollup and could be read directly instead of copying into mod_leaderboard.
3. Hero behavior on a mature/flat server: if member_count is flat the hero area looks dull. Confirm the net-growth delta badge is enough, or swap the hero to DAU / message volume if growth has plateaued.
4. Voice-minute restart correction: exclude sessions spanning a restart (needs restart timestamps) or cap any single session at a max duration (simpler, slightly less accurate). Pick one.
5. Window controls on a zero-JS page: fixed windows (hero 90d, heatmap 12w, leaderboards all-time) with no selector, or ?window= query params re-rendered server-side (allowed under zero-JS, adds cache-key surface).
6. Public route: confirm the new route omits the hasMinTier check and scopes strictly to the public GUILD_ID env (no locals.user). Decide the URL (for example /stats or /public/stats).
7. online_count: confirm we do NOT surface it as a precise "online now" number (it is a coarse ~30-minute estimate; member_count is exact).
8. Dropped metrics: confirm dropping all four active_byte_multipliers time-series and both resonance metrics. If economy coverage is wanted, patreon_art_log (append-only) is the correct source for a v1.1 stacked-area.
9. Deferred v1.1 candidates the critic surfaced: needs_info / draft-abandonment onboarding funnel, ticket-system analytics (migration 067: volume by type, resolution p50/p95, claim latency, backlog), daily moderator actions by type from action_log, avatar-scan / NSFW flag throughput, top inviters, art-job turnaround, messages-in-threads share, deleted/edited message rate. Confirm deferral to hold v1 at 14 metrics.
