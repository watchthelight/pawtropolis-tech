# Retro: stats-observatory

Date: 2026-05-28

## What was built
- A public, zero-JavaScript stats page at `/observatory` with a fixed, self-contained "Observatory" night-sky theme (hardcoded tokens, no `var(--hue)` inheritance, no webfonts) that looks like nothing else on the site.
- A precompute data layer: migration 078 (ten rollup tables), an idempotent `refreshPublicStats` module, a `npm run stats:refresh` CLI, and a rollup-only read module. The page never touches a raw table at request time.
- Fourteen server-rendered SVG / pure-CSS charts (hero area, diverging bars, cohort heat table, the 7x24 activity heatmap centerpiece, donut, anonymized moderator leaderboard, and more), built in parallel by a workflow.

## What worked
- Phase 0 discovery as a workflow paid for itself: the agents verified the schema against the live migrations and caught traps that would have shipped wrong numbers (resonance tables are dead offline-ML output, `active_byte_multipliers` is a snapshot not a log, `action_log` is the canonical decision source so unioning `review_action` would double-count).
- `export const csr = false` plus stripping the one inline site script via `transformPageChunk` got the page to literally zero `<script>` tags: 3 network requests total (1 HTML + 2 CSS), LCP ~116ms, CLS 0.00, proven in a Chrome DevTools trace.
- The adversarial skeptic workflow earned its keep: it (and a screenshot) caught a donut rendering as a solid disk (`non-scaling-stroke` inflating the ring), `role="img"` on a `<ul>`, non-deterministic `Math.random()` gradient ids, four WCAG-failing text tokens, and a genuinely misleading KPI label. None of those were visible from the code alone.
- Keeping the refresh logic as a pure `(db, guildId, nowS)` function made the aggregation correctness testable (11 cases) without booting the bot.

## What slowed me down
- Local preview was a yak-shave: the `better-sqlite3` native binding under `web/node_modules` would not `dlopen` on this Node (ABI mismatch), so the page silently rendered its empty state until I copied the working binary from the root install. A swallowed `catch` hid the real error at first; adding a `console.error` was the fix and is worth keeping.
- The shell env-prefix did not reliably propagate `DB_PATH`/`GUILD_ID` to the backgrounded server even though `PORT` took; an in-process launcher removed the ambiguity. Worth remembering for any future local server bring-up.
- Components written by the workflow via a Node script land outside the harness's file tracking, so editing them needed a Read first; two of them also shipped without a closing `</style>`. Agent-authored files need a compile/check gate before they are trusted.

## Next risk
- Production data depends on migration 078 being applied, which is gated on the prod migration runner blocker (#00046). Until then the page degrades to its empty state. This is the single thing standing between "built" and "live".
- The rollups are only as fresh as the last `stats:refresh`. The cron is documented but not installed; without it the numbers go stale silently.
- WAU is computed with ~95 per-day `COUNT(DISTINCT)` queries per refresh. Fine at current volume, but worth watching if `message_activity` grows or the window widens.

## Related todos
- [00049](https://github.com/watchthelight/pawtropolis-tech/issues/49) Stats Observatory epic
- [00050](https://github.com/watchthelight/pawtropolis-tech/issues/50) Phase 0 discovery and metric selection
- [00051](https://github.com/watchthelight/pawtropolis-tech/issues/51) Phase 1 isolated theme design
- [00052](https://github.com/watchthelight/pawtropolis-tech/issues/52) Phase 2 rollup migration, refresh, query module
- [00053](https://github.com/watchthelight/pawtropolis-tech/issues/53) Phase 3 page build
- [00054](https://github.com/watchthelight/pawtropolis-tech/issues/54) Phase 4 performance verification
- [00055](https://github.com/watchthelight/pawtropolis-tech/issues/55) Phase 5 code review, docs, ship

## Commits in scope
- dc7b32c chore(backlog): file epic and phase todos
- 4efe01f docs(stats): Phase 0 design brief
- 5e983ea / aa4c1b6 / bcc3ae5 / ca546a0 feat+test(stats): migration 078, refresh module, query module, coverage
- f75964d / 3c979ea / 8021ab9 feat(observatory): theme + route, chart components, page assembly
- 1b955b6 / c58c7e4 / bfead1d fix(observatory): a11y + deterministic ids + donut, AA contrast, true zero-JS
- bc5bde6 docs(ops): one-click update path
- 43be836 / 97c0ceb chore(done): close epic and phases, regenerate backlog
