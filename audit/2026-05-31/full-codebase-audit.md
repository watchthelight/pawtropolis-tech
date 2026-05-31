# Full-Codebase Audit — Pawtropolis (Discord Bot + SvelteKit Dashboard)

## Executive summary

This audit covers the full single-developer stack: the SvelteKit web dashboard, the operational scripts/migrations/deploy tooling, and the Discord bot (commands, handlers, features, and core libraries). It went through adversarial verification with **zero refutations**, so every finding below is confirmed. Three Critical issues stand out, and all three are silent-data-loss or always-fails-in-production class: a deploy that swallows migration failures and then restarts new code against an un-migrated schema, a `/backfill` command that spawns a script that does not exist, and a byte-token redemption that destroys a finite paid entitlement on any mid-flight Discord error. A dominant theme across the bot is **non-atomic "check-then-act" sequencing** — interaction handlers and economy/modmail flows mutate Discord state or the DB in an order that orphans records, double-processes on double-click, or violates partial unique indexes; a second recurring theme is **timestamp format confusion** (SQLite `datetime('now')` TEXT parsed as local time, or ISO compared lexically against space-separated stored values) that silently corrupts counts and time windows. The web dashboard has no Critical or High findings but carries systemic SSR performance risk (synchronous SQLite fan-out on a blocking event loop) and several latent-IDOR / fail-open patterns that are masked only by the current single-guild deployment. Finally, several "security" and audit-logging test suites are **tautological** (they never import the module under test), giving false CI confidence over exactly the OAuth/CSRF/audit-trail code that most needs it.

## Severity tally

| Severity | Count |
|----------|------:|
| Critical | 3 |
| High | 24 |
| Medium | 79 |
| Low | 193 |
| **Total** | **299** |

Confirmed via adversarial verification: 32 high/critical raw findings, 0 refuted. (See Coverage gaps for a reconciliation note on these numbers.)

## Top risks to fix first

1. **Deploy swallows failed migrations, then restarts new code on an un-migrated DB** (`deploy.sh:435` + `deploy-no-tests.sh:25`). The `|| echo` makes a failed migration exit 0 under `set -euo pipefail`, so PM2 brings up new bot/web code against an old/half-migrated schema — a green deploy that throws at runtime on missing columns, with no rollback. This is the single highest-leverage fix; it also has a duplicate, unprotected twin in the `--no-tests` path.
2. **Byte-token redemption is non-atomic with no rollback** (`src/features/byteTokenHandler.ts:312-468`). The token role is removed before the DB source-of-truth is written; any later failure destroys a finite, paid token for zero value. Make the DB claim the atomic gate before touching Discord roles.
3. **`/backfill` is permanently broken** (`src/commands/backfill.ts:137-140`). It spawns `scripts/backfill-message-activity.ts`, which does not exist; every invocation fails, the heatmap stays empty, and the failure still burns a 30-minute guild cooldown.
4. **`/gate reset` wipes ALL guilds' data** (`src/commands/gate/gateMain.ts:368-395`). The `wipe_tables` deletes are unscoped (`DELETE FROM application` with no `WHERE guild_id`), while the sibling questions wipe in the same flow is correctly scoped — a genuine multi-guild data-loss footgun.
5. **`replyOrEdit` drops the ephemeral flag and clobbers shared cards after `deferUpdate()`** (`src/lib/cmdWrap.ts:500-517`). One root cause behind a High and ~6 Medium/Low findings: per-moderator feedback (including "permanently rejected" notices and failure traces) is written publicly onto the shared review card, wiping its embed and buttons for all staff. Fixing this one helper resolves a whole cluster.
6. **`modmail_delete_on_close` opt-out is silently ignored** (`src/features/modmail/threadClose.ts:365,546`). The INTEGER column is compared `!== false`, so `0 !== false` is always true and threads are irreversibly deleted even when an admin explicitly disabled deletion.
7. **`verified_users` row is written before the role grant** (`src/commands/verify.ts:195-219`). A grant failure permanently records the user as verified without the role, and the "already verified" short-circuit never re-attempts — locking the user out unrecoverably while telling them they got the role.
8. **Tautological security/audit test suites** (`tests/web/linkedRoles.test.ts`, `tests/logging/pretty.test.ts`, `tests/env.test.ts`). These never import the modules they claim to cover, so XSS/CSRF regressions in the internet-facing OAuth server and breakage in the moderation audit trail would be invisible to CI.

---

## Web Dashboard

### Critical

No confirmed findings in this area.

### High

No confirmed findings in this area.

### Medium

**Pulse insights engine fires ~40-55 synchronous SQLite queries per SSR request**
`web/src/lib/server/queries/pulse.ts:1451-1498`
`getInsights()` runs 18 detectors sequentially, each firing 1-6 synchronous `better-sqlite3` queries (e.g. `detectCommunicatorRatioDecline` = 8 queries across 4 windows; `detectMessageAnomaly`, `detectVoiceTrend`, `detectAppBacklog`/`ModWorkloadImbalance`/`RejectionRateShift` each scan large tables). Several predicates are non-sargable. Because the DB handle is synchronous, the Node event loop is blocked for the full duration on every cold-cache load, stalling all concurrent dashboard requests; the 60s page cache only masks it between refreshes and per window.
*Fix:* Collapse the per-window repeated `COUNT(*)` loops into single `GROUP BY` queries returning all buckets at once; share one pre-aggregated pass over `message_activity`/`user_activity`/`review_action` across detectors instead of re-querying per detector; or precompute insights in the existing cron rollup (as observatory does) and read a rollup table at request time.

**`detectNsfwFlagSurge` / `detectModmailResponseTime` wrap TEXT timestamps in `strftime()`, forcing full scans**
`web/src/lib/server/queries/pulse.ts:1174-1188, 1215-1226`
`detectNsfwFlagSurge` filters `nsfw_flags` with `strftime('%s', flagged_at) >= ?` over a TEXT column whose only indexes are `(guild_id)` and `(guild_id, reviewed)`, making the predicate non-sargable and scanning every flag row for the guild twice (this-window + prev-window). `detectModmailResponseTime` has the same defect via `strftime('%s', mt.created_at)` in the WHERE and a correlated `MIN` per ticket. On servers with large history this is a repeated scan on the SSR path.
*Fix:* Store/compare timestamps as INTEGER unix seconds (as `action_log`/`message_activity` already do), or add an indexed generated `*_s` column, then filter with plain range comparisons. At minimum add an index on the text column and compare against ISO string literals via `datetime(?, 'unixepoch')` so the index is usable.

**Review queue layout runs uncached query with ~3 correlated modmail subqueries per row on every navigation**
`web/src/lib/server/queries/reviews.ts:388-461`
`getReviewQueue()` is invoked from `dashboard/reviews/+layout.server.ts:14` with no caching, so it re-runs on every page load and client-side navigation into any `/dashboard/reviews/*` route. Per pending application it adds two correlated scalar subqueries in the SELECT (`has_unread_modmail` EXISTS at 404-411, `modmail_awaiting_since` at 412-419) plus a third correlated EXISTS in the ORDER BY (432-439), each containing a further nested `SELECT MAX(mm2.id) ... WHERE ticket_id = mt.id`. Work is roughly 3 x (pending count) correlated subqueries; the synchronous handle blocks the event loop per load.
*Fix:* Precompute "latest message direction + timestamp per open ticket" once via a single `GROUP BY`/window-function CTE joined to applications, instead of three (effectively four) correlated subqueries per row. Cache the queue with the existing `cached()` helper (short TTL) since the same payload is recomputed on every reviews navigation.

**Heatmap builder issues one query per week (up to 26) and pulls every raw message row into JS**
`web/src/lib/server/queries/heatmap.ts:121-190`
`getHeatmapDataForRange()` loops `weeksCount` (capped at 26) and calls `buildWeek()`, which runs `SELECT created_at_s FROM message_activity WHERE guild_id=? AND created_at_s>=? AND created_at_s<?` returning every raw message row for the week, then buckets them in a JS loop. A 26-week window = 26 separate queries each potentially returning tens of thousands of rows, all materialized and iterated in Node on the SSR path, despite `message_activity` having `hour_bucket` + `idx_message_activity_guild_hour`. The 60s page cache mitigates only warm loads.
*Fix:* Replace the per-week raw-row fetch with a single query over the whole range that `GROUP BY hour_bucket` (or day-of-week/hour), then distribute counts into the week grids in JS — turning 26 row-streaming queries into one aggregate and removing per-row JS bucketing.

**Heatmap includes messages outside the requested range when the span isn't a multiple of 7 days**
`web/src/lib/server/queries/heatmap.ts:174-184`
`getHeatmapDataForRange` computes `weeksCount = ceil(spanS / 7d)` then carves 7-day windows strictly backwards from `endS`. The oldest window starts at `endS - weeksCount*7d`, which is earlier than `range.startS` whenever the span is not an exact multiple of 7 days. For a custom window (e.g. a 10- or 40-day picker range) this pulls `message_activity` rows from before the selected start into the totals/trends, so `totalMessages`, `avgMessagesPerHour`, busiest/least-active hours and week-over-week growth silently over-report.
*Fix:* Clamp the oldest window to `startS` (`weekStartS = Math.max(weekStartS, startS)` on the final iteration), or derive `weeksCount` so the earliest `weekStartS == startS`. Alternatively iterate forward from `startS` and clamp the final partial week's `weekEndS` to `endS`.

**Stale push subscriptions keep receiving tier-gated PII after a user is demoted or removed**
`web/src/lib/server/push/push-sender.ts:86-152`
Subscription `tier` is only refreshed reactively when a `role:changed` SSE event arrives (`updateTier`, 87-96). If a moderator is demoted or leaves while the bot/web is down, or the event is never emitted, the stored `tier` stays at the old higher value, so `pushBroadcast` still passes the `hasMinTier` check (122) and sends notifications whose body/data include sensitive content — applicant display names and `appId` (`review:submitted` body at 63), modmail/audit context — to a device that should no longer have access. There is no authoritative re-check of current roles at send time.
*Fix:* Treat the stored tier as a cache only: re-resolve the user's current tier at send time (or on a short TTL) via the Discord role source/session, and/or proactively delete subscriptions on demotion and guild-leave events. At minimum run `deleteStaleSubscriptions` on role loss and verify tier against a fresh roles lookup before sending tier-restricted payloads.

### Low

**`navigator.clipboard.writeText` not awaited — shows false "Copied!" on failure**
`web/src/lib/components/data/CopyableId.svelte:10-15`
`copy()` calls `navigator.clipboard.writeText(value)` without awaiting or catching, then unconditionally sets `copied = true` and shows the toast (11-14, 27). `writeText` rejects in insecure (non-HTTPS) contexts, when the document is unfocused, or when permission is denied; in those cases the value is not on the clipboard yet the UI reports success, and the unhandled rejection surfaces as an uncaught error. This affects the copy-the-Discord-ID affordance used throughout the review/config UI.
*Fix:* Make `copy()` async and gate the success UI on the resolved promise (`try { await navigator.clipboard.writeText(value); copied = true; ... } catch { /* failure or execCommand fallback */ }`), and guard for `navigator.clipboard` being undefined.

**Copy-for-Newsletter silently no-ops in non-secure contexts with no feedback**
`web/src/lib/components/pulse/NewsletterStatsCard.svelte:126-135`
`copyToClipboard()` awaits `navigator.clipboard.writeText(...)`, but in a non-secure context or older browser `navigator.clipboard` is undefined and the resulting `TypeError` is swallowed by an empty `catch {}` (the comment claims "Fallback for non-secure contexts" but none is implemented). `copied` never flips, so the button appears to do nothing and the user gets no error indication.
*Fix:* Implement an actual fallback (hidden textarea + `document.execCommand('copy')`, or surface a failure toast), or feature-detect `navigator.clipboard` and disable/relabel the button when unavailable.

**Flat (no-change) delta emits the green up-vote emoji in the copied newsletter**
`web/src/lib/components/pulse/NewsletterStatsCard.svelte:28-53, 71-104`
In `numDelta` (36-37) and `pctDelta` (50-51), `direction` is computed as `abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat'`, but `emoji` is computed as `abs >= 0 ? UP_EMOJI : DOWN_EMOJI`. When current and previous values are equal and non-zero, `abs === 0` so `direction` is correctly `'flat'` but `emoji` is `UP_EMOJI`. The Discord markdown builder (76, 92-102) prints `d.X.emoji` unconditionally, so a metric that did not change week-over-week renders a green up-vote beside a `+0.0%` line — signaling growth where there was none.
*Fix:* Derive the emoji from `direction` rather than the `>= 0` sign, e.g. `emoji: direction === 'down' ? DOWN_EMOJI : direction === 'up' ? UP_EMOJI : NEUTRAL_EMOJI`, so flat never maps to the up emoji.

**Unbalanced Unicode bidi isolate characters in generated newsletter markdown**
`web/src/lib/components/pulse/NewsletterStatsCard.svelte:81, 87, 91, 98`
Each section header in the copy-for-Discord output wraps a label with one First Strong Isolate opener (U+2068) but two Pop Directional Isolate closers (U+2069) — one stray PDI per header. When a moderator pastes the output into Discord, every section header carries an extra invisible directional-isolate character (possible subtle bidi rendering quirk); bot logic is unaffected.
*Fix:* Drop the duplicated closer so each label is wrapped with a single matched pair (remove the second U+2069 on lines 81, 87, 91, 98), and verify by pasting into Discord that no stray characters remain.

**`toLocaleString()` used in an SSR+hydrated component despite the repo's locale-safe convention**
`web/src/lib/components/pulse/NewsletterStatsCard.svelte:30, 76, 81, 87, 92-102, 112-121, 159, 250-253`
The `/dashboard/pulse` route does not set `csr=false` (it uses SSE, `onDestroy`, `invalidateAll`), so this component is server-rendered then hydrated. Every numeric value is formatted with `Number.prototype.toLocaleString()`, whereas the codebase deliberately avoids locale APIs on the server — `pulse.ts:35-38` and `observatory/format.ts:1-13` implement a regex-based `fmt()` precisely because "locale APIs vary by server locale." If the server ICU locale and the browser locale group numbers differently (e.g. `1,234` vs `1.234`), the hydrated DOM will not match the SSR HTML, producing a Svelte hydration mismatch; the same locale dependence leaks into the copied Discord markdown.
*Fix:* Reuse the existing locale-safe formatter for all displayed and markdown numbers — add/import a shared client-safe `fmtInt` (like `observatory/format.ts`, since the server `fmt` is server-only) instead of `toLocaleString()`.

**`Avatar` `failed` (image-error) state never resets when `src` changes**
`web/src/lib/components/data/Avatar.svelte:22-23, 46`
`let failed = $state(false)` is set true in the `<img>` `onerror` handler (46) and `resolved = $derived(src && !failed ? src : null)` (23), but no `$effect` resets `failed` when `src` changes. Since the component is reused for the same keyed entity (`ReviewCard` list keyed by `item.id` in `web/src/routes/dashboard/reviews/+layout.svelte:275`), if a Discord CDN avatar URL 404s once (expired signed URLs are common), `failed` latches true; a later valid `src` for the same application (e.g. via SSE live update) leaves `resolved` null, permanently showing the initials placeholder until the instance is destroyed.
*Fix:* Reset the error state when `src` changes, e.g. `$effect(() => { void src; failed = false; });` (or `$effect.pre`), or key the `<img>` on `src`.

**`onPaste` re-renders the whole welcome-message editor and forces caret to end**
`web/src/lib/components/config/WelcomeMessageEditor.svelte:319-333`
`onPaste()` inserts pasted text via `document.execCommand('insertText', ...)` (323), then calls `readEditor()` + `renderEditor(raw)` to rebuild every node (324-325) and collapses the selection to the editor end via `range.collapse(false)` (327-332). Pasting mid-text yanks the caret to the very end, so subsequent typing appends rather than continuing at the paste point — a real editing/UX defect for multi-paragraph welcome templates; the full re-render on every paste is also unnecessary churn (and `execCommand` is deprecated). Token/chip parsing still works, so impact is limited to caret/UX.
*Fix:* Avoid the destructive full re-render on paste: insert the plain text at the current range, re-parse only the affected text node, and restore the caret to just after the inserted text. If a full re-render is required, compute and restore the caret offset rather than jumping to the end.

**`getModmailThreads` interpolates `statusFilter` into SQL; route casts an unvalidated query param**
`web/src/lib/server/queries/modmail.ts:42`
`statusClause` is built by string interpolation (`AND t.status = '${statusFilter}'`). Although typed `'open'|'closed'|'all'`, `dashboard/modmail/+layout.server.ts:12` produces it via `(url.searchParams.get('filter') ?? 'all') as ...` — a TypeScript cast with no runtime validation — so a crafted `?filter=` value flows unescaped into the SQL string. The web DB handle is opened `query_only=ON` (`db.ts:18`), blocking writes, so this is read-side tampering/errors only, but it is a latent injection if `query_only` is relaxed or the helper reused, and a real cross-file trust gap.
*Fix:* Validate the param against an allowlist before use (`['open','closed','all'].includes(raw) ? raw : 'all'`) and/or bind status as a parameter (`AND t.status = ?` with the value pushed into the params array) instead of interpolating.

**Modmail thread list runs 2 correlated subqueries per row and is recomputed uncached on every navigation**
`web/src/lib/server/queries/modmail.ts:37-88`
`getModmailThreads()` is called uncached from `dashboard/modmail/+layout.server.ts:13` on every navigation. Per ticket it selects two correlated subqueries that each re-scan `modmail_message` ordered by `created_at DESC LIMIT 1` (`latest_message` 55-56, `latest_direction` 57-58), on top of the `LEFT JOIN`+`GROUP BY` used for `message_count` — two redundant ordered lookups pulling the same latest row. Bounded by `LIMIT 50`, so impact is modest but it is pure repeated work on every layout load.
*Fix:* Fetch the latest message once per ticket via a window function (`ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY created_at DESC)`) joined to the ticket aggregate, returning content+direction in a single pass. Optionally wrap in `cached()` with a short TTL.

**Rolling 7-day window bucketed into a Mon–Sun grid double-counts a weekday and mislabels dates**
`web/src/lib/server/queries/heatmap.ts:121-157`
`buildWeek` receives an arbitrary `[weekStartS, weekEndS)` window (`endS` comes from `nowS()` snapped to the minute, not midnight/Monday). It builds the `dates` labels from the ISO Monday of `weekStartS` but buckets each message into `grid[dayIndex][hour]` purely by UTC weekday. Because boundaries are not midnight-aligned, a 7-day span covers two partial occurrences of the same weekday (e.g. Wed 14:00 → next Wed 14:00 has two Wednesdays), collapsing both into one grid row while the `dates`/`startDate`/`endDate` labels claim a clean calendar week — per-cell counts and date headers disagree.
*Fix:* Align week windows to UTC midnight / ISO Monday before querying (floor `weekStartS` to Monday 00:00:00 UTC, query `[monday, monday+7d)`) so each weekday appears once and the grid matches the `dates` labels; keep the query window and label anchor identical.

**Push-cleanup `setInterval` is never cleared and not `unref`'d**
`web/src/lib/server/push/push-sender.ts:161-171`
A 24h `setInterval` for stale-subscription cleanup is registered at module import; the handle is never stored, cleared, or `.unref()`'d. In the long-lived server this is benign, but in test/SSR module re-import or graceful-shutdown scenarios it leaks a timer and can keep the event loop alive, preventing clean exit. Combined with the side-effecting `eventBus.subscribe(pushBroadcast)` on import, repeated imports stack duplicate subscribers/timers.
*Fix:* Store the interval handle, call `.unref()` on it, and expose a disposer (or guard the module against double-initialization) so shutdown/tests can clear it.

**`push.db` default location diverges from the main DB default directory when `DB_PATH` is unset**
`web/src/lib/server/push/push-db.ts:13-15`
With `DB_PATH` unset, `push-db.ts` derives `<cwd>/data/push.db`, while the main connection in `db.ts` defaults the same unset `DB_PATH` to `path.resolve(process.cwd(), '..', 'data', 'data.db')` — i.e. `<cwd>/../data/`. The two modules resolve their data directories to different places (sibling `../data` vs `<cwd>/data`). Not data corruption (push.db is independent), but it lands the subscription store in an unexpected directory, risking "lost" subscriptions after a deploy/path change. Production presumably sets `DB_PATH`, mitigating this.
*Fix:* Resolve the push DB relative to the same base as `db.ts`, e.g. `const mainDb = process.env.DB_PATH || path.resolve(process.cwd(), '..', 'data', 'data.db'); const dbPath = process.env.PUSH_DB_PATH || path.join(path.dirname(mainDb), 'push.db');` so both modules agree regardless of `DB_PATH`.

**`getAuditSessionDetail` has no guild scoping (latent IDOR) and is currently unused**
`web/src/lib/server/queries/auditSystems.ts:291-303`
Unlike its guild-scoped siblings (`getAuditSessions`/`getActiveAuditSession`), `getAuditSessionDetail` selects an `audit_sessions` row by `sessionId` alone with no `guild_id` predicate. It has no callers today (dead code), so it is not currently exploitable, but if wired to a route taking a user-supplied id it would allow reading another guild's audit session in a multi-guild deployment. The current single-guild deployment also masks the impact.
*Fix:* Add a `guildId` parameter and `AND guild_id = ?` predicate to match the other accessors, or delete the function if it stays unused.

**`getConfigSections` does `SELECT *` and renders every non-hidden column verbatim**
`web/src/lib/server/queries/config.ts:203-229`
`getConfigSections` selects all `guild_config` columns and, for any column not in the small `HIDDEN_COLUMNS` set, renders the raw value to the admin dashboard under an "Other" section (the doc comment states new columns appear automatically). `guild_config` currently holds no secrets, so this is not an active leak, but the auto-include design means any future column storing a webhook URL, API token, or verification secret would be exposed in plaintext with no code change, and `HIDDEN_COLUMNS` is easy to forget to update.
*Fix:* Invert to an allow-list: render only columns present in `FIELD_META` (or an explicit visible set) and drop unknown columns, so the design fails closed when sensitive columns are added.

**`fmtDayShort` returns "undefined D" for an out-of-range month instead of the raw string**
`web/src/lib/components/observatory/format.ts:53-61`
`fmtDayShort` guards against a non-3-part string and against `m`/`d` being 0 or NaN (`if (!m || !d) return day`) but does not bound-check `m` to 1..12. For an input like `'2025-13-05'`, `months[m-1]` is undefined and the function returns `'undefined 5'`. Inputs come from DB day/week buckets so this is unlikely, but a malformed/off-by-one bucket would render literal `undefined` in Observatory axis/labels (`DivergingBars`, `LineChart`, `QotdFunnel` all call it) rather than degrading to the raw value like the other guards.
*Fix:* Add `if (m < 1 || m > 12 || d < 1 || d > 31) return day;` before indexing `months`, so out-of-range values fall back to the raw `day` string consistently.

**Case-insensitive handbook href rewrite is effectively case-sensitive; mixed-case `.md` links 404**
`web/src/lib/handbook-shared.ts:75-78`
`rewriteHandbookHref()` looks up the slug via `HANDBOOK_FILENAME_TO_SLUG[filename] ?? [filename.toUpperCase()] ?? [filename.toLowerCase()]`, but map keys store a lowercase extension (e.g. `'BOT-HANDBOOK.md'`). `filename.toUpperCase()` produces `'BOT-HANDBOOK.MD'` (extension uppercased) which misses the key, and `toLowerCase()` yields `'bot-handbook.md'` which misses uppercase-prefixed keys — so both fallbacks are dead except for the all-lowercase key. A cross-reference written with non-canonical casing (`'Bot-Handbook.md'`) falls through all three lookups and is returned unmodified, pointing at a raw `.md` path that 404s. The comment promises "Case-insensitive lookup," contradicting behavior.
*Fix:* Build a lowercase-keyed index once (`const byLower = Object.fromEntries(Object.entries(HANDBOOK_FILENAME_TO_SLUG).map(([k,v]) => [k.toLowerCase(), v]));`) and look up `byLower[filename.toLowerCase()]`, making the lookup truly case-insensitive across the whole filename including extension.

**`exactOnly` ([GK]-only) permission is parsed but ignored when computing `canRun`**
`web/src/lib/server/handbook/decorator.ts:113-117`
`parsePermissionLine()` distinguishes `[GK]` (GK exclusively, `exactOnly=true`) from `GK+` (GK and above), but `decorate()` sets `canRun = meetsTier(viewerTier, requiredTier)` and never consults `permission.exactOnly`. For a command documented `[GK]`, an admin/owner viewer gets `meetsTier()=true`, so `PermissionBadge` renders "You can run this." (`PermissionBadge.svelte:20`) while also showing "(exclusive)" (`PermissionBadge.svelte:12`) — contradictory guidance versus the bot's `isGatekeeper()` gate in `roles.ts`. Documentation/affordance bug only; actual authorization is enforced server-side, hence low severity.
*Fix:* When `permission.exactOnly` is true, compute `canRun` as an exact-tier match (`viewerTier === requiredTier`) rather than `meetsTier()`, or pass `exactOnly` into a dedicated check. Thread `permission.exactOnly` through `SectionToken` too if exclusive narrative sections are possible.

**`activeClaims` counts all of a reviewer's claims with no guild or app-status filter**
`web/src/lib/server/queries/home.ts:68-71`
`activeClaims = COUNT(*) FROM review_claim WHERE reviewer_id = ?` has no `guild_id` scope and no join to application status. Unlike `pendingYours` (which joins `application` and filters `status IN (submitted, needs_info)`), this counts every claim the reviewer holds — including claims on already-decided applications (if claims aren't deleted on decision) and, in a multi-guild setup, claims in other guilds — so the dashboard "active claims" figure can overstate open workload.
*Fix:* Join `review_claim` to `application` and filter on `a.guild_id = ?` and `a.status IN ('submitted','needs_info')` (mirroring `pendingYours`), so "active" reflects claims on still-open applications in this guild.

**Numeric coercion keyed off `rule.type` while input rendering keyed off the `type` prop (dual source of truth)**
`web/src/lib/components/config/EditableFieldRow.svelte:102, 208`
`saveEdit()` decides whether to coerce `editValue` to a `Number` using `rule.type` (102), but the template decides whether to render `<input type="number">` using the separate `type` prop (208). These come from two independently hand-maintained maps — `type` from `FIELD_META` (`config.ts`), `rule` from `CONFIG_FIELD_RULES` (`shared/configValidation.ts`). They currently agree, but any divergence could render a number input yet submit a raw string (no coercion), or coerce a non-numeric field, sending a wrong-typed value to `/api/config/update`. (The empty-input NaN path is currently safe: `''` sends null, and `Number('abc')=NaN` is rejected by `validateConfigField`.)
*Fix:* Derive both the input type and the coercion decision from a single source (prefer `rule.type` everywhere, falling back to `type` only when `rule` is undefined), or assert at build/test time that `FIELD_META[key].type === CONFIG_FIELD_RULES[key].type` for all keys.

---

## Scripts / Migrations / Ops

### Critical

No confirmed findings in this area.

### High

**Migration 039 runs outside the runner's transaction and never records itself (perpetual re-run, broken atomicity)**
`migrations/039_fix_art_job_unique_constraint.ts:12-62` (runner: `scripts/migrate.ts:50,195-213,253`)
Unlike every other migration (`migrateNNN(db)` receiving the runner's connection), `migrate039FixArtJobUniqueConstraint()` takes no parameter and `import { db } from "../src/db/db.js"` (line 12), operating on the singleton connection instead of the runner's handle. Three consequences: (1) **Atomicity is broken** — the renumber UPDATEs (44-48), DROP INDEX (53), and CREATE UNIQUE INDEX (56-59) all run via autocommit on the singleton, outside the runner's (empty) transaction, so a partial failure (e.g. UNIQUE index creation hitting a duplicate) leaves the renumber UPDATEs committed and unrecoverable. (2) **`recordMigration` is never called** (cf. 040:135, 038:33) and the runner does not stamp versions itself, so "039" is never inserted into `schema_migrations` and re-executes on every `migrate.ts` run, forcing a fresh backup each time. (3) Importing `src/db/db.ts` triggers that module's heavy top-level schema bootstrap (113-419) on a **second WAL connection** to the file being migrated.
*Fix:* Refactor to `export function migrate039FixArtJobUniqueConstraint(db: Database): void`, drop the `db` import, run all statements on the passed-in `db`, and call `recordMigration(db, "039", "fix_art_job_unique_constraint")` (from `./lib/helpers.js`) at the end.

**Patreon art-grant backfill iterates `role.members` without fetching members → silently grants nothing**
`scripts/backfill-patreon-art-grants.ts:70-117`
After login the script reads `client.guilds.cache.get(guildId)` and iterates `role.members` (line 100) without `guild.members.fetch()`. `role.members` filters the (essentially empty) member cache of a freshly-connected client, so `role.members.size` is ~0 for every tier, the inner loop never runs, and it prints "Backfill complete: 0 members, 0 grant records." while exiting 0. As the one-time economy backfill that must run after migration 062 and before enabling `patreon_art_rewards_enabled`, entitled supporters silently never receive their headshot/fullbody/emoji grants, and the false success hides the gap. Sibling scripts (`backfill-user-cache.ts`/`.mjs`) prove the intended `await guild.members.fetch()` pattern.
*Fix:* Replace the cache read with `const guild = await client.guilds.fetch(guildId); await guild.members.fetch();` (or call `guild.members.fetch()` right after the null-check) so `role.members` is populated.

**Copy-swap re-runs `strftime('%s', created_at)` on already-INTEGER epochs, corrupting every timestamp**
`scripts/fix-review-action.cjs:62-87,117-137`
`needsMigration()` returns true if any of {CHECK present, `created_at != INTEGER`, FK != CASCADE, missing `idx_review_action_app_time`} holds (line 86). Unlike migration 028 (which early-returns once `created_at` is INTEGER), this script has no such guard, so on an otherwise-correct table that merely lacks the index or has a non-CASCADE FK it still runs the full copy-swap, applying `CAST(strftime('%s', created_at) AS INTEGER)` to an already-INTEGER epoch (128-135). `strftime('%s', 1700000000)` does not return NULL — it returns garbage (≈1780244213), so COALESCE keeps the corrupted value, silently rewriting **every** `review_action.created_at` and destroying the audit-trail chronology. The only integrity check is row count (143-145), which still matches, so corruption passes undetected.
*Fix:* Mirror migration 028's guard — when `getCreatedAtType() === 'INTEGER'`, do not trigger the destructive copy-swap solely for a missing index/FK; add the index via plain `CREATE INDEX` and rebuild only for a real schema problem (CHECK or TEXT `created_at`). Equivalently, only apply the `strftime` conversion in the `INSERT...SELECT` when the source type is TEXT; otherwise copy `created_at` verbatim.

### Medium

**Migration runner reports success when the child is killed by a signal**
`scripts/migrate-remote.js:18-24`
`spawnSync` returns `{ status, signal }`; when the `tsx` child is killed by a signal (OOM-killer on a large migration, or SIGTERM from pm2/`kill_timeout`), `status` is null and `process.exit(result.status || 0)` exits 0 — reporting success for a migration that never completed. This masks signal kills for every caller (`deploy-no-tests.sh:25`, the development-guide step 7, manual runs), independent of `deploy.sh:435` separately discarding the code.
*Fix:* `if (result.error) { console.error(result.error); process.exit(1); } process.exit(result.signal ? 1 : (result.status ?? 1));` — use `?? 1` (not `|| 0`) so a null status fails closed.

**Wrong/missing `DB_PATH` silently creates an empty DB, "backs it up", and migrates the empty file**
`scripts/migrate.ts:48-56,134-143`
The DB opens with `new Database(dbPath, { fileMustExist: false })` (line 50; the in-file comment even warns data can be "mysteriously gone"). `createBackup()` (142) then `copyFileSync(dbPath, backupPath)` **after** the connection already created the file, so the backup captures the freshly-created empty DB. All pending migrations then "succeed" against the empty DB and get stamped into `schema_migrations`. On the server this is reachable via a wrong remote `.env` `DB_PATH` or a cwd/relative-path mismatch during extraction, leaving the bot booted on an empty DB with a clean migration log and no recoverable pre-state.
*Fix:* Open the migrate path with `fileMustExist: true` (or stat the file and abort if missing/zero-byte unless explicitly bootstrapping). Take the filesystem backup **before** opening the connection, and skip/abort backup when the source does not exist. Gate fresh-DB creation behind an explicit `--init`/`--bootstrap` flag.

**Per-migration transaction does not roll back non-throwing side effects, yet stamps the version**
`scripts/migrate.ts:205-213`
`applyMigration` wraps `migrateFn` in `db.transaction`, but (per the in-file GOTCHA at 206-208) the transaction only rolls back on a thrown exception. A migration that performs a partial/incorrect change without throwing still commits, and since each migration calls `recordMigration` inside that same transaction, the version is permanently marked applied. Combined with `deploy.sh:435` swallowing failures, a migration that logs-and-returns on error is recorded as applied and never retried, so "recorded as applied" does not guarantee "schema is correct."
*Fix:* Have the runner (not each migration) own stamping — call `recordMigration` only after `migrateFn` returns and, where feasible, after a post-condition check. Make migration-internal errors throw rather than log-and-return, and pair with fixing the `deploy.sh` swallow so a throw aborts the deploy.

**`PRAGMA foreign_keys = OFF` is a silent no-op inside the runner transaction**
`migrations/010_limit_questions_to_5.ts:97-119`
The runner wraps every migration in `db.transaction()` (`scripts/migrate.ts:209-213`), so `db.pragma("foreign_keys = OFF")` at line 97 and `= ON` at 119 are no-ops — SQLite ignores `PRAGMA foreign_keys` while a transaction is pending. FK enforcement therefore stays ON throughout the DROP/RENAME rebuild. It succeeds today only because the sole FK (`guild_question -> guild_config`) is satisfied and nothing references `guild_question` as a parent, but the stated safety strategy is silently defeated, and a future child table referencing `guild_question` would make the DROP (114) fail unexpectedly.
*Fix:* Remove the misleading OFF/ON toggling (it cannot work inside the runner transaction). If FKs must truly be disabled, toggle the pragma outside any transaction or use the documented 12-step rebuild; at minimum add a `PRAGMA foreign_key_check` after the rebuild to assert integrity.

**Standalone migration 046 records into a different bookkeeping table than the framework**
`scripts/run-migration-046.mjs:24-28`
The canonical tracker is `schema_migrations` (`scripts/migrate.ts:71-78`, `migrations/lib/helpers.ts:149-213`), and `migrations/046_extend_user_cache_profile.ts:32` correctly calls `recordMigration(db, '046', ...)`. But this hand-run helper writes to a separate `migration_log` table instead, so if an operator runs it during incident response the ALTERs apply while `schema_migrations` is not updated — the next deploy's `migrate.ts` sees 046 as pending and re-runs it. The 046 ALTERs are `columnExists`-guarded so the re-run is non-destructive today, but any future standalone fix for a non-idempotent migration following this pattern would double-apply.
*Fix:* Make `run-migration-046.mjs` write to `schema_migrations` via the same `recordMigration` logic, or (better) delete it in favor of `npm run migrate`.

**Third legacy deploy script skips migrations entirely and uses `set -e` without `pipefail`/`-u`**
`scripts/deploy.sh:12,108,122-133`
This script (distinct from the root `deploy.sh`) is a third deploy path to the same prod host. It uses only `set -e` (12) — no `-u` (undefined vars become empty) and no `pipefail` (failures upstream of a pipe are masked) — and has **no migration step**: it extracts the tarball, runs `npm ci --omit=dev`, and `pm2 restart` (122-133), shipping new code against an unmigrated schema. Its tarball (108) also omits `.env.build`, `web/build`, and `ecosystem.config.cjs` that the root deploy ships, so runtime env and the web app drift. Three divergent scripts (root `deploy.sh`, `deploy-no-tests.sh`, `scripts/deploy.sh`) all targeting PM2 `pawtropolis` is a maintenance trap.
*Fix:* Remove or clearly archive `scripts/deploy.sh` and converge on the root `deploy.sh`. If kept, add `set -euo pipefail`, add the migration step, and make the tarball identical to the canonical deploy.

**Multi-batch message fetch produces non-chronological output**
`scripts/fetch-channel.ts:150-183`
`fetchMessagesFromChannel` fetches 100 newest-first, sorts each batch oldest-first, `messages.unshift(...)` each (167), then `messages.reverse()` (182). For batches [10,9,8] then older [7,6,5] this yields `[8,9,10,5,6,7]` instead of `[5,6,7,8,9,10]` — any channel/thread over 100 messages is archived with each 100-message block out of order. The "Total messages" count stays correct, so the corruption is silent; single-batch channels happen to be correct, masking it in light testing.
*Fix:* Drop the per-batch sort + unshift + final reverse. Collect raw messages across batches (`all.push(...fetched.values())`), then do one global `all.sort((a,b) => a.createdTimestamp - b.createdTimestamp)` before formatting.

**DB sync pulls remote WAL/SHM over a freshly-replaced main DB without re-checkpoint**
`scripts/start.sh:289-290,343-350` (cf. 313,339)
In `sync_db_remote_preferred` the main DB is checkpointed PASSIVE on the remote (313, best-effort, may time out while the bot runs), copied and integrity-checked, then moved into place (339); afterward the remote `-wal`/`-shm` are copied on top of the just-replaced local main DB (343-350). If the passive checkpoint did not fully fold the WAL (explicitly possible per the line 313 timeout message), the local has a main file from one instant and a WAL from a later instant, which SQLite will replay on next open — safe only if they are a matched set. The non-atomic copy spanning a live writer can yield an inconsistent set even though `integrity_check` on the bare main passed. Backup rotation also runs through `|| true` (289), hiding rotation failures.
*Fix:* Either copy main+wal+shm as one consistent set taken after a TRUNCATE checkpoint with the writer stopped, or pull only the checkpointed main DB and skip the remote WAL/SHM. Verify integrity after the WAL files are in place, not just on the bare main.

### Low

**Fresh-DB index/ALTER migrations lack a table-existence guard (crash on standalone `migrate.ts` runs)**
`migrations/004_metrics_epoch_and_joins.ts:66-81`; `migrations/021_add_modmail_message_content.ts:17-31`; `migrations/022_transcript_index.ts:15-17`; `migrations/023_user_activity_indexes.ts:15-25`; `migrations/024_review_action_index.ts:15-18`
These migrations `CREATE INDEX`/`ALTER TABLE` against `action_log`, `modmail_message`, `transcript`, `user_activity`, and `review_action` guarded only by `indexExists()`/`PRAGMA table_info`, never `tableExists()`. The base tables are created by `src/db/ensure.ts`, which the standalone `scripts/migrate.ts` runner (opens with `fileMustExist:false`) does not invoke. On a fresh/partial DB, SQLite raises `no such table: …` and aborts the migration (`IF NOT EXISTS` guards a pre-existing index, not a missing base table). This is inconsistent with the `guild_config` guards in 001/017/018/027. (023 also redundantly re-creates `idx_user_activity_guild_user` already made by migration 005.)
*Fix:* Wrap each statement in `if (tableExists(db, '<table>')) { … }` and `recordMigration` regardless (mirroring 001/017/018); for 021 early-return + record when the table is absent. Optionally drop the duplicate index in 023.

**`guild_config` column-add migrations omit the `tableExists` guard used by 030/031**
`migrations/045_report_forum_config.ts:29-31`; `migrations/048` (18-19); `migrations/056` (55-63); `migrations/059` (19-21); `migrations/061` (32-34)
030 (34-40) and 031 (69-75) guard `if (!tableExists(db, "guild_config")) { recordMigration(...); return; }` before ALTERing `guild_config`, which is created only at runtime by `src/db/ensure.ts` (not by any migration). These five files drop that guard, so when `columnExists` is false on a DB without `guild_config` the `ALTER TABLE guild_config ADD COLUMN …` throws `no such table: guild_config`. Production always has the table (latent, not always-firing), but a fresh/partial migration run fails here where 030/031 would cleanly skip.
*Fix:* Mirror 030/031 — wrap the ALTERs in `if (!tableExists(db, "guild_config")) { recordMigration(...); return; }`, or assert `guild_config` existence centrally before the dependent migrations run.

**`migration_028`-style guard missing for `updated_at` legacy column in migration 027**
`migrations/027_standardize_guild_config_timestamps.ts:53-99`
027 backfills `updated_at_s` from the legacy TEXT `updated_at` via `WHERE updated_at_s IS NULL AND updated_at IS NOT NULL` (56) and `strftime('%s', updated_at)` (80). It guards `tableExists(guild_config)` and adds `updated_at_s`, but never checks that `updated_at` exists. A fresh `guild_config` (per `src/db/ensure.ts`) has only `(guild_id, logging_channel_id, updated_at_s)` — no `updated_at` — so the migration raises `no such column: updated_at` at line 56 and fails; it works only on legacy DBs.
*Fix:* Guard the TEXT-backfill block with `if (columnExists(db, 'guild_config', 'updated_at')) { … }`; when absent, skip the `strftime` backfill and only fill defaults for NULL `updated_at_s`.

**Export scripts: unguarded `.get().sql` throws an opaque TypeError when the source table is absent**
`scripts/export-embed.mjs:13`; `scripts/export-score.mjs:13`; `scripts/export-substantiveness.mjs:13`
Each does `src.prepare("SELECT sql … name='<table>'").get().sql`; if the table is missing, `.get()` returns undefined and `.sql` throws "Cannot read properties of undefined (reading 'sql')" with no context. Sibling `export-processed.mjs:29-30` handles this gracefully with `?.sql` + a "skip (not found)" message. Trusted-local-data tools, so impact is operator confusion on a misconfigured/empty snapshot DB; no data corruption.
*Fix:* `const row = src.prepare(...).get(); if (!row?.sql) { console.error('table <name> not found in', SRC); process.exit(1); } dst.exec(row.sql);` — matching `export-processed.mjs`.

**`export-embed.mjs` hardcodes SRC/OUT, ignoring the `DB_PATH` contract its siblings honor**
`scripts/export-embed.mjs:4-5`
SRC is hardcoded to `data/data.db.processed-snapshot` with no `DB_PATH` override, whereas `export-overlay/processed/score/substantiveness.mjs` all use `process.env.DB_PATH || 'data/data.db'`. An operator exporting the suite with `DB_PATH` set gets the embed table from a different (possibly stale) DB than the others, producing an inconsistent bundle; OUT is likewise hardcoded unlike the siblings' `argv[2]`.
*Fix:* `const SRC = process.env.DB_PATH || 'data/data.db.processed-snapshot';` and `const OUT = process.argv[2] || '/tmp/embed-export.db';`.

**Live-WAL `copyFileSync` snapshot can capture stale/torn data**
`scripts/quality-snapshot.mjs:45-46`; `scripts/quality-snapshot-stage1.mjs:18-19`
Both copy `data/data.db` with `copyFileSync` while the production bot may hold it open in WAL mode. A raw copy of only the main `.db` omits uncheckpointed pages in `data.db-wal`, so the snapshot can miss recently-committed rows or be internally inconsistent if a writer is mid-commit. Marked LOCAL ONLY, but the printed counts then under-report and a downstream EC2 merge silently drops those rows.
*Fix:* Before copying, run `PRAGMA wal_checkpoint(TRUNCATE)` on the source, or use better-sqlite3 `db.backup()` / `VACUUM INTO 'snapshot.db'` for a consistent point-in-time copy that includes WAL contents.

**Chart x-scaling divides by zero (NaN coordinates) when only one week qualifies**
`scripts/generate-charts.mjs:75-80,249-251`; `scripts/plot-effort.mjs:35,39,123`
After the `count >= 100` (generate-charts) / `count >= 50` (plot-effort) filter, only `rows.length > 0` is guarded. If exactly one row qualifies, `x0 === x1` and `xPx(x) = (x - x0)/(x1 - x0)` evaluates 0/0 = NaN, so every plotted X is NaN and the PNGs (including `_dashboard.png`) render blank/garbage with no error. `plot-effort.mjs` additionally throws a TypeError at line 123 (`rows[rows.length-1].resonance`) when zero rows match, since `Math.min/Math.max` over an empty array give ±Infinity.
*Fix:* After computing x0/x1, guard the degenerate span: `if (rows.length < 2) { console.error('need >=2 qualifying weeks to chart'); process.exit(1); }` or `const span = (x1 - x0) || 1;`. Apply in both `plotMetric` and the mini-chart loop; add a `rows.length === 0` early exit in `plot-effort.mjs`.

**CLI arg parsers yield NaN on missing/non-numeric values, defeating or crashing the run**
`scripts/backfill-general.mjs:30-31,153-156`; `scripts/build-context-incremental.mjs:22-24,37`
`backfill-general.mjs`: `--limit` as the final token makes `parseInt(undefined,10)` NaN, so `runAdded >= NaN` is always false and the smoke-test cap never triggers — it pages all of #general (far more Discord API than intended; not corrupting due to `INSERT OR IGNORE`). `build-context-incremental.mjs`: `--batch` without a numeric value makes `MAX_BATCH` NaN, bound as `LIMIT ?` (line 37); better-sqlite3 rejects NaN with `SQLITE_MISMATCH`, aborting the cron run before any work (fails safe but silently stalls scheduled materialization).
*Fix:* Validate the parse in both: `const n = parseInt(args[i+1], 10); const VAL = Number.isFinite(n) && n > 0 ? n : <default>;` and warn/error if the flag is present but the value is missing/NaN.

**Audit-findings recorder is non-idempotent and double-counts on re-run**
`scripts/record-audit-findings.ts:7,108-131,137`
`auditRunId` is the hardcoded constant `"audit-20260112-manual"` (7), and `audit_findings` (`migrations/043_audit_findings.ts`) has only an AUTOINCREMENT PK with no unique constraint on `(audit_run_id, command_name, subcommand)`. Re-running inserts a second full copy under the same run id with no pre-delete, so `generateReportData()` aggregation (totalCommands, passCount, skipCount, etc.) and the generated markdown silently double/triple. Limited impact — a manual one-shot script.
*Fix:* `DELETE FROM audit_findings WHERE audit_run_id = ?` inside a transaction before inserting, or add `UNIQUE(audit_run_id, command_name, subcommand)` and `INSERT … ON CONFLICT DO UPDATE`. At minimum derive `auditRunId` from a runtime timestamp.

**`writeFileSync` to `docs/audits` without ensuring the directory exists**
`scripts/record-audit-findings.ts:141-143`
The report writes to `docs/audits/audit-${auditRunId}.md` but the script never creates `docs/audits/`. If absent (fresh checkout or different cwd), `writeFileSync` throws ENOENT **after** all DB inserts already committed, so the run half-succeeds (data written, report lost) and exits non-zero. `train-effort-v1.mjs:258-259` guards this with `mkdirSync(dir,{recursive:true})`.
*Fix:* `mkdirSync(path.dirname(reportPath), { recursive: true })` before `writeFileSync`.

**Destructive cleanup deletes all home-dir tarballs behind a weak `y/N` gate, no `set -euo pipefail`**
`scripts/CLEANUP-ALL.sh:84-101`
No `set -euo pipefail`. After one `read -p "Continue? (y/N)"` (84), it runs `rm -fv /home/ubuntu/*.tar.gz` and `…/pawtropolis-tech/*.tar.gz` (98-99). The summary claims it "Preserves /home/ubuntu/archives/", but the top-level glob is unconstrained, so an intentional archive placed directly in `/home/ubuntu` (e.g. a `deploy-archive.tar.gz`) is deleted. The DB-backup pruning (104-119) keyed on `data.db.backup*` is fine; the tarball deletion is broader than the messaging implies.
*Fix:* Add `set -euo pipefail`. Scope tarball deletion to a known throwaway prefix (`deploy.tar.gz`/`deploy-*.tar.gz`) rather than `*.tar.gz`, move intentional archives into the preserved `archives/` first, and echo the exact file list requiring a typed-count confirmation.

**`voiceChannelTotals` counts full session duration for in-window sessions, inflating 30d totals**
`scripts/charts/pull.js:227-243`
Unlike `voiceMinutesDaily` (section 11, which splits sessions across days), section 12 sums `(left_at_s - joined_at_s)` for every session with `joined_at_s >= startS` without clipping the lower bound to `startS`, and uses `nowS - joined_at_s` for open sessions. A long session beginning just inside the 30-day window contributes its entire (possibly multi-day) length to the 30-day treemap, overstating recent per-channel voice minutes. Analytics-only.
*Fix:* Clip to the window: `SUM(MIN(COALESCE(left_at_s, ?), ?) - MAX(joined_at_s, ?))` with params `(nowS, nowS, startS)`, mirroring `voiceMinutesDaily`.

**Name-resolution queries assume auxiliary tables exist; a missing table aborts the whole dump**
`scripts/charts/pull.js:335-337,458-460`
Sections 9/16/20 query `user_message_counts` and `user_names`, which no migration creates (only chart-pipeline scripts and the test fixture schema reference them). better-sqlite3's `db.prepare()` throws synchronously on `no such table`, and these queries are not wrapped in try/catch, so on a DB lacking the pipeline aux tables the entire 20-dataset dump aborts partway and writes nothing — all-or-nothing rather than degrading the one affected dataset.
*Fix:* Wrap the `user_names`/`user_message_counts` lookups (ideally each numbered section) in try/catch, or probe `sqlite_master` first and fall back to `id.slice(-6)` when absent.

**`fetch-channel.ts` channelId parsing uses `args.indexOf(a)` inside `find()`**
`scripts/fetch-channel.ts:44,49`
`args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--limit'))` uses `indexOf(a)` (first index of the value, not the iteration index), so a later positional sharing a string value with an earlier token evaluates against the wrong neighbor. The "skip the value after `--limit`" intent is also implemented separately (and correctly) in `positionalArgs` (49) with the proper index, so the two parsers can disagree (e.g. `--limit` before the id picks the wrong channelId). Works for normal `id [output] [--limit N]`.
*Fix:* `args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit')`, consistent with line 49.

**`check-thread.mjs` reads thread-only fields without a null/thread guard**
`scripts/check-thread.mjs:17-24`
`client.channels.fetch(threadId)` can resolve to a non-thread channel or null. The code reads `channel.type/.archived/.locked/.name` unconditionally: for a normal text/voice channel `.archived`/`.locked` are absent and serialize as undefined, mis-reporting a thread as un-archived/un-locked; if `fetch` returns null, `.type` throws a TypeError swallowed by the inner catch and mis-reported as `exists:false`. Developer-diagnostic only.
*Fix:* Guard `if (!channel)` (report not-found) first, then branch on `channel.isThread()` before reading archived/locked, emitting a `notAThread` shape for non-thread channels.

**Zero-copy `Float32Array` view assumes a 4-byte-aligned Buffer byteOffset**
`scripts/score-substantiveness.mjs:68-70,128` (also `novelty-sanity.mjs`)
`vec(buf)` returns `new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength/4)`; the 3-arg constructor throws `RangeError` if `byteOffset` is not a multiple of 4. better-sqlite3 BLOBs are Node Buffers, and a Buffer viewing a shared/pooled ArrayBuffer has an arbitrary, frequently-unaligned offset. Siblings `score-effort-v1.mjs:84` and `train-effort-v1.mjs:107` copy with `buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength)` to stay alignment-safe; this file diverges, so an unaligned blob aborts the whole scoring run. Low confidence — current builds tend to return offset-0 buffers.
*Fix:* `const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); return new Float32Array(ab);` (or copy via `Float32Array.from`).

---

## Bot Commands & Handlers

### Critical

**`/backfill` spawns a non-existent script — command is permanently broken**
`src/commands/backfill.ts:137-140`
`execute()` spawns `npx tsx scripts/backfill-message-activity.ts <guildId> <weeks> [--dry-run]`, but that file does not exist anywhere in the repo. The real entrypoint is `scripts/backfill/run.ts`, which has a completely different flag-based CLI (`--channels=`, `--skip-reactions`, `--resume-only`) and takes no positional `guildId`/`weeks` args. Every `/backfill` invocation therefore fails immediately: tsx exits non-zero with module-not-found, the `close`/`error` handler reports `Backfill Failed`, and no data is ever backfilled. The heatmap it is meant to populate stays empty. Staff-facing command that can never succeed.
*Fix:* Point spawn at `scripts/backfill/run.ts` and pass the flags it expects, or add a thin `scripts/backfill-message-activity.ts` shim accepting `<guildId> <weeks>` that calls into run.ts. Update `BACKFILL-NOW.sh` too. Add a smoke test asserting the spawned script path exists.

### High

**`/gate reset` wipes ALL guilds' data, not just the current guild**
`src/commands/gate/gateMain.ts:368-395`
In `executeReset` → `'wipe_tables'`, the deletes are unscoped: `DELETE FROM application`, `application_response`, `review_action`, `modmail_bridge`, `review_card`, `avatar_scan`, `review_claim` all run with no `WHERE guild_id`. These tables carry a `guild_id` column, and the immediately following `'wipe_guild_question'` step (lines 397-411) *is* correctly scoped (`WHERE guild_id = ?`), as is the confirmation modal customId (`v1:gate:reset:${guildId}`) — so the intent is clearly a per-guild reset. As written, a mod in one guild running reset destroys every other guild's gate data sharing the SQLite file. A genuine multi-guild data-loss bug and a latent footgun even in single-guild deployment.
*Fix:* Scope every delete by `guild_id`, mirroring the questions wipe. For tables keyed off `app_id` (`review_action`, `modmail_bridge`, `review_card`, `avatar_scan`, `review_claim`), delete via subquery: `DELETE FROM review_action WHERE app_id IN (SELECT id FROM application WHERE guild_id = ?)`. Run the `application` delete last (or capture app ids first) so subqueries still resolve, all inside the existing transaction.

**`verified_users` row is inserted before the role grant — grant failure permanently locks the user out and the "already verified" check then lies**
`src/commands/verify.ts:69-81, 195-219`
The INSERT into `verified_users` (196-198) commits *before* `member.roles.add` (206-217), which runs in a try/catch that only logs on failure and continues. If the grant fails (missing Manage Roles, role above the bot in hierarchy, transient API error, fetch failure), the user is permanently recorded as verified but never receives the Thin Line role — yet is still told "You have been given the Thin Line role" (219). On any re-run, the existence check (69-81) short-circuits with "You're already verified … You have the Thin Line role" and never re-attempts the grant, so the role is unrecoverable. The log embed even records "Role Granted: Failed", confirming the path is expected.
*Fix:* Grant the role first and only INSERT after a confirmed grant (or delete the just-inserted row on failure and tell the user verification could not complete). At minimum make the success DM/embed conditional on `roleGranted`, and have the "already verified" branch re-check `member.roles.cache.has(VERIFIED_ROLE_ID)` and re-attempt the grant when missing.

**Artist-rotation "next artist" selection is a check-then-act race (TOCTOU) across `/redeemreward` issue→confirm and concurrent invocations**
`src/commands/redeemreward.ts:190-199, 283`
`getNextArtist(guildId)` is a pure SELECT that does not mutate the queue; the chosen `artistId` is baked into the Confirm button customId (283) and the queue is only mutated by `processAssignment()` on confirm (`src/features/artistRotation/handlers.ts:228`). `handleConfirm` trusts the command-time `artistId` and never re-checks it is still next, dedupes `confirmId`, or applies a per-button cooldown. Two realistic triggers: (1) two staff run `/redeemreward` before either confirms → same artist returned twice → assigned twice with two jobs; (2) one staff double-clicks Confirm → `interactionCreate.ts:599-613` dispatches each click independently with no in-flight guard → two jobs and a double-incremented count. `processAssignment` is transactional, but the decision feeding it is made far earlier, so the transaction does not close the window. The byte-token confirm path added a race mitigation (`src/features/byteTokenHandler.ts:353-382`); this one has none.
*Fix:* Make assignment idempotent and re-validated at confirm: persist pending redemptions keyed by `confirmId` and atomically consume the row inside `processAssignment`'s transaction (reject if already consumed); and/or for non-override flows re-run `getNextArtist` *inside* that transaction; and add a short per-`(user,confirmId)` cooldown / disable the button on first click (`interaction.update` removing components) to swallow double-clicks.

### Medium

**Mutating staff art subcommands never defer before awaiting a network audit-log post, risking 10062**
`src/commands/art.ts:895-994 (assign), 1072-1173 (cancel), 1182-1282 (reassign)`
Slash commands are dispatched via `interactionCreate.ts:265` with no auto-defer. `handleAssign`/`handleCancel`/`handleReassign` never call `deferReply()`; they do the DB write and then `await logActionPretty(...)` *before* the first ack (cancel: audit ~1136 precedes reply ~1151; reassign: ~1242 before ~1259; assign: ~959 before ~972). `logActionPretty` (`src/logging/pretty.ts:464,517,635`) does a network `channel.send` POST; if that is slow (rate limit/latency), total time exceeds Discord's ~3s window and the subsequent `reply()` fails with 10062 — but the DB mutation already committed, so staff see "This interaction failed" while `wrapCommand` also fails to post its error card. The read-only subcommands (`handleJobs`/`handleAll`/`handleLeaderboard`/`handleGetStatus`) correctly defer first.
*Fix:* Call `await interaction.deferReply()` at the top of the three mutating handlers (before the DB/audit work) and switch the final `reply(...)` to `editReply(...)`; or ack first and make the audit-log post fire-and-forget.

**SQLite datetime strings parsed as local time in `/art`, producing wrong relative timestamps and day counts**
`src/commands/art.ts:425, 635-637, 712, 732, 865, 1038`
`art_job.assigned_at`/`completed_at` are stored as `datetime('now')` UTC TEXT (`'YYYY-MM-DD HH:MM:SS'`, space separator, no offset; `src/db/db.ts:353-355`, `types.ts:36-39`). These are fed directly into `new Date(...).getTime()`. Per ECMAScript, a space-separated date-time with no offset is parsed in the host's *local* zone by V8/Node, so on any non-UTC host every `<t:…:R>` "Assigned X ago" in `/art jobs|view|all|getstatus` is off by the UTC offset. In `handleFinish` (635-637) `daysToComplete = Math.floor((Date.now() - assignedAt)/86400000)` can be off by a day, or negative ("Completed in -1 days") on a positive-offset host. The correct normalization already exists at `src/ui/reviewCard.ts:110` and `src/features/review/card.ts:129` (`trimmed.replace(' ', 'T') + 'Z'`).
*Fix:* Normalize before constructing a Date via a shared helper (`new Date(job.assigned_at.replace(' ', 'T') + 'Z').getTime()`) at every call site, and clamp with `Math.max(0, …)` to avoid negative day counts.

**Backfill cooldown is consumed before validation and before the (failing) spawn, locking the guild out for 30 minutes**
`src/commands/backfill.ts:85-92`
`checkCooldown('backfill', guildId, COOLDOWNS.BACKFILL_MS)` records the timestamp as a side effect whenever it returns `allowed:true` (`rateLimiter.ts:77`), and is called before weeks/date validation and before the spawn. Combined with the broken-script bug, a single instant failure still burns the full 30-minute `BACKFILL_MS` cooldown for the whole guild, blocking retries for half an hour after every failed run — and the same happens on validation rejection or spawn error.
*Fix:* Move `checkCooldown` after input validation, and ideally only record it once the child has actually spawned (inside `backfillProcess.on('spawn')`), or call `clearCooldown('backfill', guildId)` in the `error` handler and on validation failure.

**Concurrent audit "resume" double-flags members and double-counts stats (no concurrency guard)**
`src/commands/audit/members.ts:116-174`; `src/commands/audit/nsfw.ts:144-243`
`runMembersAudit`/`runNsfwAudit` are launched fire-and-forget from `buttonRouter.handleAuditButton`, which explicitly skips the per-guild cooldown for `action === 'resume'` (`buttonRouter.ts:128`). `getActiveSession` returns the same `in_progress` session for every clicker and nothing takes a lock. If two staff click Resume (or one double-clicks before the message updates), two runners execute the same `sessionId` concurrently. `markUserScanned` uses `INSERT OR IGNORE`, but both runners load `alreadyScanned` at start, so members not yet recorded are analyzed by both: `upsertManualFlag`/`upsertNsfwFlag` fire twice, duplicate flag embeds are sent, and `updateProgress` overwrites `flagged_count` last-writer-wins (can under/over-count). For NSFW this also doubles paid Google Vision calls.
*Fix:* Add a lightweight in-process lock keyed by `${guildId}:${auditType}` (or `sessionId`) that rejects a second concurrent runner, and/or transition the session to a `'running'` status when picked up and refuse to resume one already processing. Re-applying the cooldown on resume (with clear-on-complete) would also cover the double-click case.

**Permission cache is never invalidated on role change (`invalidatePermissionCache` is dead-wired)**
`src/commands/help/cache.ts:260-289, 322-327`
`filterCommandsByPermission` caches the visible-command list under `${guildId}:${userId}` with a 5-minute TTL. The only invalidation path, `invalidatePermissionCache`, is never called from any production module (only its own file, tests, and graphify artifacts) — contradicting the code's own comment at 206-207. So a member's role change is not reflected in `/help` for up to 5 minutes. This is not merely cosmetic: `showCommandDetail` (`index.ts:220-235`) reuses the cached list as an authorization gate, so a just-promoted staffer is falsely told "You don't have permission to view /<cmd>", and a just-demoted user can still read help for commands they lost — until TTL expiry.
*Fix:* Call `invalidatePermissionCache(guildId, userId)` from role-change paths (`guildMemberUpdate` / role automation) and config changes affecting `mod_role_ids`/`reviewer_role_id`; or key the cache on a hash of the member's sorted role IDs so changes naturally miss. At minimum shorten the TTL or expose a bulk-clear hook for role events.

**Transient member-fetch failure poisons the permission cache with a public-only list**
`src/commands/help/cache.ts:260-289`
All help entry points fetch the member with `.catch(() => null)` and tolerate null (`autocomplete.ts:53`, `index.ts:90/319/397/461`). On a transient fetch failure `member` is null, `hasPermissionLevel` (213) then returns true only for `public` (and the owner), and that public-only list is cached under `${guildId}:${userId}` for 5 minutes — the cache key does not encode member-fetch success or roles. Because autocomplete fires on every keystroke and is usually the first interaction, one failed fetch there poisons the shared module-level cache, so the subsequent `/help` execute and the `showCommandDetail` gate (`index.ts:220`) both serve the stale public-only list, falsely hiding staff/reviewer/admin commands for the whole TTL. With `invalidatePermissionCache` unwired, nothing clears it early.
*Fix:* Do not cache when `member` is null (`if (member || isOwner(userId)) PERMISSION_CACHE.set(...)`), or treat a fetch failure as "unknown" and bypass the cache; or key the cache on a role-ID fingerprint so a null-member computation cannot masquerade as a real permission set.

**INSERT catch block treats ALL errors as "duplicate verification" and silently aborts**
`src/commands/verify.ts:195-203`
The try/catch around the INSERT assumes any thrown error is a UNIQUE-constraint duplicate, replies "You're already verified!", and returns. The same catch fires for unrelated failures — missing `verified_users` table (migration 064 not run), disk full, `SQLITE_BUSY`, corruption — falsely telling the user they are already verified, granting no role, writing no log, and burying the real error in a single `logger.warn`. Genuine duplicates are already blocked by the existence check at line 61, so the misclassification of *other* errors is the more likely real-world trigger.
*Fix:* Inspect the error: only treat it as a duplicate when `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` (or the message contains "UNIQUE constraint failed"); otherwise log at error level and tell the user verification failed and to retry. Re-throw or surface unexpected errors instead of swallowing them.

**Finalize button interaction is awaited but never acknowledged — user sees "This interaction failed"**
`src/commands/verify.ts:178-191`
The Finalize button is captured via `await uploadMessage.awaitMessageComponent(...)` but the resolved interaction is discarded and never `.update()`/`.deferUpdate()`/`.reply()`'d. `awaitMessageComponent` does not auto-ack, and Discord requires a component interaction to be acknowledged within ~3s, so every successful finalization shows a red "This interaction failed" toast even though verification proceeds (message edited, row inserted, role granted, DM sent). Contrast line 154 where the select-menu interaction *is* acknowledged via `categoryInteraction.update(...)`.
*Fix:* Capture and acknowledge it: `const finalize = await uploadMessage.awaitMessageComponent({...}); await finalize.deferUpdate();` (or `.update({ components: [] })`) before continuing, mirroring the select-menu handling.

**User-uploaded identity documents (badges/IDs) are posted to a hardcoded channel and retained indefinitely**
`src/commands/verify.ts:26, 219-257`
The flow invites users to upload verification documents such as badges and IDs (141-145), and every uploaded image URL is re-posted as embed images into a hardcoded `LOG_CHANNEL_ID = "1430015254053654599"` (26). Despite the "please redact" honor-system prompt, many users will upload un-redacted government IDs / credentials. Consequences: (1) sensitive PII is durably stored in a Discord channel with broad staff access, with no retention/deletion policy, and the attachment CDN URLs remain accessible; (2) the hardcoded, cross-guild channel ID means that in any other guild `guild.channels.fetch(...)` returns null and the entire accountability log — the stated WHY of the feature — is silently skipped while verification still succeeds, or a reused ID could route PII to the wrong channel.
*Fix:* Resolve the log channel from per-guild config (e.g. `guild_config`), restrict it to a least-privilege staff channel, and surface a visible operator warning when it cannot be resolved instead of silently dropping the record. Avoid persisting raw ID images — store only a boolean "documents provided" or a short-lived reference, and document a deletion policy.

**`/stats history export` produces a download link to a non-existent `/exports/` route (always 404)**
`src/commands/stats/history.ts:269-274`
With `export:true`, the handler writes the CSV to `data/exports/<file>.csv` and surfaces a link `${PUBLIC_URL || "https://pawtropolis.tech"}/exports/<filename>` labeled "Download CSV … Link expires in 24 hours". Neither the bot's web bootstrap (`src/startup/web.ts`, `src/web/dashboardApi.ts`) nor the SvelteKit route tree (`web/src/routes`) serves `/exports/...` (no route, static handler, or `@fastify/static` mount). The only export endpoint, `web/src/routes/api/export/+server.ts`, generates its CSV inline and never reads `data/exports`. Every link resolves to a 404 — the export is unusable.
*Fix:* Attach the generated CSV directly to `editReply` via `AttachmentBuilder` (as `export.ts` already does), removing the disk dependency; or add a real authenticated `/exports/:filename` route serving `data/exports` with path-traversal protection. The attachment approach is simpler.

**Exported CSVs accumulate forever in `data/exports` despite the "expires in 24 hours" claim**
`src/commands/stats/history.ts:236-248, 269-274`
Each export `writeFileSync`s a uniquely-named file (`stats-history-<modId>-<ts>-<rand>.csv`, up to `MAX_EXPORT_ROWS=50000` rows) but nothing ever deletes it — no scheduler, startup task, or script honors the advertised 24h expiry. The embed's "Link expires in 24 hours" is therefore false and the directory grows unboundedly. On the 2GB-RAM / constrained-disk host described in `src/db/db.ts`, repeated large exports can fill the volume — and per the finding above these files are never even served.
*Fix:* Stop persisting to disk and attach the buffer to the reply (preferred). If on-disk staging is required, add a scheduler that prunes `data/exports` files older than 24h, or write to an OS temp dir and unlink after streaming.

**Router error-card fallback uses ephemeral `deferReply` + `editReply`, clobbering the source message for component interactions**
`src/events/interactionCreate.ts:1103-1119`
The catch-all safety net calls `ensureDeferred(interaction)` then `postErrorCard(...)`. `ensureDeferred` (`cmdWrap.ts:437-474`) only ever does `deferReply({Ephemeral})` and never handles components via `deferUpdate`. For a button/select that already called `deferUpdate()` and then threw (e.g. redeemreward confirm in `features/artistRotation/handlers.ts:120+`, byteToken confirm), `ensureDeferred` sees `deferred=true` and returns, then `postErrorCard → replyOrEdit → editReply` edits the *original* component message, overwriting the confirmation/panel embed with the public error card. Buttons are routed directly (not via `wrapCommand`), so their post-defer throws land here. The "public so staff can see" comment in `errorCard.ts:224-227` is also wrong when the prior defer was ephemeral.
*Fix:* Make the fallback component-aware: if `interaction.isMessageComponent()` and not yet acknowledged, `deferUpdate()` (or `followUp`) rather than `deferReply`; and when the interaction was acknowledged via `deferUpdate`, deliver the error card with `followUp({ flags: Ephemeral })` instead of `editReply` over the source message.

**Unrecognized modal customId prefixes are silently dropped — no ack, no error card, no log**
`src/events/interactionCreate.ts:726-1025`
The `isModalSubmit()` block handles a fixed set of prefixes (`tk:closemod:`, `help:modal:search`, `v1:modal:`/`v1:avatar:confirm18:`, `v1:gate:reset:`, `isitreal_modal_`). A route-miss error card is posted *only* inside the `v1:modal:`/`v1:avatar:` branch (981-1000). A modal matching none of these prefixes falls through to the end of the function and returns without any acknowledgement, error card, or `ix_route_miss` log; the user sees Discord's generic "Something went wrong" with no trace ID. This is exactly the failure after renaming a modal customId or shipping a new modal without registering its route — invisible in logs. Contrast the slash path (234-251) and the inner modal route-miss, both of which respond and log.
*Fix:* Add a final `else` at the end of the `isModalSubmit()` block that logs `evt:'ix_route_miss'` and posts the same route-miss `postErrorCard`, so any unhandled modal yields an acknowledgement and a reportable trace ID.

### Low

**`review_action` meta `via` mislabels the @user-mention path as `code` (accept and reject)**
`src/commands/gate/accept.ts:336`; `src/commands/gate/reject.ts:213, 222`
`updateReviewActionMeta` is called with `via: uidRaw ? "uid" : "code"`. There are three identifier inputs — `app` (short code), `user` (@mention), and `uid` — but when a moderator acts via the `user` mention, `uidRaw` is null so `via` is recorded as `"code"` even though no short code was used. This corrupts the very analytics the comment at `accept.ts:329-330` says the field exists for ("track whether mods prefer short codes or user IDs"). `reject.ts` records the same mislabel in both its success and fetch-failure meta updates.
*Fix:* Derive `via` from which option was actually provided: `const via = codeRaw ? 'code' : userOption ? 'mention' : 'uid';` and pass that, identically in both files (both call sites in `reject.ts`).

**Welcome "general channel not configured" note depends on brittle error-string matching**
`src/commands/gate/accept.ts:293-327`
In `dm_and_welcome`, when `cfg` and `approvedMember` exist and the role applied but `general_channel_id` is unset, `postWelcomeCard` is attempted and the "general channel not configured" note is surfaced only via a thrown-error string match (`'not configured'`) rather than an explicit pre-check. If that error text ever changes, the user-facing note silently degrades to a raw error string. Low impact, but a brittle coupling.
*Fix:* Pre-check `cfg.general_channel_id` before attempting `postWelcomeCard` and emit the explicit note, instead of relying on string-matching the thrown message.

**`/welcomebatch send` flush has an unguarded window where a concurrent enqueue is silently split off**
`src/commands/gate/welcomebatch.ts:147-159`; `src/features/welcomeBatch.ts:120-157`
`flushSession` snapshots members then `clearTimeout` + `sessions.delete` *before* awaiting `postBatchWelcomeCard`, and the in-memory session map has no locking. If an `/accept` `tryEnqueueWelcome` lands between the snapshot/delete and the network post completing, `sessions.get` returns undefined so the new member is posted as a solo card — splitting what the operator intended as one batch into batch+solo. Inherent to the unguarded Map design; low severity (cosmetic split, no data loss, process-local).
*Fix:* Guard the session with an "is flushing" flag so concurrent `tryEnqueueWelcome` either waits or is buffered into the in-flight batch; or accept the best-effort behavior and document it in the command help.

**Any gatekeeper can flush/close a batch session owned by a different gatekeeper via the send branch**
`src/commands/welcomeBatchContext.ts:118-150`; `src/features/welcomeBatch.ts:204-205`
The "send and close" branch is entered solely when `isMemberBuffered(guild.id, target.id)` is true (118), with no check that the current user opened the session. `addMember` explicitly guards cross-opener interference (`denied_other_opener`), but `flushSession` has none — an asymmetric authorization inconsistency: gatekeeper B is blocked from *adding* to A's session yet allowed to *send/close* it, prematurely flushing A's batch before A finishes queueing. Limited impact since all actors are trusted gatekeepers.
*Fix:* In the `isMemberBuffered` branch, fetch the opener (`getSessionStatus(guild.id).openedBy`) and, if it differs from `interaction.user.id` (and the user is not a bypass/owner), reply that another gatekeeper owns the session instead of flushing.

**Username fallback search checks 25 arbitrary applicants, not applicants matching the query**
`src/commands/search.ts:270-311`
When the query is not a snowflake and no guild member matches, the fallback runs `SELECT DISTINCT a.user_id FROM application WHERE guild_id = ? LIMIT 25` — no `ORDER BY`, no filter on `trimmedQuery`. It then fetches those 25 arbitrary user_ids and substring-matches their username/tag. For any guild with more than 25 distinct applicants (the normal case), a legitimate departed user is very likely *not* among the 25 rows SQLite happens to return, so the command falsely reports `No user found matching "<q>"` even though their applications exist. The "DoS protection" comment masks that the cap also silently caps correctness, breaking the feature's stated purpose ("handles users who applied and then left").
*Fix:* Persist a username/tag at application time (denormalized column or `user_cache`) and filter the SQL with a `LIKE` so the 25 candidates are relevant; or raise/remove the cap and rely on the existing 50ms-per-call rate limiting. At minimum, when 25 candidates are returned with no match, tell the user the search was truncated rather than implying no records exist.

**`searchCommands` scores the full multi-word query against single command names, collapsing every multi-term search to the lowest score**
`src/commands/help/cache.ts:155-184`
After AND-matching individual terms, the scoring block sets `queryLower = query.toLowerCase()` (the entire raw query) and compares it with `lowerName === queryLower`, `.startsWith`, `.includes`, alias includes, etc. For any multi-word query (e.g. "role config") no single command name/alias contains the full string, so all branches fail and every result is scored 50 / `matchedOn='description'`, degrading the subsequent sort to pure alphabetical and defeating relevance ranking. Single-word searches are unaffected; impact is ordering only.
*Fix:* Score against individual terms — compute the best per-term match (max over terms of name exact/startsWith/includes) instead of the whole `query`, or score using the first term and use the rest only for filtering.

**Help component ownership guard is skipped when `message.interaction` is undefined**
`src/commands/help/index.ts:291-298, 378-385`
`handleHelpButton` and `handleHelpSelectMenu` restrict navigation to the original invoker via `const originalUserId = interaction.message.interaction?.user.id; if (originalUserId && interaction.user.id !== originalUserId) { deny }`. `Message#interaction` is deprecated in discord.js v14 (replaced by `interactionMetadata`) and is null/undefined in some contexts/after restarts; because the condition is gated on `originalUserId` being truthy, the guard silently fails open and any user can drive another user's help session. Not a privilege escalation — every downstream view re-derives the member and re-filters by the *clicking* user's id, so a hijacker only sees commands they may themselves see — worst case is mild UX griefing on someone else's non-ephemeral message.
*Fix:* Use `interaction.message.interactionMetadata?.user?.id` (with a fallback to the deprecated field) and treat an unresolved owner as deny-by-default; or compare against a user id encoded into the custom ID at build time. Consider making the help reply ephemeral.

**`handleHelpButton` switch has no `case "search"` — search navigation falls through to "Unknown navigation"**
`src/commands/help/index.ts:326-349`; `metadata.ts:257-264`; `components.ts:260`
`parseHelpCustomId` can return `{ type: 'search', nonce }` for ids matching `^help:search:([a-f0-9]+)$`, but `buildHelpCustomId({ type:'search' })` is never called in `src`, and search results are navigated via the *select-menu* id `help:select:search:${nonce}` (routed to `handleHelpSelectMenu`). So no button ever produces `help:search:<nonce>`, and even if one did, the switch (cases overview/category/command/search_modal only) would hit `default` → "Unknown navigation". Dead/unreachable today, but will silently break if a future component starts emitting that id; the suite never exercises this nav type.
*Fix:* Either add an explicit `case 'search':` that loads the session via `getSearchSession(nav.nonce)` and re-renders, or drop the `search` arm from the button parse path and document it. Add a button-handler test covering a `help:search:<nonce>` id.

**Search-session storage is written on every search but never read**
`src/commands/help/cache.ts:333-388`
`storeSearchSession` (359) is called on every search (`index.ts:267`) and `generateNonce` (352) mints a nonce embedded into the select-menu custom ID (`components.ts:260`), but `getSearchSession` (373) is never called in production code (only tests/graphify artifacts). The select-menu handler (`index.ts:403-413`) ignores the nonce/session entirely and acts on `interaction.values[0]`. The whole `SEARCH_SESSIONS` LRU cache, nonce generation, and `storeSearchSession` are dead weight — allocating crypto `randomBytes` and cache entries per search for data never consumed.
*Fix:* Either remove `SEARCH_SESSIONS`/`generateNonce`/`storeSearchSession`/`getSearchSession` (and simplify `buildSearchComponents` to not need a nonce), or actually use `getSearchSession` in `handleHelpSelectMenu` to validate/restore the search context. Pick one.

**`showSearchResults` branches on `"update" in interaction`, which is true for ALL `ModalSubmitInteraction` at runtime; correct only by accident**
`src/commands/help/index.ts:273-279`
`showSearchResults` uses `if ("update" in interaction)` to distinguish component interactions, then casts to `ModalSubmitInteraction` and calls `editReply`. At runtime discord.js defines `update()` on `ModalSubmitInteraction.prototype` (via `InteractionResponses.applyToClass`), so the predicate is true for *every* modal, not only message-sourced ones. The code is correct today only because the branch body calls `editReply` (valid after the `deferUpdate()` in `handleHelpModal:451`), not `update()`. Fragile and misleading: anyone refactoring the branch to call `interaction.update()` (the natural reading) would crash on plain modals, and the unit test masks this by omitting `update` from its mock. No current user-facing bug.
*Fix:* Branch on a precise predicate: for the modal path call `interaction.editReply` directly (it is always deferred via `deferUpdate`), and for component vs chat-input use `interaction.isMessageComponent()`/`instanceof` checks rather than property presence.

**Health-check timeout timer is never cleared and not unref'd**
`src/commands/health.ts:218-235`
`timeoutPromise` creates `setTimeout(..., HEALTH_CHECK_TIMEOUT_MS=5000)` but the handle is never stored or cleared. On the normal fast path `healthCheckPromise` wins the `Promise.race`, yet the 5s timer still runs to completion on every `/health`, holding its reject closure and the rejected `Error` alive. Unlike `armWatchdog` in `cmdWrap.ts` it is not `unref()`'d, so it can also delay graceful shutdown by up to 5s. Not a happy-path correctness bug (the late rejection is consumed by the race), but an avoidable per-call resource/lifecycle leak in a command anyone can spam.
*Fix:* Capture the handle and `clearTimeout` it in a `finally` (`let t; const timeoutPromise = new Promise<never>((_, reject) => { t = setTimeout(...); }); try { await Promise.race([...]); } finally { clearTimeout(t!); }`) and/or `t.unref()`.

**Health timeout fallback calls `interaction.reply()` although the 5s timeout exceeds Discord's 3s ack window**
`src/commands/health.ts:214, 226-231`
The happy path uses `interaction.reply({embeds:[embed]})` (214); on timeout (5000ms) the catch also calls `interaction.reply({content:'timed out…'})` (226). Since `HEALTH_CHECK_TIMEOUT_MS` (5000) exceeds Discord's ~3000ms initial-response window and the command never defers, by the time the timeout fires the token is already expired, so the fallback reply essentially always fails with 10062 (`.catch()`-swallowed → user sees Discord's generic "application did not respond"); a near-simultaneous success would instead yield a swallowed 40060 double-ack. Net effect: the timeout branch is effectively dead/ineffective UX rather than a crash.
*Fix:* Lower the timeout below 3s and/or `deferReply` up front so a late edit can succeed, or drop the manual timeout race and rely on `wrapCommand` error handling. At minimum use `replyOrEdit` (which already handles deferred/replied/10062/40060) in both branches.

**Audit `channel as TextChannel` cast can be null when the button's channel isn't cached**
`src/commands/audit/members.ts:168` (also 249, 282); `src/commands/audit/nsfw.ts:238, 318, 352`; `buttonRouter.ts:187, 206`
`buttonRouter` passes `channel as TextChannel` where `channel` is `interaction.channel`, which discord.js types as nullable and can be null if the channel is uncached/inaccessible. The runners then call `channel.send(...)`; if null, the first `send` throws a `TypeError`. It is caught by the runner's outer try/catch and the fire-and-forget `.catch`, so it degrades to a logged failure rather than a crash, but the audit silently produces no output. The unchecked cast hides the nullable case.
*Fix:* In `buttonRouter`, guard `if (!channel || !channel.isTextBased()) { reply error; return; }` before launching the runner and narrow to a sendable type rather than casting; or have the runners accept `TextChannel | null` and bail early with a logged warning.

**Dead prefix clause for `v1:avatar:confirm18` modals in the router guard**
`src/events/interactionCreate.ts:769`
The modal dispatch guard `if (customId.startsWith("v1:modal:") || customId.startsWith("v1:avatar:confirm18:"))` includes the second clause solely for the `avatar_confirm18` route. Since no modal with that customId is ever shown and there is no handler branch for it inside the block, the clause only routes such an id into the block where it immediately hits the catch-all "Unhandled modal" error card. Effectively dead and misleading.
*Fix:* Drop the `|| customId.startsWith("v1:avatar:confirm18:")` clause (coordinated with removing `MODAL_18_RE`), or implement the `avatar_confirm18` handler if the feature is meant to ship.

---

## Bot Features

29 confirmed top-level findings across `src/features/*` (after merging duplicates). Ordered by severity.

### Critical

**Byte token redemption is non-atomic with no rollback** — `src/features/byteTokenHandler.ts:312-468`
`handleConfirm()` removes the token role first, then mutates other roles and only writes the DB source-of-truth (`upsertActiveMultiplier`) last, all inside one try/catch with no compensating action. If any step after the token-role removal throws (50013/permission change, 429, gateway hiccup), the token is gone, the multiplier role is never granted, and no row is written to `active_byte_multipliers`. Because role possession *is* the economy, this is silent, irrecoverable destruction of a finite token entitlement for zero value.
*Fix:* Make the DB claim the atomic gate — write the redeemed-token ledger/`active_byte_multipliers` row inside a transaction FIRST, and only then perform Discord role changes; on any later Discord failure, re-add the token role and delete the DB row in a finally/catch. Alternatively add the multiplier role before removing the token role so a mid-flight failure leaves the user holding the (recoverable) token.

### High

**Movie-night and game-night attendance overwrite each other (UNIQUE key missing `event_type`)** — `src/features/events/gameNight.ts:247-287`, `src/features/movieNight.ts:291-326`
`movie_attendance` has `UNIQUE(guild_id, user_id, event_date)` (migrations/025:111); migration 040 added `event_type` but only as a non-unique index, never rebuilding the key. `finalizeMovieAttendance` (`INSERT OR REPLACE`, defaults `event_type='movie'`) and `finalizeGameAttendance` (`event_type='game'`) write the same date-keyed row. If a user attends a movie night and a game night on the same calendar day, the second finalize REPLACEs the first event's row, destroying its attendance/qualification record and corrupting tier counts. `creditHistoricalGameAttendance` (744-757), `bumpGameAttendance` (816-829) and the movie-side adjust helpers have the same `ON CONFLICT(guild_id,user_id,event_date)` collision (the clause cannot even reference `event_type` because it is not part of any unique key).
*Fix:* New migration rebuilding the table (or replacing the unique index) with `UNIQUE(guild_id, user_id, event_date, event_type)`; update every `INSERT OR REPLACE` / `ON CONFLICT` target accordingly.

**Movie tier count includes game-night attendance** — `src/features/movieNight.ts:364-372`
`getUserQualifiedMovieCount()` counts every `qualified=1` row for the user with no `event_type` filter, but game nights persist into the same table with `event_type='game'`. This count drives movie tier-role promotion (`updateMovieTierRole`, :391), so a user who only qualifies for game nights is granted Movie-Night tier roles. `getUserTotalEventCount` (gameNight.ts:344) is likewise unfiltered. The game side (`getUserQualifiedGameCount`, gameNight.ts:331) correctly filters, proving the movie side simply omitted it.
*Fix:* Add `AND event_type = 'movie'` to `getUserQualifiedMovieCount` and decide the intended semantics for `getUserTotalEventCount`.

**Failed thread creation orphans an open modmail ticket, permanently blocking the user** — `src/features/modmail/threadOpen.ts:227-263, 475-487`
The race-protection transaction commits BOTH a `modmail_ticket` row (status defaults `'open'`) AND a `'pending'` open_modmail guard row. If the subsequent Discord thread create throws (transient 500, rate limit, revoked perms), the catch deletes only the pending guard row — never the orphan ticket. With `idx_modmail_open_unique` on (guild_id,user_id,status) WHERE status='open', the user's next attempt re-enters the transaction, `createTicket` violates the partial unique index, and the catch misclassifies the constraint error as a race, returning a generic failure. The applicant can never get a modmail thread again until the orphan row is deleted by hand.
*Fix:* In the catch cleanup, also `DELETE FROM modmail_ticket WHERE id=? AND thread_id IS NULL AND status='open'`, or defer `createTicket` until after the Discord thread exists; stop classifying a ticket unique-index violation as a race.

**Reopen of a deleted-on-close thread commits open-state then throws, leaving an orphan 'open' ticket on a dead thread** — `src/features/modmail/threadReopen.ts:87-127`
Delete-on-close is the default, so most recently-closed tickets have a deleted Discord thread. `reopenModmailThread` commits the `status='open'` transaction and calls `addOpenThread()` BEFORE `channels.fetch(thread_id)`. For a deleted thread the fetch rejects (Unknown Channel 10003) and returns `{success:false}`, but the DB/in-memory mutations already took effect: the ticket is 'open' on a non-existent thread, the open_modmail guard blocks any NEW modmail, and inbound DMs route to a dead thread. The common `/modmail reopen` path reliably lands here while staff are told "Failed to reopen."
*Fix:* Fetch/unarchive the thread BEFORE mutating DB and the in-memory set; if it can't be fetched, fall through to creating a fresh thread (like the >7-day branch) instead of reopening in place.

**`modmail_delete_on_close` opt-out is silently ignored — threads always deleted** — `src/features/modmail/threadClose.ts:365, 546`
Both close paths compute `cfg?.modmail_delete_on_close !== false`, but the column is `INTEGER DEFAULT 1` and `getConfig` returns the raw row with no boolean coercion (config.ts:707-724), so at runtime the value is the number `0` or `1`, never a boolean. `0 !== false` is `true`, so delete is forced even when an admin explicitly set "Delete on Close = off" (stored as `0`). Every close irreversibly deletes the thread/history against explicit opt-out; the archive+lock path is unreachable.
*Fix:* Compare integer truthiness (`!== 0 && !== false`, default true only when null/undefined) or, cleanest, coerce all INTEGER-boolean config columns to real booleans on read in `getConfig`.

**`/audit diff` and dangerous-change detection throw on real permission data (`BigInt` on permission names)** — `src/features/securityDiff.ts:256-257, 346-349, 382, 414`
Every consumer treats `RoleSnapshot.permissions` and overwrite `allow`/`deny` as numeric bitfield strings (`BigInt(...)`), but the only producers (`roleToSnapshot`/`channelToSnapshot`, serverAudit/types.ts:234,252-253) store comma-separated permission NAMES (`role.permissions.join(',')`). `BigInt("ViewChannel")` throws `SyntaxError`. `computeSnapshotDiff` calls `getDangerousChanges` (:247), so it throws whenever a role is added or its permissions change. In diff.ts the catch surfaces the error to the user (broken `/audit diff`); in serverAuditDocs.ts the silent try/catch (:174) means `DIFF.md` is never written and `dangerousChangeCount` stays 0 — Admin/ManageRoles/Ban escalations are never detected or alerted (a security-monitoring failure). The unit test masks it by only ever using `"0"`/`""`.
*Fix:* Make producers and consumers agree on one format. Simplest: set-diff the comma-separated name lists (`new Set(perm.split(','))`) in the role/overwrite comparisons and make `bitfieldToPermissionNames` just `split(',')`. Add a regression test where two roles differ by a named permission.

**`ensureGateEntry` calls `.has()` on `fetchPins().items` (a plain Array), throwing after a successful pin** — `src/features/gate/entryPanel.ts:600-607`
In discord.js 14.26.4 `fetchPins()` returns `{ items: readonly MessagePin[] }` where `items` is a plain Array. The pin-verification block casts it to `{ has }` and calls `pinnedItems.has(message.id)`; arrays have no `.has`, so it throws `TypeError` — inside the try, AFTER `message.pin()` succeeded, and the catch re-throws (:623). Propagated through `withStep('ensure_entry', ...)`, every `/gate setup` (and `/update` re-ensure) surfaces an error card to staff even though the panel was created and pinned correctly. The same file's `findExistingGateEntry` (:160-167) treats `items` as an array, proving the intended shape.
*Fix:* Use array semantics: `Array.isArray(items) ? items.some(it => it?.message?.id === message.id) : false`.

**Review-handler "ephemeral" feedback leaks onto the public review card (deferUpdate + stripped flags)** — `src/features/review/handlers/claimHandlers.ts:62-67, 74-102, 146-150, 178-195, 243-248`; `src/features/review/handlers/modals.ts:49-228, 258-279`; `src/features/review/handlers/buttons.ts:200-204, 270-275`
All these paths run after the parent called `interaction.deferUpdate()` (deferred=true, response = the public review card). They emit feedback via `replyOrEdit(..., { flags: MessageFlags.Ephemeral })`, but `replyOrEdit` takes the deferred branch and explicitly strips `flags` before `editReply` (cmdWrap.ts:503-506), PATCHing the card. Messages meant to be private to one moderator — "already claimed by another moderator", "unclaimed successfully", the unclaim-cancelled notice, and especially "This user has been permanently rejected … cannot reapply" plus leaked failure trace strings — are written publicly onto the shared card, overwriting its content line and clobbering its embed/buttons for all staff.
*Fix:* After an upstream `deferUpdate()`, use `interaction.followUp({ content, flags: MessageFlags.Ephemeral })` for per-moderator feedback (followUp preserves flags and posts a separate ephemeral message), or have `replyOrEdit` route to `followUp` when the interaction was component-deferred. Stop stripping flags for genuinely ephemeral content. (Same root cause underlies the medium-severity `actionRunners.ts`, `modals.ts`, and `helpers.ts:resolveApplication` guard-reply leaks below — fixing `replyOrEdit`/the call sites resolves all of them.)

**Ticket open button has no dedup/cooldown — double-click creates duplicate channels** — `src/features/tickets/handlers.ts:215-257`
`handleOpenButton` defers ephemerally then calls `TicketService.create()` with no per-user/per-type guard, and `create()` (service.ts:214-352) never checks for an existing open ticket of the same type. The `tk:` button route (interactionCreate.ts:582-595) has no `checkCooldown` wrapper. Two near-simultaneous clicks each allocate a ticket number, create a channel, and fire role pings — yielding orphan/duplicate channels, wasted numbers, and duplicate staff pings.
*Fix:* Add a short per-(userId, typeKey) cooldown around `handleOpenButton` and/or short-circuit in `create()` on an existing open ticket; a `UNIQUE` partial index on (opener_user_id, type_key) WHERE status='open' makes it race-proof.

**Byte token double-click TOCTOU re-grants/extends multiplier from a single token** — `src/features/byteTokenHandler.ts:267-394`
The only entitlement check is `roles.cache.has(tokenRoleId)` (:283); the confirm button is never disabled. discord.js does not serialize a user's interactions, so two concurrent `handleUseByteButton` invocations both observe the token role still present (only removed at :314 after several awaited REST calls) and both reach `upsertActiveMultiplier`, whose `ON CONFLICT` overwrites `expires_at` with a fresh full-duration value — silently extending the window for one token. For the epic/legendary pair that share a multiplier role, redeeming both extends the same role to 72h. There is no atomic DB claim.
*Fix:* Gate redemption on an atomic per-token ledger claim (`INSERT OR IGNORE`/`UPDATE … WHERE`, bail if `changes===0`) before any role mutation; disable the confirm button on first click and key the confirmId; make the `ON CONFLICT` path longest-wins on `expires_at`.

**Patreon art entitlements with quantity > 1 are permanently under-granted** — `src/features/patreonArtRewards.ts:175-210`
"Legendary Fiona" grants `emoji:2`, but `handlePatreonArtRewards` assigns the single binary ticket role once regardless of delta and sets `quantity_granted` to the full entitlement via a high-water `MAX()` upsert. Redemption (artistRotation/handlers.ts:125-145) removes the role after one use and tracks no remaining count. After the first redemption the role is gone but `getGrantedQuantity` returns `2 >= 2`, so the 10-minute sweep never re-grants. A patron pays for 2 emoji tickets and can only ever redeem 1.
*Fix:* Track redemptions (a `redeemed`/`remaining` counter on `patreon_art_granted`), decrement on confirm, and re-grant the role whenever `remaining > 0` and the user lacks it; or model quantity>1 as multiple distinct units. Until fixed, no tier should define quantity>1 for a single binary ticket role.

### Medium

**PM2 self-stop kills the process mid-restore, so file replacement/verify/restart never run** — `src/features/dbRecovery.ts:489-559`
`restoreCandidate` with `pm2Coord=true` runs `pm2 stop <processName>` (:506) BEFORE replacing the DB file (:544) and restarting (:620). The live restore button invokes this with the bot itself as the PM2-managed process, so stopping it terminates the event loop: the awaited `execAsync` never resolves and the copy/verify/`pm2 start` steps never execute. The DB is not restored, PM2 may leave the app stopped, and the success reply is never sent (only the pre-restore backup is created).
*Fix:* Don't stop the running bot from within itself — copy + integrity-verify while running, then schedule a detached `pm2 restart` as the final step; or move restore to an out-of-process worker; or use better-sqlite3's online backup API.

**`closeModmailThread`/`closeModmailForApplication` are check-then-act with no atomic guard — concurrent close double-flushes transcript and double-DMs** — `src/features/modmail/threadClose.ts:202-307`
Both guard only with a plain read (`if (ticket.status === 'closed') return`). Two near-simultaneous closes (button double-click, or manual close racing the unawaited auto-close-on-decision) both read 'open' and proceed. `flushTranscript` is not idempotent: the second call finds an empty buffer, reconstructs from `modmail_message`, and posts a SECOND transcript to the log channel; the user gets two "Modmail Closed" DMs, the dashboard two notifications, and two close-log rows. The two close functions share no lock and can race each other.
*Fix:* Make the status flip the atomic gate: `UPDATE … SET status='closed' … WHERE id=? AND status='open'`; if `changes()===0`, another path already closed it — return early and skip transcript/DM/archive/log/notify. Apply the same guarded UPDATE in both functions.

**`/audit security` reports `role.position` as the count of manageable roles** — `src/features/serverAudit/analyze.ts:377`
The ManageRoles scope warning says `Role can assign/remove ${role.position} roles below it`, but `role.position` is the hierarchy index, not the count beneath it. A role at position 50 with 3 roles below it claims it can manage 50. This is misinformation in a security advisory (CONFLICTS.md) shown to leadership and can drive wrong remediation.
*Fix:* Compute the real count: `roles.filter(r => r.position < role.position && r.name !== '@everyone').length` and interpolate that.

**Synchronous DB throw escapes `Promise.allSettled`, defeating partial-results in `/analytics`** — `src/features/analytics/command.ts:165-182`
The `allSettled` input is built by eagerly calling the (synchronous, better-sqlite3) query functions, which re-throw on DB error. A synchronous throw propagates during array construction, BEFORE `allSettled` runs, so it is caught by the outer try/catch (:336) and replies "Analytics query failed" — the opposite of the intended graceful degradation. One failing query blanks the whole command. The test masks it by using `mockRejectedValue` (async rejection) instead of a sync throw. (Note: this module is also dead — see below.)
*Fix:* Wrap each call so a sync throw becomes a rejected promise, e.g. `Promise.resolve().then(() => getActionCountsByMod(...))`, so `allSettled` captures individual failures.

**Analytics CSV export can hang forever (end-listener race), retaining the full buffer + interaction** — `src/features/analytics/command.ts:427-448`
The handler attaches a `data` listener (accumulating the whole CSV into `chunks`), `await`s `streamReviewActionsCSV`, which itself calls `stream.end()` before resolving (csv.ts:253), and only THEN registers `await new Promise(res => stream.on('end', res))`. Because the stream is already flowing and already ended, the terminal `end` can fire before this late listener attaches, so the promise never resolves: the handler is stuck forever, permanently retaining the CSV buffer, PassThrough, attachment closure, and the un-replied interaction.
*Fix:* Register completion BEFORE awaiting the producer (`const done = once(stream, 'end')` then `await Promise.all([exportPromise, done])`), or use `stream/consumers`/`pipeline` and don't have the producer call `end()`; add an `error` handler so a producer error rejects rather than hangs.

**Monthly art leaderboard/stats compare ISO-8601 against SQLite `datetime('now')`, undercounting month-boundary completions** — `src/features/artJobs/store.ts:449-467, 481-495`
`getMonthlyLeaderboard`/`getArtistStats` build the month start via `toISOString()` (`'2026-05-01T00:00:00.000Z'`, `T`/ms/`Z`) and compare `completed_at >= startIso`, but `completed_at` is written by `datetime('now')` (`'2026-05-01 00:00:00'`, space, no ms/Z). Lexically, the stored `' '` (0x20) < `'T'` (0x54) at index 10, so any job completed on the 1st is wrongly excluded; `toISOString()` also shifts local midnight by the server's UTC offset. Result: a recurring silent undercount around month boundaries. The test mocks `db` pass-through and never exercises the comparison.
*Fix:* Make the bound match the stored format/timezone — use `completed_at >= datetime('now','start of month')`, or format the JS Date as UTC `'YYYY-MM-DD HH:MM:SS'` with UTC getters.

**Modmail reopen window mis-computed: UTC SQLite timestamp parsed as local time** — `src/features/modmail/threadReopen.ts:73-85` (also `src/features/modmail/dashboardBridge.ts:304`)
`closed_at` is written by `closeTicket` via `datetime('now')` → `'YYYY-MM-DD HH:MM:SS'` (space, no `Z`); `new Date(ticket.closed_at).getTime()` parses that as LOCAL time per V8. The `now - closedAt > sevenDays` boundary (:77) is therefore skewed by the host's UTC offset (up to ~14h), so tickets near 7 days take the wrong branch (spurious new thread vs. reopening an already-archived thread). The codebase already knows the fix (`reviewCard.ts:110`, `review/card.ts:129`, `queries/shared.ts normalizeTimestamp` all do `replace(' ','T') + 'Z'`); these call sites bypass it. Tests miss it because fixtures feed `Date.toISOString()` (with `Z`), never the production format. *(Consolidates ~10 duplicate reports of the same bug.)*
*Fix:* Normalize before parsing — `new Date(ticket.closed_at.replace(' ','T') + 'Z').getTime()` — or store/compare epoch seconds (`strftime('%s','now')`); apply the same fix at `dashboardBridge.ts:304` and update tests to use the real SQLite format.

**`reopenTicket` can violate the open-ticket partial unique index when a newer open ticket exists** — `src/features/modmail/threadReopen.ts:46-109` / `src/features/modmail/tickets.ts:174-180`
The user-id reopen path selects the most-recent CLOSED ticket and only checks that *that* row isn't open. `reopenTicket` then `UPDATE … SET status='open'`; if the user already has another open ticket (a fresh one opened after the prior close, or the >7-day branch created one), this trips `idx_modmail_open_unique (guild_id,user_id,status) WHERE status='open'`, throws `SQLITE_CONSTRAINT` inside the transaction, rolls back, and surfaces the opaque "Failed to reopen." DB stays consistent, but the failure is confusing and the unarchive/DM side effects never run. *(Consolidates ~6 duplicate reports.)*
*Fix:* Before reopening, check `getOpenTicketByUser(guild_id,user_id)` and short-circuit with a clear message linking the existing thread (or close it first); or catch the constraint specifically and surface "user already has an open modmail thread."

**Review action guard replies overwrite the review card after `deferUpdate`** — `src/features/review/handlers/actionRunners.ts:84-101, 297-339, 460-502, 657-674, 783-826, 939-946`; `src/features/review/handlers/helpers.ts:90-125`
All `run*Action` functions and `resolveApplication` are reached after `deferUpdate()` (deferred=true). Their early guard branches ("Already approved.", "This application is already resolved.", "No application with code XXXXXX.", etc.) call `replyOrEdit` with no ephemeral flag, hitting the `editReply` branch and replacing the card's embed + buttons with a bare public line. The card is not refreshed on these early returns, so it stays clobbered. When two moderators race, the loser destroys the shared card. (Same root cause as the High review-handler leak; the modal-opener guards in `helpers.ts` that run before `showModal` are fine.)
*Fix:* On these post-`deferUpdate` guard branches use `interaction.followUp({ content, flags: MessageFlags.Ephemeral })` (valid after deferUpdate), and optionally refresh the card via `ensureReviewMessage`.

**Permanently-rejected check runs AFTER `claimTx`, orphaning a claim on early return** — `src/features/review/handlers/claimHandlers.ts:83-102`
`claimTx` commits the `review_claim` row first; only then does the perm-reject query run, and on a match the handler returns "permanently rejected … cannot reapply" WITHOUT releasing the claim. The app is now claimed by a moderator told the action failed, blocking other Gatekeepers until an admin force-clears it. Fail-unsafe (state corrupted instead of action cleanly rejected). Trigger requires the user to have both a non-terminal row and a `permanently_rejected=1` row, which admin/unblock paths can produce.
*Fix:* Move the perm-reject check BEFORE `claimTx`; or, if it must stay after, call `clearClaim(app.id)`/`unclaimTx` before returning.

**Non-permanent reject clobbers `permanently_rejected` back to 0** — `src/features/review/flows/reject.ts:79-91`
`rejectTx` always runs `permanently_rejected = (permanent ? 1 : 0)`. The terminal-state guards only short-circuit on status exactly 'rejected'/'approved'/'kicked', but a row can be `permanently_rejected=1` with status 'needs_info'/'submitted' (the flag is a per-(guild,user) blocklist set elsewhere). A normal reject on such a row forces the flag to 0, silently un-banning a previously perm-rejected user. The `permanent_reject_at` CASE correctly preserves its timestamp; the flag itself does not.
*Fix:* `permanently_rejected = CASE WHEN ? = 1 THEN 1 ELSE permanently_rejected END`, mirroring the timestamp CASE, so a normal reject never lowers an existing permanent ban.

**Garbled claim error during panic mode (fragile message parsing)** — `src/features/review/handlers/claimHandlers.ts:49-60`
For `INVALID_STATUS`, the message is built via `err.message.split(' ')[2]`, assuming the terminal-state form "Application already <status>". But `claimTx` throws the same code for panic mode with "Panic mode is active. All review operations are suspended." (reviewActions.ts:62), whose `split(' ')[2]` is "is" — so a moderator clicking Claim during a lockdown sees "Cannot claim: application is already **is**." Misleading exactly when clear messaging matters most. *(Consolidates 3 duplicate reports.)*
*Fix:* Carry the status (or a distinct `PANIC_MODE` code) as structured data on `ClaimError` and branch on it instead of string-splitting; at minimum special-case the panic message.

**`claimTx` writes integer epoch seconds into the ISO/TEXT `claimed_at`, breaking the card's claim timestamp** — `src/features/reviewActions.ts:110-114`
`claimTx` inserts `claimed_at = nowUtc()` (an integer, Unix seconds), but the column is TEXT and the type declares an ISO string. SQLite coerces it to `"1735689600"`; `card.ts:339-342` parses it with `new Date("1735689600")` → Invalid Date → `<t:NaN:R>` on the live "Claim Status" line. `ui/reviewCard.ts:96` has a tolerant parser, so the two renderers disagree.
*Fix:* Pick one canonical format — store ISO text here (`datetime('now')`/`tsToIso(nowUtc())`) to match the type, or make `card.ts` use the tolerant `parseClaimedAt` — and apply it at every read/write of `claimed_at`.

**Unclaim modal "ephemeral" confirmation is not ephemeral and overwrites the card** — `src/features/review/handlers/claimHandlers.ts:158-249`
Reached after `deferUpdate()` from both the unclaim button and the confirmation modal. On success, `replyOrEdit(..., { flags: MessageFlags.Ephemeral })` takes the `editReply` branch which discards `flags` and edits the source card — overwriting the just-re-rendered card (`ensureReviewMessage` ran at :233) with plain "Application … unclaimed successfully." and dropping its embed/buttons. (Same root cause as the High review-handler leak.)
*Fix:* Use `interaction.followUp({ content, flags: MessageFlags.Ephemeral })` for confirmations after a `deferUpdate`; don't `editReply` the card unless that is the intent.

**DM verification sessions looked up by userId only, ignoring guildId — cross-guild misrouting** — `src/features/gate/dmVerification.ts:87-99`
Sessions are stored keyed `${guildId}:${userId}`, but `hasActiveSession`/`getSessionForUser` scan by `session.userId` and return the first match; routing calls them with only the author id. For a user in two bot guilds, a DM answer intended for guild B can be persisted against guild A's `appId` (via `upsertAnswer`) and the Submit button can resolve to the wrong guild's application. Data-integrity-relevant, gated on the dual-guild precondition.
*Fix:* Key all session operations by guild+user — thread `guildId` through message/button routing (it is already in the button customId nonce) and look up via `sessionKey(guildId,userId)`; at minimum disallow >1 active session per user and tie the DM answer deterministically.

**`INSERT OR IGNORE` on whole-second `joined_at_s` silently drops a voice session on same-second rejoin** — `src/features/voiceSessionTracker.ts:23-28, 57-59, 78-94`
`insertVoiceJoin` uses `INSERT OR IGNORE` with `joined_at_s = floor(Date.now()/1000)` against `UNIQUE(guild_id,user_id,channel_id,joined_at_s)`. A leave + same-second rejoin to the same channel collides with the just-closed row and is silently ignored, so no open session exists and voice time goes untracked until the next second boundary (also on a fast A→B→A move). Voice minutes feed newsletter/pulse stats, so this under-counts activity.
*Fix:* Use a plain `INSERT` (the UNIQUE was only for true duplicates), or add a finer discriminator (millisecond precision / monotonic counter), or close+insert atomically so the new row cannot collide with the one just closed.

**`create()` builds the Discord channel before the DB insert — insert failure orphans an untracked channel** — `src/features/tickets/service.ts:241-261`
`guild.channels.create` runs at :241, the tracking-row insert at :252, with no compensating try/catch. If the insert throws (missing table per the lazy-prepare warning, constraint violation, transient SQLite error), the channel already exists with no ticket row — never found by `findByChannelId`, never closed, and the allocated number is consumed. The handler just reports the error, leaving a permanent orphan under the Tickets category.
*Fix:* Wrap the post-create steps in try/catch and `channel.delete()` on insert failure, or insert the row first.

**`resolveApplication` failure replies wipe the review card after `deferUpdate`** — `src/features/review/handlers/helpers.ts:90-125`
Its not-found / guild-mismatch feedback uses `replyOrEdit` with no ephemeral flag; invoked from modal and claim/wrong_password/stale_modmail button paths after `deferUpdate`, it edits the source card to "No application with code XXXXXX." publicly and strips its buttons — turning a benign stale-reference into destruction of the live card. (Same root cause as the High review-handler leak.)
*Fix:* Detect an acknowledged component interaction and use `followUp({ flags: Ephemeral })` for failure messages, or have callers signal whether `deferUpdate` ran.

**Dead analytics modules superseded by `/stats`** — `src/features/analytics/command.ts:1-481`, `src/features/analytics/queries.ts:1-528`, `src/features/analytics/approvalRateCommand.ts:1-196`
`/analytics` (`executeAnalyticsCommand`, `parseWindow`) is not in `SLASH_COMMAND_NAMES`, not registered in `index.ts`, imported only by its test; the startup drift guard (index.ts:274-294) makes it unreachable. `analytics/queries.ts` is transitively dead (only consumer is the dead `command.ts`). `approvalRateCommand.ts` has zero importers repo-wide. Functionality was reimplemented under `src/commands/stats/*`. ~1,200 lines of dead handler/query code plus dead test suites.
*Fix:* Delete the three modules and their tests after confirming `/stats` covers the prior summary/export/approval-rate behavior. Keep the shared `features/analytics/approvalRate.ts` (used by `stats/approvalRate.ts`).

### Low

**Modmail Close button posts confirmation into a thread that was just deleted** — `src/features/modmail/handlers.ts:150-171`
On success `interaction.channel.send(...)` targets the modmail thread, but with the default delete-on-close that thread was already deleted (threadClose.ts:370), so the send throws and is swallowed (:168). The acting moderator gets no visible confirmation. *(Merged with the duplicate report at 162-167.)*
*Fix:* On success send `interaction.followUp({ flags: Ephemeral, content: result.message })`, or skip thread deletion until after confirmation.

**Manual close archives+locks the thread, then immediately deletes it** — `src/features/modmail/threadClose.ts:259-394`
`closeModmailThread` unconditionally `setLocked(true)`+`setArchived(true)` (:266-268) then deletes the thread under the default config (:368-371) — wasted, rate-limited API calls, and a more failure-prone round-trip on an already-archived thread; if delete fails the thread is left archived/locked but the bot isn't removed. Inconsistent with `closeModmailForApplication`, which routes through `archiveOrDeleteThread()` with permission pre-checks and bot-removal fallback. The manual-close DM also omits the transcript that the auto-close path attaches. *(Merged with the duplicate at 259-277/362-394.)*
*Fix:* Skip the eager archive/lock when delete-on-close is enabled (read the config once up front), or refactor to use `archiveOrDeleteThread()`; optionally unify the two paths' transcript-DM behavior.

**Close path has no permission check and target ticket isn't guild-scoped** — `src/features/modmail/threadClose.ts:211-220` and `:202-228`
`closeModmailThread` performs no authorization check; the Close button route (interactionCreate.ts:500-512 → handlers.ts:144-159) calls it directly with no gate (unlike the slash path, commands.ts:65-75). The button is staff-only today, so exposure is low, but the path is unauthenticated by design. Separately, `getTicketByThread(threadId)` selects purely by `thread_id` with no `guild_id` filter, so a reviewer in guild A who learns a guild-B thread ID could close guild B's ticket, causing cross-guild state mismatch.
*Fix:* Add the same permission gate used by the slash command to the button path, and assert `ticket.guild_id === interaction.guildId` after resolving (also in `reopenModmailThread`'s threadId branch).

**Modmail transcript buffer leaks when no log channel is configured** — `src/features/modmail/threadClose.ts:294-307` (and `:505-511`)
Both close paths rely on `flushTranscript` to clear the per-ticket in-memory buffer, but `flushTranscript` only deletes the buffer on its success paths — when `modmail_log_channel_id` is unset it returns early (transcript.ts:119-122) without deleting, and the exception path never deletes either. `clearTranscriptBuffer` is never called in the close flow. Every close in a guild with no log channel leaks the transcript lines into the module-level `transcriptBuffers` Map, growing unbounded.
*Fix:* Call `clearTranscriptBuffer(ticketId)` after `flushTranscript` in both close functions, or have `flushTranscript` delete the buffer in a `finally`.

**Auto-close user DM transcript uses only the in-memory buffer — empty after a restart** — `src/features/modmail/threadClose.ts:441-503, 571-598`
`closeModmailForApplication` builds the applicant's transcript strictly from `getTranscriptBuffer(ticketId)`; if empty it attaches nothing, but `flushTranscript` reconstructs from `modmail_message` for the log channel. After a mid-conversation restart, the log channel gets the full transcript while the closure DM silently omits the copy it promises ("A copy of your conversation is attached below.").
*Fix:* Reconstruct the user transcript from `modmail_message` when the buffer is empty (reuse `flushTranscript`'s query), or fetch the lines once and reuse for both DM and flush.

**`verify_thread` creation is check-then-act — concurrent join creates duplicate/orphaned private threads** — `src/features/gate/threadGate.ts:171-194, 256`
`ensureVerifyThreadForMember` reads the row, and on absence `createVerifyThreadForUser` creates the Discord thread then upserts the row, with awaits in between and no lock. A re-delivered `guildMemberAdd` or fast leave→rejoin makes both invocations see no row, both create a thread, and the second `ON CONFLICT DO UPDATE` overwrites `thread_id`, orphaning the first thread (and posting two welcome pings). The DB stays single-valued, so it's a thread leak, not corruption.
*Fix:* Pre-claim the slot with `INSERT … ON CONFLICT DO NOTHING` and bail if `changes===0` before creating the thread, or guard with a per-(guildId,userId) async mutex.

**Byte-token confirm double-click can double-process the redemption body** — `src/features/byteTokenHandler.ts:283-302, 353-394`
Even with the Step-3.5 de-stack cleanup, the redemption is gated only on the stale `roles.cache.has(tokenRoleId)`, the confirmId isn't consumed, and there's no cooldown, so both clicks can pass the gate and run `upsertActiveMultiplier` + the audit log twice (the cleanup only removes duplicate multiplier roles). A subset of the High TOCTOU finding above; better than `/redeemreward` but not race-free.
*Fix:* Treat the token-role removal as the atomic claim (proceed only if `roles.remove` succeeds and a forced refetch confirms possession), or consume the confirmId in a DB transaction, and disable the confirm button on first click.

**`redeemreward` override path increments artist stats outside the rotation transaction** — `src/features/artistRotation/handlers.ts:224-242`
The non-override path uses the `processAssignment()` transaction, but the override branch reads `getArtist()` (:224) and calls `incrementAssignments()` (:240) as separate statements with no surrounding transaction. The increment is atomic, but the `oldPosition` read and the `logAssignment` write aren't coordinated, so concurrent overrides on the same artist can interleave and report inconsistent `oldPosition`. Stats/log accuracy only (no economy double-spend, since override doesn't rotate).
*Fix:* Route the override through a small transaction that re-reads state and increments atomically.

**Welcome render dereferences `member.user.username` without a guard** — `src/features/review/welcome.ts:305-313`
`tag: member.user?.tag ?? member.user.username` — the fallback drops optional chaining, so a nullish `member.user` (partial/uncached member) throws `TypeError` and aborts the welcome post. Inconsistent with `buildDefaultWelcomeMessage` (:147) which guards every hop. *(Consolidates 3 duplicate reports at 305-313/310/311.)*
*Fix:* `member.user?.tag ?? member.user?.username ?? member.id`.

**`removeRole` skips audit logging on member/role-not-found** — `src/features/roleAutomation.ts:333-357`
`assignRole` logs a 'skipped' `role_assignments` row on every early return, but `removeRole`'s equivalent early returns don't call `logRoleAssignment`. Auditing role activity shows failed adds but silently omits failed removes, undermining the advertised full audit trail.
*Fix:* Add `logRoleAssignment(..., 'skipped', reason, ...)` to both `removeRole` early-return branches, matching `assignRole`.

**`vote_out` voter ordering nondeterministic on same-second votes** — `src/features/review/queries.ts:119-121, 123-125`
`getVoteOutVotersStmt` orders by `created_at ASC`, but `created_at` is TEXT from `datetime('now')` (1s resolution); same-second votes get identical values and SQLite gives no stable tiebreak, so the public attribution ("X and Y voted … out.") and button-label order can vary between renders.
*Fix:* `ORDER BY created_at ASC, id ASC` in both queries (or store an integer epoch).

**`logActionPretty(guild!, ...)` non-null assertion drops the gate_submit audit row when guild is uncached** — `src/features/gate/dmVerification.ts:534-571`
`guild` is `Guild | undefined` (`.cache.get`) and the `if (guild)` block handles undefined for member fetch, but :565 uses `guild!`. `logActionPretty` dereferences `guild.id` synchronously (pretty.ts:488); if uncached, the rejected promise is swallowed by `.catch()` (:571), so the gate_submit audit row is silently never written.
*Fix:* `if (guild) { await logActionPretty(guild, {...}).catch(...); }` (guild was already fetched/checked) — don't use `!`.

**Zero-duration / 0% threshold qualifies everyone (including zero-attendance users)** — `src/features/gate/gameQualification.ts:43-54`
`requiredMinutes = ceil(eventDurationMinutes * pct/100)`; if an event is ended near-instantly (duration 0) or threshold is 0, `requiredMinutes = 0` and `userMinutes >= 0` marks every tracked user (even 0-minute) as qualified, which `gameNight.ts:270-287` writes as `qualified=1` and grants on. `attendancePercentage` is also uncapped (can exceed 100%).
*Fix:* Treat non-positive duration as non-qualifying and require `userMinutes > 0`; clamp `requiredMinutes` to ≥1 when threshold>0 and clamp percentage to 100.

**Thread-session follow-up questions sent to `message.channel`, ignoring `targetChannelId`** — `src/features/gate/dmVerification.ts:397-413`
`handleDmAnswer` routes purely off `message.channel` with no assertion that it equals `session.targetChannelId`. A user with an active thread session who types in DM still gets the next question/summary in the DM channel, splitting the flow across channels; answers can also be accepted from the wrong channel.
*Fix:* If `session.targetChannelId` is set, verify `message.channel.id === session.targetChannelId` before accepting, and send follow-ups to the resolved target channel.

**Duplicate DM verification sessions / duplicate first-question DMs on rapid double-click** — `src/features/gate/dmVerification.ts:189-326`
`startDmVerification` checks `activeSessions.has()` (:191) but inserts only at :326 after several awaits, so two Verify clicks both pass the check, both send a first-question DM, and the second `set()` orphans the first message's Cancel button under the old nonce. Limited impact (draft is idempotent, stale nonce rejected) but a genuine unguarded check-then-act.
*Fix:* Reserve the session slot synchronously (placeholder/in-progress marker) immediately after the check and before any await, or wrap in a per-(guild,user) async mutex.

**`getClaim` casts to `ReviewClaimRow` but omits `app_id`** — `src/features/review/claims.ts:61-66`
The SELECT returns only `reviewer_id, claimed_at` yet casts to `ReviewClaimRow` (non-optional `app_id`); at runtime `app_id` is `undefined` while the type says present. The sibling in reviewActions.ts:209 selects `app_id`. No crash today (consumers read only the other two fields) but an unsound cast that will silently yield `undefined` for any future `claim.app_id` reader.
*Fix:* Add `app_id` to the SELECT, or narrow the return to `Pick<ReviewClaimRow,'reviewer_id'|'claimed_at'>`.

**`claimedAtToDate`/`claimedAtToEpoch` mis-parse the stored epoch-seconds string** — `src/features/review/types.ts:74-85`
These helpers `new Date(claimed_at)` and treat it as ISO, but `claimed_at` is an epoch-seconds numeric string (from `nowUtc()`), so they return Invalid Date / NaN. Currently dead code (no callers), but a latent trap for any future caller trusting the JSDoc.
*Fix:* Make them tolerant of epoch-seconds/ms numeric strings (detect all-digit string → seconds), or delete them and standardize on `parseClaimedAt`; also fix the `ReviewClaimRow.claimed_at` type/comment.

**Idempotent re-claim still posts a duplicate public message + dashboard event** — `src/features/review/handlers/claimHandlers.ts:35-150`
`claimTx` treats a re-claim by the same moderator as a no-op (no `review_action`, no error), but `handleClaimToggle` can't distinguish it and still logs the claim, calls `logActionPretty`, fires `notifyDashboard('review:claimed')`, and posts another public "claimed this application." The cooldown suppresses most rapid double-clicks, but a click outside the window yields duplicate chatter.
*Fix:* Have `claimTx` signal whether a new claim was created (boolean / benign `ALREADY_OWNED` sentinel) and skip the public message + dashboard notify when the claim already belonged to the same moderator.

**`runVoteOutAction` uses raw `followUp` relying on an upstream `deferUpdate` its type doesn't guarantee** — `src/features/review/handlers/actionRunners.ts:843-849, 899-905`
The function accepts `ChatInputCommandInteraction` too; `followUp` throws `InteractionNotReplied` if neither deferred nor replied. The vote-out modal defers first (safe today), but any future slash caller that doesn't defer would make these calls throw, caught only by a try/catch that isn't present on a raw call, leaving the moderator with no feedback. The terminal/missing-reason guards nearby use `replyOrEdit` and are robust.
*Fix:* Use `replyOrEdit(..., { flags: MessageFlags.Ephemeral })` for these notices, or assert/ensure the interaction is deferred at function entry.

**Approval role-grant-failure path leaves stale action buttons on an approved app** — `src/features/review/handlers/actionRunners.ts:125-149`
When `accepted_role_id` is set but the grant fails, the function logs, posts an error, updates meta, notifies the dashboard, and returns — but never calls `ensureReviewMessage`, while `approveTx` already committed status='approved'. The card still shows pending approve/reject/kick buttons (subsequent txs correctly no-op, so no double-action, but the card misleads and the success/role-note summary is skipped). UX/observability only.
*Fix:* `await ensureReviewMessage(interaction.client, app.id).catch(...)` before returning, consistent with the other terminal paths.

**`withTimeout` never clears its 30s timer — leaks a timer per DM (reject.ts and kick.ts)** — `src/features/review/flows/reject.ts:26-33, 130-137` (and `src/features/review/flows/kick.ts:29-36`)
`Promise.race` against a `setTimeout(...,30000)` whose handle is never captured or cleared; on the normal (work resolves first) path the timer stays pending until it fires (up to three per kick). Modest in production but keeps the event loop active under bursts and leaves real timers alive after tests.
*Fix:* Capture the handle and `clearTimeout` in a `finally` around the `Promise.race`, in both files.

**Legacy ping regex `/^v1:ping:(.+)$/` also matches `v1:ping:delete:*` (latent routing collision)** — `src/features/review/handlers/buttons.ts:388, 416-419`
The matcher would mis-handle delete-ping customIds (payload `delete:<id>` → "Invalid ping button data."). Masked today because interactionCreate.ts:514 routes `v1:ping:delete:` first, but any dispatcher reorder or direct call breaks it.
*Fix:* Tighten the pattern to require a user segment and exclude `delete:` (e.g. `/^v1:ping:(?!delete:)(.+:user\d+)$/`), or rely solely on the centralized `BTN_PING_UNVERIFIED_RE`.

**Garbled INVALID_STATUS message for panic mode (second instance)** — `src/features/review/handlers/claimHandlers.ts:49-51`
Same fragile `err.message.split(' ')[2]` defect surfacing "application is already **is**" during panic mode (and a needless `ensureReviewMessage` refresh). Covered by the Medium panic-mode finding above; listed for completeness as a low-severity sibling call site.
*Fix:* Same — branch on a structured `ClaimError` field / `PANIC_MODE` code instead of word-index parsing.

**Private-thread mod-add loop relies on cache-only `role.members` (currently dead path)** — `src/features/modmail/threadPerms.ts:182-221`
The private-thread branch iterates `role.members` (cache-only); without a full member fetch, large guilds would miss mods. Unreachable today because modmail creates only public threads (early return at the `isPublic` check), so it's a latent foot-gun. *(Merged with the duplicate at 183-221.)*
*Fix:* If private threads are ever added, fetch members explicitly (`guild.members.fetch()`) or rely on parent-channel `SendMessagesInThreads` overwrites; otherwise remove the unreachable branch.

**Post-thread-creation failure returns "Failed to create" though the thread exists** — `src/features/modmail/threadOpen.ts:440-497`
Thread creation, perms, `registerModmailThreadTx`, and `addOpenThread` all run before `thread.send` / the applicant DM. If a later step throws, the catch only deletes `thread_id='pending'` rows (the real registered row/ticket correctly survive), but the function still returns a generic failure — telling the moderator it failed while a fully routable thread exists, prompting confusing duplicate-open attempts.
*Fix:* Track a "thread created+registered" flag; in the catch, if set, return success (or "thread created but follow-up failed" with the link) instead of a generic failure.

**`close()` writes the permanent archive before applying the closed state** — `src/features/tickets/service.ts:458-467, 544-569`
`writeArchive(ticket)` (:465) serializes the in-memory object fetched by `findById` (status='open', `closedAt=null`, `closeReason=null`) *before* `getSetClosedStmt()` (:466) flips the state. The long-term audit record therefore records the ticket as still open.
*Fix:* Run `getSetClosedStmt()` first, then re-read (or mutate the local object's status/closedAt/closeReason/closedByUserId) and pass the closed snapshot to `writeArchive`.

**`notify_cooldown_seconds` / `notify_max_per_hour` of 0 coerced to defaults** — `src/features/notifyConfig.ts:83-84`
`row.notify_cooldown_seconds || 5` and `|| 10` (repeated in notifyLimiter.ts:75-76) replace a legitimate `0`, so an admin can't set zero cooldown or a hard 0/hour disable.
*Fix:* Use `??` for the numeric defaults in both places so an explicit 0 is preserved.

**`getWsPing` treats a genuine 0ms ping as unavailable (-1)** — `src/features/opsHealth.ts:110-115`
`!_cachedClient.ws.ping` maps both the pre-heartbeat -1 and a real 0 to -1. The alert check guards with `> 0`, so the only impact is the dashboard showing -1 in the unlikely 0ms case.
*Fix:* `const p = _cachedClient?.ws.ping; return (typeof p === 'number' && p >= 0) ? p : -1;`

**`listCandidates` maps `foreign_key_violations` from the `row_count` column** — `src/features/dbRecovery.ts:205-207`
`foreign_key_violations: existingMeta?.row_count` is a copy-paste error; `db_backups` has no FK-violation column, so cached candidates display the total row count as the FK-violation count (a healthy backup appears to have thousands of violations).
*Fix:* Set `foreign_key_violations: undefined` (it isn't persisted), or add and persist a real column — don't alias `row_count`.

**`event_type='movie'` omitted on movie writes (relies on column default)** — `src/features/movieNight.ts:291-296`
Movie inserts rely on the table DEFAULT 'movie' instead of writing `event_type` explicitly; combined with the unfiltered reads, movie rows aren't positively tagged, so any future default change or UPDATE path can mislabel them. Game-night code always writes it explicitly. Root enabler of the cross-type bugs above.
*Fix:* Write `event_type='movie'` explicitly in all movie INSERT/REPLACE statements.

**`finalizeMovieAttendance` clears ALL guilds' in-memory sessions** — `src/features/movieNight.ts:341-345`
`movieSessions.clear()` wipes every guild's sessions, not just `guild.id`. If two guilds run movie nights concurrently, ending one discards the other's in-progress tracking (minutes since the last 5-min checkpoint are lost).
*Fix:* Delete only this guild's keys (`key.startsWith(guild.id + ':')`), matching the per-guild deletion in gameNight.ts:305-309.

**Crash recovery loads game-night sessions into the movie session map** — `src/features/movieNight.ts:588-623`
`recoverPersistedSessions()` reads `active_movie_events`/`active_movie_sessions` with no `event_type` filter, even though game nights share those tables. The game recovery correctly filters `event_type='game'`, so at startup game rows are pulled into both maps and later finalized as movie attendance. (Note: this is medium-severity data-integrity; included here adjacent to the related movie findings.)
*Fix:* Add `WHERE event_type='movie'` (or `IS NULL` for legacy rows) to both SELECTs, mirroring gameNight.ts.

**Dead defensive check in `closeModmailForApplication`** — `src/features/modmail/threadClose.ts:456-460`
`getOpenTicketByUser` only returns `status='open'` rows, so `ticket.status !== 'open'` is unreachable; the guard can fire only via `!ticket` and won't catch a 'closed' ticket.
*Fix:* Drop the redundant status comparison, or fetch via a status-agnostic lookup if a real re-check is intended.

**Unreachable null branch in `lensUrl` ternary** — `src/features/modmail/threadOpen.ts:369-371`
`displayAvatarURL()` always returns a non-empty string, so the `avatarUrl ? ... : null` ternary and the later `if (lensUrl)` guard are dead/misleading.
*Fix:* Drop the dead null branch/guard and build `lensUrl` unconditionally.

**Banner sync logs the full guild banner CDN URL** — `src/features/bannerSync.ts:117-138`
Not a secret (public CDN link); noted only for completeness — log noise, no PII/credential exposure.
*Fix:* Optional — drop `guildBannerURL` from the info log to reduce noise. No security defect.

**`findAppByCodeOrMessage` messageId branch doesn't verify the app belongs to the requesting guild** — `src/features/appLookup.ts:138-150`
The Priority-1 messageId path fetches the application by id with no `app.guild_id === guildId` check, unlike the short-code and full-id branches (the test even documents the expected guild check). Latent today (no production caller), but an attacker-influenced messageId could resolve a cross-guild application.
*Fix:* Assert `app.guild_id === guildId` before returning (mirroring the full-id branch) and annotate the return type.

**`findAppByCodeOrMessage` has an inferred union/any return type** — `src/features/appLookup.ts:123-168`
No declared return type; the messageId branch returns raw `unknown`, the others `ApplicationRow`/`AppRow`, so callers get a widened/unchecked type — making it easy to introduce a real bug (compounds the missing guild check above).
*Fix:* Declare `ApplicationRow | null` and cast each branch consistently, normalizing the messageId branch.

---

## Bot Core / Lib / Other

### Critical

**Failed remote DB migration is swallowed, then PM2 restarts new code against an un-migrated database** — `deploy.sh:435,449-455`
- Impact: Step 6.5 runs `ssh_remote "... node scripts/migrate-remote.js" || echo "Migration step completed (may have warnings)"`. The `|| echo` always exits 0, so a non-zero migration exit is discarded even under `set -euo pipefail`. Control proceeds to Step 7, which unconditionally runs `pm2 startOrRestart`, bringing up the new bot/web code against an un-migrated (or half-migrated) schema. This produces a green-looking deploy and a bot that throws at runtime on missing columns/tables (cf. `src/config/flaggerStore.ts:211`). Directly contradicts the promise in `docs/reference/database-schema-safety.md:13` ("If a migration fails, the rest of the deploy bails."). The pre-deploy backup does not help because code is still rolled forward over the old schema.
- Fix: Do not swallow the migration exit code. Remove the `|| echo ...` so `set -e` aborts, or capture status explicitly and abort before the PM2 restart: `if ! ssh_remote "cd ${REMOTE_PATH} && node scripts/migrate-remote.js"; then echo 'ERROR: migration failed, aborting deploy (code NOT restarted)'; exit 1; fi`. Keep the lock trap so the lock releases on abort.

### High

**Parallel `--no-tests` deploy path lacks lock/backup/health-check and duplicates the swallowed-migration bug** — `deploy-no-tests.sh:1-42`
- Impact: A second, fully independent deploy script targets the same prod host/path/PM2 process as `deploy.sh`. It (a) repeats the swallowed-migration defect at line 25 (`node scripts/migrate-remote.js || echo "Migration step completed (may have warnings)"`), (b) has no deploy lock so it can race a concurrent `deploy.sh` run (deploy.sh's `mkdir` lock at line 83 does not protect against this script), (c) takes no pre-deploy DB backup, and (d) has only a best-effort `pm2 show | grep` check with no Discord-ready verification. An operator using this "fast" path silently loses every protection added in the 2026-05-02 hardening pass.
- Fix: Delete `deploy-no-tests.sh` and fold its behavior into `deploy.sh --fast` (which already exists, lines 159-162), so there is exactly one hardened deploy path with the lock, backup, and migration-abort logic.

**`replyOrEdit` silently drops the ephemeral flag and edits the source message after `deferUpdate()`, clobbering shared review/confirmation cards** — `src/lib/cmdWrap.ts:500-517`
- Impact: `replyOrEdit()` branches on `interaction.deferred/replied`, but discord.js sets `deferred=true` for BOTH `deferReply()` and `deferUpdate()`. The deferred branch (503-506) strips flags (`const { flags, ...editPayload } = withFlags`) and calls `editReply()`. After a component interaction's `deferUpdate()`, `editReply()` edits the ORIGINAL message the component was attached to — it does not create an ephemeral reply. So callers doing `deferUpdate()` then `replyOrEdit({ content, flags: Ephemeral })` (1) lose ephemerality and (2) overwrite the source message. Routinely triggered: two mods click Claim at once; the loser hits `ALREADY_CLAIMED` and calls `replyOrEdit({content:'...already claimed...', flags: Ephemeral})` (`claimHandlers.ts:62-67`) after `handleReviewButton` already called `deferUpdate()` (`buttons.ts:177-181`), wiping the shared review card (embed, applicant info, all action buttons) publicly for every mod. Same pattern at `claimHandlers.ts:74,91,178,190,243`. This is the shared root cause behind the High review-handler leak and several Medium/Low review findings.
- Fix: Distinguish `deferReply`-state from `deferUpdate`-state (track how the interaction was acknowledged, or check `interaction.isMessageComponent() && deferred`), and in that case send feedback via `interaction.followUp({ ..., flags: MessageFlags.Ephemeral })` instead of `editReply`. Stop discarding `flags` on the `editReply` branch when an ephemeral follow-up is intended.

**Linked Roles "security" test suite never imports the module under test — every assertion is tautological** — `tests/web/linkedRoles.test.ts:1-343`
- Impact: The header claims unit tests for the Discord Linked Roles OAuth2 server verifying "rate limiting, state validation, and HTML escaping", but it never imports `src/web/linkedRoles.ts`. Every test re-declares the value it then asserts (e.g. `RATE_LIMIT_WINDOW_MS` at 26-28; a local re-implementation of `checkRateLimit` at 49-69; a private copy of `escapeHtml` at 104-138). This is the only coverage for an unauthenticated, internet-facing HTTP server doing OAuth2 token exchange, CSRF state validation, per-IP rate limiting, and HTML-escaping of attacker-controlled query params into responses. A regression in the real `escapeHtml` (XSS), `validateState` (CSRF bypass/replay), `checkRateLimit`'s `>=` boundary (off-by-one), or redirect_uri/scope construction would be invisible to CI.
- Fix: Export the pure helpers (`escapeHtml`, `checkRateLimit`, `generateState`, `validateState`, `evictOldestEntries`) from `src/web/linkedRoles.ts` and assert against them with adversarial inputs (expired/replayed state tokens, `count == maxRequests` boundary, `<script>` payloads) instead of local copies.

### Medium

**Sentry `beforeSend` only scrubs `event.message`, not exception values — secrets in thrown errors reach Sentry unredacted** — `src/lib/sentry.ts:114-133`
- Impact: `beforeSend` applies the Discord-token regex and env scrubbing only to `event.message` and `event.contexts.runtime.env`. But `captureException()` (the primary path, used by the `uncaughtException`/`unhandledRejection` handlers in index.ts and throughout the codebase) puts error text in `event.exception.values[].value` and stack frames, NOT `event.message`. So a Discord token, DSN, or other secret appearing in a thrown Error's message/stack is sent verbatim with no redaction, defeating the stated purpose.
- Fix: In `beforeSend`, also iterate `event.exception?.values` and run the same token regex on each `value.value` (and optionally stack frames, breadcrumb messages, `event.request`). Factor redaction into a helper applied uniformly. Consider `sendDefaultPii:false` plus Sentry's built-in data scrubbing.

**Sentry `onFatalError` calls `process.exit(1)` immediately, bypassing the app's delayed-flush and buffered-write flush** — `src/lib/sentry.ts:99-105`
- Impact: `onUncaughtExceptionIntegration.onFatalError` logs then synchronously calls `process.exit(1)`. But `src/index.ts:54-63` installs its own `uncaughtException` handler that intentionally does `setTimeout(() => process.exit(1), UNCAUGHT_EXCEPTION_EXIT_DELAY_MS)` to give Sentry time to flush. The integration's immediate exit preempts that delay, so (a) the Sentry capture may not finish flushing, and (b) buffered writes drained only on the SIGTERM/SIGINT graceful path (`messageActivityLogger.flushOnShutdown`, `messageArchive.flushArchiveBuffersOnShutdown`, voice session close, DB close) are skipped on an uncaught exception, risking lost activity/archive data. The "let app handle gracefully" comment contradicts the immediate exit.
- Fix: Do not call `process.exit(1)` inside `onFatalError`. Let the app's own handler own the exit after its flush delay, or in `onFatalError` await `Sentry.close(timeout)` and trigger the same buffer-flush sequence first. At minimum replace the immediate exit with a `setTimeout` matching `UNCAUGHT_EXCEPTION_EXIT_DELAY_MS`.

**`SILENT_FIRST_MSG_DAYS` env var silently overrides a guild's explicit DB value of 7** — `src/config/flaggerStore.ts:159-170`
- Impact: `getFlaggerConfig` uses `silentDays === 7` as the sentinel for "DB had no value", but 7 is also a valid, explicitly-settable per-guild value (`setSilentFirstMsgDays` accepts 7..365, line 236, with 7 the minimum). If a guild deliberately sets `silent_first_msg_days = 7` and the env var differs (e.g. 30), the DB read sets `silentDays = 7`, then line 166 sees `=== 7` and overwrites it with the env value — silently discarding the guild's explicit choice and changing flagging behavior. This violates the documented DB > ENV priority for exactly the value 7; the in-code comment acknowledges the fragility.
- Fix: Track whether the DB actually supplied a value instead of overloading the magic number. e.g. `let dbDays: number | null = null;` set from `row.silent_first_msg_days` when non-null; apply the env fallback only when `dbDays === null`; finally `silentDays = dbDays ?? envDays ?? 7`.

**`pretty.test.ts` exercises zero source code — entire audit-logging suite is tautological** — `tests/logging/pretty.test.ts:1-499`
- Impact: The file purports to test `src/logging/pretty.ts` (`logActionPretty`/`getActionMeta`/the `action_log` INSERT/embed building) and sets up `vi.mock` for db, logger, time, loggingStore, features/logger, but never imports anything from `pretty.js`. Every `it(...)` re-declares a local literal and asserts on it (e.g. a `meta` object at 178-182; `'INSERT INTO action_log'` substring at 266; `JSON.stringify` equality at 287-291; `appId.slice(-6).toUpperCase()` length at 343-347). None call `getActionMeta()`, `logActionPretty()`, or any real symbol. The suite stays green if `pretty.ts` is deleted, if a meta color/emoji/title is wrong, if the `action_log` INSERT columns break, or if meta-field rendering regresses — dangerous false confidence for the single source of truth for the moderation audit trail (which powers `/modstats`).
- Fix: Import the real symbols and assert behavior: call `logActionPretty(mockGuild, params)` and verify `mockPrepare`/`mockRun` received the expected `action_log` INSERT with the right bound params; verify the embed title/color via the mocked `EmbedBuilder`; verify the no-channel branch calls the mocked `logActionJSON` with the correct payload. Delete the literal-only assertions.

**`clearStaleAcknowledgments` deletes ALL acks when `validKeys` is empty (`json_each` NOT IN empty set)** — `src/store/acknowledgedSecurityStore.ts:210-230`
- Impact: The query is `DELETE ... WHERE guild_id = ? AND issue_key NOT IN (SELECT value FROM json_each(?))`. When `validKeys` is empty, `keysJson` is `'[]'`, `json_each('[]')` yields zero rows, and `issue_key NOT IN (<empty>)` is TRUE for every row — every acknowledgment for the guild is deleted. The sole caller (`src/features/serverAuditDocs.ts:76-77`) builds `validKeys` from `analyzeSecurityIssues()`. If a transient/partial Discord fetch yields incomplete data so analyze produces zero issues, every previously-acknowledged issue is permanently wiped and reappears as "new" on the next clean audit, spamming staff. (For a genuinely clean server the delete is harmless because nothing remains to ack.)
- Fix: Guard the empty case: `if (validKeys.size === 0) return 0;` before the delete, and/or only prune when the audit fetch is known complete (roles/channels non-empty), or skip the prune when `issues.length === 0` in `serverAuditDocs.ts`.

**`env.test.ts` schema has drifted from `src/lib/env.ts` and asserts the OPPOSITE of real behavior** — `tests/env.test.ts:30-38, 41-73, 94-106`
- Impact: The test defines its own local `envSchema` (30-38) and never imports the real schema. Two drifts make it misleading: (1) NODE_ENV — local enum is `["development","production"]` (line 34); the real schema (`src/lib/env.ts:118`) is `["development","production","test"]`. The test explicitly asserts `"test"` is REJECTED (comments at 28/94/96), but the real schema ACCEPTS it; the only NODE_ENV-negative case uses `"staging"` (line 101), which fails in both, hiding the drift. (2) RESET_PASSWORD — the real schema requires it (`env.ts:136`, `.min(1)`); the local schema omits it, so the "complete environment" (41) and "apply default values" (61) cases pass here but would fail against the real schema. A real regression (removing the RESET_PASSWORD requirement, or restricting NODE_ENV to drop `"test"` and breaking the test run-mode at `env.ts:32`) would not be caught.
- Fix: Import and test the actual schema/env module instead of a hand-maintained copy (export the zod schema from `env.ts` and import it, or drive `process.env` + dynamic import). At minimum sync the local enum to include `"test"`, add RESET_PASSWORD to the required-field tests, and fix the incorrect comments at 28/94/96.

**Recurring schedulers run on `setInterval(async …)` with no re-entrancy guard — overlapping ticks duplicate work** — `src/scheduler/securityAuditScheduler.ts:338-362`
- Impact: Every scheduler uses `setInterval(async () => { try { await work() } … }, MS)` with no in-flight flag (`securityAuditScheduler.ts:349`, `guildSnapshotScheduler.ts:117`, `staleApplicationCheck.ts:393`, `modMetricsScheduler.ts:100`, `byteMultiplierScheduler.ts:210`, `diskSpaceScheduler.ts:247`, `eventTimeoutScheduler.ts:83`). `setInterval` does not await the callback, so if one run's awaited work (Discord REST, `guild.fetch()`, `generateAuditDocs` walking all roles/channels + saving a snapshot) exceeds the interval, the next tick starts a second concurrent run. For securityAudit, two overlapping runs each call `generateAuditDocs`/`saveSnapshot` (`securitySnapshotStore.ts:243`) and each post leadership pings (`securityAuditScheduler.ts:195`) — duplicate critical-alert pings and a diff against a snapshot the other run just wrote. `guildSnapshotScheduler` also mutates `_snapshotCount` non-atomically (`:94`), perturbing the "fetch online every 6th run" cadence. Unbounded if any single run hangs on a slow API call.
- Fix: Add a module-level `let running = false` (or shared promise) at the top of each callback: `if (running) { logger.warn('previous run still in flight, skipping'); return; } running = true; try { await work() } finally { running = false; }`. This also fixes the `_snapshotCount`/`_lastAlertTime` ordering issues.

**Scheduler deletes the multiplier DB row even when panic mode blocks role removal, and SELECT-then-DELETE is non-atomic across overlapping ticks** — `src/scheduler/byteMultiplierScheduler.ts:35-109, 99-109`
- Impact: `cleanupExpiredMultipliers` calls `removeExpiredMultipliers()` which SELECTs all expired rows then DELETEs them as two separate statements (`byteMultiplierStore.ts:182-204`), not in a transaction. The scheduler runs an immediate startup pass (197-207) AND a periodic interval (210-218); if the startup pass is still awaiting Discord REST when the first interval fires, a second invocation can SELECT the same not-yet-deleted rows and process them twice — double-removing roles and double-logging `byte_multiplier_expired`. Separately, `processExpiredMultiplier` early-returns under panic mode (100-109) AFTER the row was already deleted, so the multiplier role is left on the member with no tracking row; when panic clears, nothing retries removal (the XP boost outlives its paid window). Both issues stem from deleting the authoritative row before the side effect it drives is confirmed.
- Fix: Wrap the SELECT+DELETE in a single `db.transaction` so a batch is claimed atomically, and guard `cleanupExpiredMultipliers` with a reentrancy lock. For panic mode, check `isPanicMode` BEFORE deleting (or re-insert the row when skipping) so expired-but-unremoved multipliers are retried after panic clears.

**`avatar_confirm18` modal route is dead infrastructure and has no handler (latent route-miss bug)** — `src/lib/modalPatterns.ts:75,98,149-152`
- Impact: `modalPatterns.ts` defines `MODAL_18_RE`, the `ModalRoute` member `{ type: 'avatar_confirm18' }`, and `identifyModalRoute` returns it (149-152). But (1) no code in `src/web/scripts` ever shows a modal with customId `v1:avatar:confirm18:` (the string appears only in `modalPatterns.ts` and `interactionCreate.ts`, never in a `ModalBuilder`/`showModal` call), so the route is unreachable; and (2) the router in `src/events/interactionCreate.ts` has no branch for `route.type === 'avatar_confirm18'`, so even if shown it would fall through to the catch-all at `interactionCreate.ts:984-1000` and post an "Unhandled modal" error card. The union member is both dead and a latent bug. (Pairs with the Low command/handler finding on the dead `v1:avatar:confirm18:` prefix clause.)
- Fix: Either remove `MODAL_18_RE`, the union member, its `identifyModalRoute` branch, and the `|| customId.startsWith("v1:avatar:confirm18:")` clause in `interactionCreate.ts:769`; or, if the 18+ confirmation is intended, wire the `showModal` producer AND add a matching `route.type === 'avatar_confirm18'` handler.

### Low

**`db.transaction` monkeypatch drops the `.deferred`/`.immediate`/`.exclusive` variants** — `src/db/db.ts:97-111`
- Impact: better-sqlite3's `transaction(fn)` returns a callable that also carries `.deferred`, `.immediate`, `.exclusive`, `.default` sub-functions for choosing BEGIN mode. The wrapper returns a new closure that only proxies the default call path; the variant properties are not copied. `db.transaction(fn).immediate(...)` would throw "undefined is not a function". No current `src` caller uses these variants, so it is latent — a silent capability regression future code could hit.
- Fix: After building `wrapped`, re-attach the variants: `for (const k of ['deferred','immediate','exclusive','default']) (wrapped as any)[k] = (originalReturn as any)[k];` — or wrap each variant with the same timing logic.

**`avatar_scan.final_pct` declared NOT NULL via ALTER in db.ts but nullable in the canonical CREATE/ALTER in ensure.ts** — `src/db/db.ts:246-248`
- Impact: `db.ts` adds `final_pct` as `INTEGER NOT NULL DEFAULT 0` at module load (line 248), while `ensure.ts` both creates (`:48`) and ALTERs (`:105`) it as nullable `INTEGER DEFAULT 0`. The table is normally created later by `ensureAvatarScanSchema()` during ClientReady (`startup/schema.ts:51`), and db.ts runs first at import, so the db.ts ALTER usually no-ops and the nullable definition wins — but on any DB where `avatar_scan` already exists at import time, `final_pct` becomes NOT NULL, diverging from the canonical schema and surprising writers that insert NULL/omit the column.
- Fix: Standardize the `final_pct` definition across both files (pick nullable `DEFAULT 0` or `NOT NULL DEFAULT 0` everywhere). Ideally remove the duplicate add in db.ts and let `ensure.ts` own `avatar_scan`.

**`avatar_scan.reason` column default differs between fresh-create and ALTER paths** — `src/db/ensure.ts:51,121`
- Impact: Fresh create declares `reason TEXT` with no default (line 51); the legacy ALTER adds `reason TEXT DEFAULT 'none'` (line 121). Fresh DBs default `reason` to NULL, migrated DBs to `'none'`. Code branching on `reason === 'none'` vs `reason == null` (avatarScan upsert logic, `scan.ts` which inserts `reason='none'` explicitly) can behave inconsistently across environments. Low impact since most writers set `reason` explicitly, but a latent data-integrity inconsistency.
- Fix: Make the two paths agree — either give the CREATE column `DEFAULT 'none'` (line 51) or drop the default on the ALTER (line 121) — and normalize existing NULLs if `'none'` is canonical.

**Module-level `db.prepare()` on `sync_marker` is unguarded; the "first startup before migration" case throws at import, not in the try/catch** — `src/lib/syncMarker.ts:25-51`
- Impact: `touchStmt`/`getStmt` are compiled at module load (25-37). better-sqlite3 validates table existence at `prepare()` time, so on a brand-new DB imported before migration 026 created `sync_marker`, `db.prepare('UPDATE sync_marker ...')` throws "no such table" during module evaluation. db.ts deliberately does not create `sync_marker` (287-288). The try/catch in `touchSyncMarker`/`getSyncMarker` only wraps `.run()/.get()`, so the comment "Silently ignore if table doesn't exist yet (first startup before migration)" is misleading — that exact scenario crashes the first importer (`src/lib/config.ts`, `src/features/logger.ts`). Masked in prod because migrations run as a separate pre-step.
- Fix: Lazily prepare the statements inside the functions (memoize on first call) so preparation happens under the try/catch, or wrap the module-level prepares in try/catch with a null-statement fallback. Alternatively guarantee migration 026 runs before any import and remove the misleading comment.

**Cleanup `setInterval` is never unref'd or cleared — keeps the event loop alive (hangs tests/shutdown)** — `src/lib/rateLimiter.ts:149`
- Impact: At module load, `setInterval(cleanupOldCooldowns, CLEANUP_INTERVAL_MS)` (10 min) is never `.unref()`'d, stored, or cleared, and is not env-guarded — the one outlier from an otherwise leak-safe pattern (notifyLimiter, traceStore, all `src/scheduler/*`, `cmdWrap.ts` armWatchdog all `.unref()`). A live ref'd interval keeps the Node process alive: (a) vitest workers may not exit cleanly (forces teardown timeout / `--forceExit` reliance — exercised via `tests/commands/listopen.test.ts` → `listopen.js` → rateLimiter); (b) in prod it blocks graceful shutdown if the explicit `process.exit(0)` path is ever bypassed. The module's own comment admits "This interval is never cleared ... If tests start hanging, this is why."
- Fix: Capture the handle, `.unref()` it (mirroring `cmdWrap.ts`), and export a `stopRateLimiterCleanup()` that `clearInterval`s for deterministic teardown; optionally wire it into the `gracefulShutdown` cleanup in `src/startup/ready.ts`.

**Disk-space initial-check `setTimeout` is neither captured, cleared on stop, nor unref'd** — `src/scheduler/diskSpaceScheduler.ts:236-244`
- Impact: `startDiskSpaceScheduler` schedules the first check with `setTimeout(async () => {...}, 15000)` but does not store the handle; only the periodic `setInterval` is saved to `_activeInterval` and unref'd. So (1) `stopDiskSpaceScheduler()` cannot cancel this timer — if shutdown happens within 15s, `checkDiskSpace` still fires (touching `client.guilds.cache`, sending an embed) during teardown; (2) unlike the interval it is not `.unref()`'d, so it can keep the loop alive for up to 15s and delay clean exit. Compare `badgeRefreshScheduler.ts`, which captures and unref's its startup timer.
- Fix: Capture the timeout in a module variable (`_startupTimeout`), call `.unref?.()`, and `clearTimeout` it in `stopDiskSpaceScheduler()` alongside `_activeInterval`.

**Stale-application initial-delay `setTimeout` is not tracked or cleared by the stop function** — `src/scheduler/staleApplicationCheck.ts:382-390`
- Impact: `startStaleApplicationScheduler` schedules a one-shot `setTimeout(..., 15000)` for the initial check but never stores the handle; `stopStaleApplicationScheduler` (line 419) only clears the periodic interval. Same pattern in `opsHealthScheduler.ts:117` (10s) and `diskSpaceScheduler.ts:236` (15s). On SIGTERM within the initial-delay window, `stopSchedulers()` runs but this timer survives, holding the Client reference and able to fire its async check (DB query + Discord API calls) after teardown begins closing the DB/destroying the client. Not `.unref()`'d either.
- Fix: Store the timeout in a module variable (`_initialTimer`), `.unref()` it, and `clearTimeout` it inside the stop function. Apply the same fix to `opsHealthScheduler.ts` and `diskSpaceScheduler.ts`.

**Disk usage computed from `bfree` (incl. root-reserved blocks) and no guard for `statfs` returning zeros** — `src/scheduler/diskSpaceScheduler.ts:49-64`
- Impact: `getDiskStats` computes `freeBytes` from `stats.bfree` (total free blocks) rather than `stats.bavail` (blocks available to a non-privileged process). On typical ext4 ~5% is root-reserved, so `usedPercent` is under-reported relative to what the bot can actually use, delaying the 80%/90% alerts. Separately, if `statfs` returns `blocks=0`, `usedPercent = Math.round((usedBytes/0)*100)` is NaN; `NaN >= CRITICAL` and `NaN >= WARNING` are both false, so the check silently records success and never alerts even on a full disk.
- Fix: Use `stats.bavail` for the figure that drives the threshold. Add a guard: if `totalBytes <= 0` or `!Number.isFinite(usedPercent)`, log a warning and skip rather than treating it as healthy.

**`getActionMeta(action)` result is dereferenced before the try/catch; an unmapped action throws after the audit row is written** — `src/logging/pretty.ts:537-554`
- Impact: After the `action_log` INSERT (guarded) and the `getLoggingChannel` await, `getActionMeta(action)` is called and `actionMeta.emoji/.title/.color` dereferenced (538-539) outside any try/catch (only the later `channel.send` is wrapped). The exhaustive `Record<ActionType,ActionMeta>` makes `meta[action]` safe for typed callers, but a caller passing an action via `as any` / a stale DB string gets `undefined` and throws a TypeError out of `logActionPretty`. Since the DB write already succeeded, this is a post-commit crash the caller must handle, and not all callers wrap `logActionPretty` in try/catch.
- Fix: Guard the lookup: `const actionMeta = getActionMeta(action); if (!actionMeta) { logActionJSON(...); return; }`, or move embed construction into the existing `send` try/catch so a bad action degrades to JSON logging instead of throwing.

**`getAcknowledgedIssues` returns the shared mutable cached `Map` reference** — `src/store/acknowledgedSecurityStore.ts:138-171`
- Impact: On a cache hit (140-143) and on a miss the same `result` Map is both stored in `ackCache` and returned. A caller mutating the returned Map (`set/delete/clear`) would silently corrupt the cached entry for up to `CACHE_TTL_MS` (5 min), affecting subsequent `/audit security` runs for that guild. Current callers only read via `.get()`, so latent rather than live, but a footgun for future callers and for `listAcknowledgedIssues` semantics.
- Fix: Return a defensive copy (`return new Map(cached)`), or document/freeze the contract that the returned Map is read-only.

**`generateReportData` can throw on missing table while sibling readers return safe defaults** — `src/store/auditFindingsStore.ts:252-299`
- Impact: `getFindingsByRun`/`getFindingsBySeverity`/`listAuditRuns` each wrap their query in try/catch returning `[]` (e.g. `audit_findings` absent pre-migration). `generateReportData` calls `getStatusCountsStmt.all()`, `getApiTotalsStmt.get()`, `getDocIssuesStmt.all()`, `getPermMismatchesStmt.all()` WITHOUT try/catch, so the same missing-table/locked-db condition throws out of it. Also `getApiTotalsStmt.get()` is cast `as {total_calls;total_cost}` and dereferenced (293-294) without a null guard; `.get()` returns undefined for an empty result, which would throw on property access. Limited impact since no `src` runtime path calls it (only scripts/tests), but an inconsistent contract that can crash an admin/script caller.
- Fix: Wrap the four statement calls in try/catch returning the same zeroed `ReportData` defaults, and null-guard the apiTotals result (`apiTotals?.total_calls ?? 0`).

**`getServiceToggles` uses `row.service in toggles`, which also matches `Object.prototype` keys** — `src/store/aiDetectionToggles.ts:52-54`
- Impact: The loop does `if (row.service in toggles) { toggles[row.service as ...] = ... }`. `in` walks the prototype chain, so a stored service value of `'constructor'`, `'toString'`, `'__proto__'`, etc. passes the guard and assigns onto `toggles`, polluting the returned record (and via `getEnabledServices`, the enabled list). The `ai_detection_toggles` table (migration 037) has no CHECK on `service`; the only sanctioned writer is typed, so this requires a corrupt/hand-edited row — hence low, but a real input-validation gap.
- Fix: Use an own-property/allowlist check: `if (Object.prototype.hasOwnProperty.call(toggles, row.service))` or `if (ALL_SERVICES.includes(row.service as AIDetectionService))`.

**`isServiceEnabled` treats any DB error as "enabled", risking unintended paid-API spend** — `src/store/aiDetectionToggles.ts:17-30`
- Impact: `isServiceEnabled` wraps the query in `try { ... } catch { return true; }`. The intent is the pre-migration "table missing" case, but the bare catch also swallows transient errors ("database is locked", a column rename/typo, a stale prepared-statement handle). In those cases a service an admin explicitly DISABLED is reported as ENABLED, so the pipeline calls that external API (Hive/RapidAI/Sightengine/Optic) and incurs cost the admin tried to avoid. Fail-open on a cost/safety toggle is the wrong default for anything but the known "no such table" error.
- Fix: Narrow the catch: only default to `true` for a missing-table error (message includes "no such table"); for other errors log and fail closed (default disabled) or rethrow.

**Unsound cast of raw row to `AuditSession` (audit_type/status unions not enforced by schema)** — `src/store/auditSessionStore.ts:142`
- Impact: `getActiveSession` casts the row directly to `AuditSession`, whose `audit_type` is `'members'|'nsfw'` and `status` is `'in_progress'|'completed'|'cancelled'`. The `audit_sessions` table (migration 033) declares both as plain TEXT with no CHECK, so the compile-time union is not guaranteed at runtime; an out-of-band write produces a value TypeScript believes impossible, and downstream exhaustiveness logic on `audit_type` could mis-handle it. The only writer (`createSession`) is typed, so impact is low.
- Fix: Add `CHECK(audit_type IN ('members','nsfw'))` / `CHECK(status IN (...))` to the table, or validate the row's fields against the allowed sets before returning instead of a blind `as` cast.

**`notifyLimiter` `canNotify()`→send→`recordNotify()` is non-atomic; concurrent forum posts can exceed the hourly cap** — `src/lib/notifyLimiter.ts:73-105, 113-135`
- Impact: A read-then-act pair: callers invoke `canNotify()` (73), perform an awaited Discord send, then call `recordNotify()` (113). Because the record happens only AFTER the async send, multiple forum-post events in the same window all observe the pre-increment count and all pass, then each records — the effective rate can exceed `notify_max_per_hour`/ignore the cooldown under burst. Single-process, but Node interleaves at each await, a genuine TOCTOU for the abuse-prevention control (mass thread-creation spam). The file documents the trust-the-caller ordering.
- Fix: Make reserve-and-record atomic: have `canNotify()` record the timestamp (reserve a slot) when it returns ok, with a release/rollback if the send fails, rather than recording only after the await. Doing the check+push synchronously in one function with no `await` between closes the window.

**`streamReviewActionsCSV` does not end/destroy the stream on the error path** — `src/lib/csv.ts:252-271`
- Impact: The happy path calls `stream.end()` (253). The catch block (268-271) logs and re-throws without `stream.end()` or `stream.destroy(err)`. The sole current caller (`features/analytics/command.ts`) wraps the call and lets the PassThrough go out of scope, so today it only fails to propagate `error`/`close` rather than leaking. But it is an exported general utility (Writable param); a future caller piping it to a persistent sink (file handle, HTTP response) is left with a stream that never ends or errors — a half-open resource leak.
- Fix: In the catch block call `stream.destroy(err instanceof Error ? err : new Error(String(err)))` (or `stream.end()`) before/instead of re-throwing, so the writable is always terminated exactly once.

**`armWatchdog` only auto-defers modals; slow button/select/context-menu handlers can hit 10062 with no safety net** — `src/lib/cmdWrap.ts:155-194`
- Impact: `armWatchdog`'s timer returns immediately unless `interaction.isModalSubmit()` (156-159), so it only rescues modals near the 3s deadline. Buttons, string-selects, and context-menu commands get no auto-defer. Meanwhile `interactionCreate.ts:217-218` documents the watchdog as generic and as something that "doesn't actually cancel anything - just yells" — doubly wrong: it does act (deferReply) and only for modals. Any component/context-menu handler doing >3s of work before its own defer (e.g. `handleModmailContextMenu` before `deferReply` at `modmail/handlers.ts:190`; redeemreward/byteToken confirm role fetches) will 10062 unrescued.
- Fix: Either extend `armWatchdog` to also auto-`deferUpdate` component interactions (and `deferReply` context-menu commands) near the deadline, or correct the `interactionCreate.ts` comment to state the watchdog only covers modals.

**Wide-event Response State is inaccurate for handlers that defer/reply directly instead of via cmdWrap helpers** — `src/lib/cmdWrap.ts:456-457,515-516`
- Impact: `markDeferred()` is emitted only inside `ensureDeferred()` and `markReplied()` only inside `replyOrEdit()`. Most component/modal handlers call `interaction.deferUpdate()/deferReply()/update()/reply()/editReply()` directly (byteTokenHandler, artistRotation/handlers, modmail/handlers, qotd/handlers, tickets/handlers, dmVerification). For those flows the wide event's `responseState.deferredAt/repliedAt` stay null, so the error card's Response State (`errorCardV2.ts:288-325`) reports "Deferred: No (direct reply or error before defer)" and "Replied: No" even though the user got a response — degrading the exact debugging signal the wide-event system exists for.
- Fix: Funnel direct defer/reply calls through the cmdWrap helpers, or add lightweight `enrichEvent(e=>e.markDeferred()/markReplied())` calls in the shared handler entry points so response-state telemetry reflects reality.

**Full deploy ships and extracts `src/` and `scripts/` over the live tree, widening blast radius** — `deploy.sh:408,416`
- Impact: The full-deploy tarball includes `dist src migrations scripts assets ...` (408) and is extracted in place (416, `tar -xzf`). The bot runs from `dist/` (`ecosystem.config.cjs:5`). Shipping `src/` and overwriting `scripts/` every deploy means a partially-built/stale src tree, or a tarball created mid-edit, can replace the server's `scripts/` (including `migrate-remote.js`/`migrate.ts`) right before step 6.5 runs them. `tar` extraction is not atomic, so an interrupted upload/extract can leave a mixed old/new `scripts` tree the migration step then executes.
- Fix: Ship only what the runtime needs (`dist`, `migrations`, the scripts required for migrate, package manifests, `.env.build`, ecosystem config, `web/build`). Drop `src/` from the production tarball. Consider extracting into a fresh release dir and atomically symlinking rather than extracting over the live tree.

**`streamReviewActionsCSV` export is dead (only consumer is dead `command.ts`)** — `src/lib/csv.ts:144-260`
- Impact: `csv.ts` exports `generateModHistoryCsv` (used by the live `src/commands/stats/history.ts`) and `streamReviewActionsCSV`, the latter imported only by the dead `src/features/analytics/command.ts:37` and `tests/lib/csv.test.ts`. Once `command.ts` is removed it becomes a dead export inside an otherwise-live file. Side note: the comment at `csv.ts:43-49` claims RFC4180 quoting "prevents CSV injection attacks where =,+,-,@ could trigger formula execution" — false (Excel still evaluates `=cmd` in a quoted field); harmless only because this exporter is dead.
- Fix: Remove `streamReviewActionsCSV` (and `CSVExportOptions` if then unused) when deleting `command.ts`, keeping `generateModHistoryCsv`. Do not propagate the misleading CSV-injection comment into the live function.

**`fireAndForget` helper is never used anywhere** — `src/lib/fireAndForget.ts:1-19`
- Impact: Added to "replace the `.catch(() => {})` anti-pattern throughout the codebase", but a repo-wide search of `src/`, `scripts/`, `web/`, `workers/`, `tests/` finds zero importers — only the definition. The codebase still uses inline `.catch(() => undefined)`/`.catch(err => logger.warn(...))` (e.g. in `interactionCreate.ts`, `movie.ts`). Dead utility module.
- Fix: Either delete `src/lib/fireAndForget.ts`, or actually adopt it by replacing the scattered fire-and-forget `.catch` patterns. Prefer deletion unless adoption is planned.

**`commandSync.ts` is an empty module husk with no exports** — `src/lib/commandSync.ts:1-15`
- Impact: After `syncGuildCommandsInProcess()` and helpers were removed (v4.4.5), the file was retained "for potential future command sync utilities" but now contains only comments — no code, no exports. Nothing imports it. A zero-value placeholder that shows up as a source module and in import-graph tooling.
- Fix: Delete `src/lib/commandSync.ts`; re-create later if real command-sync helpers are needed.

**`BTN_AUDIT_MEMBERS_RE` and `BTN_AUDIT_NSFW_RE` exports are used only by tests** — `src/lib/modalPatterns.ts:61-62`
- Impact: The audit button router (`interactionCreate.ts:434`) matches the combined `BTN_AUDIT_RE` only. The granular `BTN_AUDIT_MEMBERS_RE`/`BTN_AUDIT_NSFW_RE` are not referenced anywhere in `src/` — only `tests/lib/modalPatterns.test.ts` imports them. Effectively unused production exports (the audit handler parses the subtype another way).
- Fix: Confirm `src/commands/audit/buttonRouter.ts` does its own sub-parse (it does), then either delete the two granular patterns or actually use them in the audit button handler. If kept for documentation, downgrade to non-exported or add a real consumer.

**Some `auditFindingsStore` exports (`getFindingsByRun`, `getFindingsBySeverity`, `listAuditRuns`) appear unused outside the module/tests** — `src/store/auditFindingsStore.ts:228-247,304-331`
- Impact: The module is not fully dead — `insertFinding`, `generateReportData`, `generateMarkdownReport` are used by `scripts/record-audit-findings.ts`. But `getFindingsByRun`/`getFindingsBySeverity` are only called internally by `generateReportData`, and `listAuditRuns` has no production consumer (the web audit-findings dashboard uses its own queries). Minor dead exports. The module-load prepared statements assume `audit_findings` (migration 043) exists — fine while a real importer exists, worth tracking if the only importer is a dev-only script.
- Fix: Make `getFindingsByRun`/`getFindingsBySeverity` module-private; remove `listAuditRuns` if no consumer is found. Verify the web dashboard pages do not import this store before pruning.

---

## Coverage gaps

- **Severity-count reconciliation.** The provided tally (3 critical / 24 high / 79 medium / 193 low) does not fully match the per-area section text supplied for assembly: the sections contain **3 critical and 20 high** confirmed findings (not 24 high). The "raw confirmed high/critical count: 32" matches neither 27 (3+24) nor 23 (3+20). The discrepancy is most likely pre-merge duplicates (e.g. the modmail UTC-as-local bug consolidates ~10 reports, `replyOrEdit`/review-card clobbering spans one High plus several Medium/Low call sites) being counted in the raw 32 but collapsed in the sections. The headline tally above uses the numbers handed to me; a final pass should reconcile the high count and confirm whether 4 high findings were merged-down or dropped.
- **Cross-area shared root causes are double-listed by design.** `replyOrEdit` (`cmdWrap.ts`) and the modal `avatar_confirm18` dead route appear in both the core/lib section and the features/commands sections. These are intentionally cross-referenced, not separate defects; de-duplicate before turning findings into tickets so the same fix is not scheduled twice.
- **Bot features count semantics.** The features section header states "29 confirmed findings" but enumerates roughly 1 critical + 11 high + 19 medium + ~37 low individual items once Low entries are included; "29" appears to count merged top-level findings, not call sites. The discrepancy is presentational, but a reviewer mapping findings to work items should expect more than 29 actionable line-level fixes.
- **Severity boundary on one item.** "Crash recovery loads game-night sessions into the movie session map" (`movieNight.ts:588-623`) is annotated as medium-severity data-integrity but is listed under the features Low section adjacent to related movie findings. Treat it at Medium when prioritizing.
- **Areas not represented as separate sections.** No dedicated sections were provided for `workers/`, shared `web/.../shared/*` validation modules, CI/GitHub Actions config, or runtime dependency/supply-chain review; these were only touched incidentally (e.g. `shared/configValidation.ts`, `ecosystem.config.cjs`). If they were in scope, they were not audited here.
- **Verification method not re-run.** This report assembles and reconciles the supplied, adversarially-verified findings; I did not independently re-execute the code or re-confirm line numbers against the working tree. Line references reflect the inputs as given.