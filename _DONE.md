# Pawtropolis: Done

One-line dated ledger. Detail in [`done/`](./done/). Pair of [`_BACKLOG.md`](./_BACKLOG.md).

Reverse chronological by completion date.

## 2026-05-19

- [x] [Discord webhook for cron failures](done/00027.md) `Medium` Failure step added to both badge workflows; gracefully no-ops if webhook secret unset.
- [x] [Deploy lock moved out of /tmp](done/00028.md) `Medium` Lock now lives in /home/ubuntu (user-owned), not /tmp (world-writable).
- [x] [PM2 kill_timeout raised for graceful shutdown](done/00029.md) `Medium` Bot 5s -> 15s, web default -> 10s. Lets in-flight work drain.
- [x] [Default BACKUP_BEFORE_DEPLOY=1](done/00031.md) `Medium` Production deploys now auto-backup DB; override with =0.
- [x] [Resolve TODO in activityTracker (JSON fallback)](done/00036.md) `Low` Replaced with Pino-covers-it note; feature redundant.
- [x] [Resolve TODO in art.ts (circular dep workaround)](done/00035.md) `Low` Replaced vague TODO with deliberate-choice comment.
- [x] [Add SSH host validation to deploy.sh](done/00039.md) `Low` Checks ~/.ssh/config + known_hosts before deploy; fails fast with clear error if alias missing.
- [x] [Sync .env.example with runtime variables](done/00041.md) `Low` Added 15 missing vars across NSFW/GitHub/SSH/Anthropic sections. Diff now empty.
- [x] [Upgrade typescript-eslint to ^8.59.4](done/00034.md) `Low` 13 patches integrated cleanly. Typecheck green.
- [x] [Clean stale .env backups](done/00042.md) `Low` Deleted 3 local files (.env.build, .env.migration-backup, .env.pre-new-bot.bak). Already gitignored via `.env.*` pattern.
- [x] [Remove 5 unused exports](done/00026.md) `Low` No-op close: 4 of 5 already absent from source (stale audit), 5th (OAUTH_RATE_LIMIT_MAX_REQUESTS) actually in use.
- [x] [Fix empty block in build-overlay-weekly.mjs](done/00037.md) `Low` Annotated intentional empty catch with inline comment.
- [x] [Move @anthropic-ai/sdk to devDeps](done/00038.md) `Low` Used by scripts/llm-label.mjs (offline tool). Moved out of prod install footprint instead of removing.
- [x] [Upgrade Sentry packages (26 patches behind)](done/00005.md) `High` Bumped @sentry/node + @sentry/profiling-node ^10.20.0 -> ^10.53.1. No API changes, typecheck clean.
- [x] [Patch HIGH and CRITICAL npm vulnerabilities](done/00002.md) `Critical` Root + web/ npm audit clean of HIGH/CRITICAL in production. Five commits: removed @xenova, upgraded fastify, upgraded discord.js, added root overrides for protobufjs+fast-uri+jws+minimatch+ws, upgraded web vite/sveltekit/svelte.
- [x] [Remove or isolate @xenova/transformers](done/00003.md) `Critical` Confirmed unused via grep + Vision-only inference path. Removed cleanly. 32 transitive packages dropped.
- [x] [Upgrade Vite in web/ to patch dev-server path traversal](done/00004.md) `High` Bundled into #00002 step 5; web build verified clean.
- [x] [Smoke test the new issue system](done/00001.md) Round trip verified end to end: file created, GH issue 1 mirrored with correct labels (TODO/chore/Nominal/IP), file moved to done/, sync closed the issue.
