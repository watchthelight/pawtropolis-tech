# scripts/

What each script is for and where it runs. One-off scripts that finished their job were deleted in September 2026 (#00271); anything listed here is either run regularly, needed for recovery, or a reusable tool. `npm run knip` reports scripts and exports nothing references.

## Operations (run on the host or from a developer machine against it)

| Script | Purpose |
|---|---|
| `deploy.sh` | Thin wrapper around the root `deploy.sh` (lock, backup, tests, tarball, migrations, pm2 restart, health check). |
| `start.sh`, `start.cmd`, `switch.sh` | Local start/stop with a database sync from the host; `switch.sh` flips the bot between local and remote. |
| `migrate.ts` (`npm run migrate`, `migrate:dry`) | Migration runner: online backup before pending migrations, `MIGRATION_BACKUP_RETENTION` copies kept. |
| `migrate-remote.js` | Plain-Node migration runner used by the deploy on the host. |
| `commands.ts` (`npm run deploy:cmds` on the host, `sync:cmds` locally) | Registers slash commands with Discord from the built spec. |
| `deploy-commands.ts`, `print-commands.ts` (`npm run print:cmds`), `print-command-count.ts` | Command registration helpers and listings. |
| `smoke-test.sh` | Post-deploy smoke checks against the running processes. |
| `cleanup-backups.sh` | Keeps the 3 newest `data/backups/data.db.*` groups plus anything under 7 days. The bot's retention scheduler does the same daily when `RETENTION_ENABLED=true`. |
| `litestream.example.yml`, `litestream.service.example`, `litestream-restore.sh` | Litestream replication config, its systemd unit, and the restore drill. |
| `setup-server.sh` | One-time fresh-host setup (packages, pm2, directories). Kept for disaster recovery. |
| `verify-db-integrity.js` | Off-line integrity check of a database file. |
| `inject-build-info.ts` | Writes `.env.build` (git sha, timestamp, deploy id) during the build. |
| `scan-legacy.ts` (`npm run scan:legacy`) | Build gate that fails on `__old*` tokens. |
| `auth-check.ts` (`npm run auth:whoami`) | Confirms the bot token and application id. |
| `init-test-db.ts`, `gen-test-schema.ts` (`npm run gen:test-schema`) | Regenerate `tests/fixtures/schema.sql` from a real database. |
| `gen-schema-doc.mjs` (`npm run docs:schema`) | Regenerates `docs/reference/database-schema.md` from the fixture schema. |
| `refresh-public-stats.ts` (`npm run stats:refresh`) | Rebuilds the public stats snapshot. |
| `register-role-metadata.ts` (`npm run linked-roles:register`) | Registers Discord linked-role metadata. |
| `perf-baseline.py` | Aggregates `slow_transaction`, timeouts and durations from the pm2 logs into a baseline table (used for #00275). |
| `backfill/run.ts` | Manual, resumable archive of every message into `messages_archive`. The pm2 app for it was removed after the run completed (#00276); run it by hand when needed. |
| `ops/sync-labels.sh`, `ops/sync-tasks.py` | Todo-to-GitHub-Issues mirror used by the `/sync-tasks` skill. |
| `MONITORING.md` | Monitoring runbook (Better Stack heartbeats, health endpoints). |

## Badges

| Script | Purpose |
|---|---|
| `generate-badges.ts` | Renders the SVG role and contributor badges under `docs/badges/`. |
| `generate-badge-metrics.js` | Metrics JSON for the Shields.io dynamic badges. |
| `fetch-role-data.ts` | Pulls role names and colours used by the badge renderer. |

## Diagnostics (read-only helpers)

| Script | Purpose |
|---|---|
| `check-bot-permissions.ts`, `check-channel-access.ts`, `fetch-channel.ts`, `fetch-roles.ts`, `lookup-users.ts`, `who-has-role.mjs` | Ask Discord about permissions, channels, roles and users. |
| `sqlpeek.cjs`, `table-sizes.mjs` | Inspect a SQLite file: DDL, indexes, per-table sizes. |
| `diagnostic-activity.ts` | Checks the activity heatmap data collection. |
| `audit-server-full.ts`, `record-audit-findings.ts`, `batch-acknowledge-security.ts` | Security audit runner and its findings bookkeeping. |

## Local research: chat-quality pipeline (LOCAL ONLY)

These read and write the `general_messages_*` tables (`raw`, `ctx`, `embed`, `score`, `overlay_weekly`, `gold`). Production only carries the empty tables that migration 069 creates; the data lives in a local copy of the database, so none of this runs on the host.

| Script | Purpose |
|---|---|
| `backfill-general.mjs` | Pages the #general history into `general_messages_raw`. |
| `build-context.mjs`, `build-context-incremental.mjs` | Materialise the 3-message context rows. |
| `local-pipeline.mjs` | Runs context, scoring and overlay steps until drained. |
| `score-quality.mjs`, `score-effort-v1.mjs`, `score-resonance.mjs`, `score-substantiveness.mjs` | Per-message scores. |
| `train-effort.mjs`, `train-effort-v1.mjs`, `sample-gold.mjs`, `llm-label.mjs`, `novelty-sanity.mjs`, `plot-effort.mjs` | Model spikes, gold-set sampling and labelling, sanity checks. |
| `metrics-overlay.mjs`, `build-overlay-weekly.mjs`, `generate-charts.mjs`, `chart-quality.mjs`, `chart-quality-v2.mjs`, `charts/` | Weekly metric overlay and PNG charts. |
| `export-embed.mjs`, `export-overlay.mjs`, `export-processed.mjs`, `export-score.mjs`, `export-substantiveness.mjs`, `quality-snapshot.mjs`, `quality-snapshot-stage1.mjs`, `merge-processed.sh`, `quality-sync.sql`, `quality-cron.txt` | Move processed tables between machines; the cron file documents the old EC2 worker schedule. |
| `build-filler-bank.mjs`, `filler-bank.json`, `lowlist.json`, `resolve-authors.mjs`, `recon-category.mjs`, `recon-ticket-tool.mjs` | Supporting data and one-time reconnaissance for the pipeline. |
| `report/` (`npm run report:excel`) | Excel workbook builder over the processed tables. |

## Maintenance tools (re-runnable)

| Script | Purpose |
|---|---|
| `backfill-app-mappings.ts` (`npm run backfill:app-mappings`) | Fills application to user mappings after imports. |
| `backfill-message-activity.ts` | Rebuilds `message_activity` from history for a window. |
| `migrate-logging-channel.ts` (`npm run migrate:logging`) | Moves the logging channel setting. |
| `cleanup-last-poke.ts` | Deletes the most recent bot poke message in each category channel after a bad poke. |
| `cleanup-test-data.ts` | Removes rows created by manual testing. |
| `retro-rename-art-tickets.ts` | Renames legacy art ticket threads to the current scheme. |
| `pawtech` | Shell helper for common host commands. |
