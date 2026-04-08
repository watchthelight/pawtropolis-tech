# Pawtropolis Tech: Monitoring Runbook

Operational reference for the external observability stack added during the
disaster-prevention work (Phase 1 of `~/.claude/plans/logical-squishing-dragon.md`).
Lives alongside the litestream config and restore drill in `scripts/`.

Account credentials and tokens for everything below live in `CREDENTIALS.md`
(gitignored — never commit).

---

## Better Stack Uptime

- **Console**: <https://uptime.betterstack.com/>
- **API base**: `https://uptime.betterstack.com/api/v2/`
- **Free tier**: 10 monitors / 10 heartbeats / status page / 3-min checks

### Monitors

| ID | Name | URL | Interval |
|---|---|---|---|
| `4259403` | Pawtropolis Dashboard | `https://pawtropolis.tech/` | 180 s |

Phase 1.6 added a `web/src/routes/api/health/+server.ts` endpoint at
`https://pawtropolis.tech/api/health` that returns 200 if the dashboard can
read the SQLite DB, 503 otherwise. Add this as a second Better Stack monitor
once the next deploy is out — gives finer-grained "DB unreachable" detection
than just hitting the root URL.

### Status page

| Field | Value |
|---|---|
| Status page ID | `243119` |
| Default URL | <https://pawtropolis.betteruptime.com> |
| Custom URL | <https://status.pawtropolis.tech> |
| Cloudflare CNAME | `status.pawtropolis.tech → pawtropolis.betteruptime.com` (DNS-only, not proxied) |
| Resource attached | `8801536` (Pawtropolis Dashboard) |

### Discord alerts

Configured in the Better Stack dashboard via **Integrations → Discord** (no
API endpoint exists for this — must be set up via OAuth click flow). Alerts
post to the ops channel; the webhook URL is in `CREDENTIALS.md`.

---

## Healthchecks.io

- **Console**: <https://healthchecks.io/>
- **Project**: `pawtropolis-tech`
- **API base**: `https://healthchecks.io/api/v3/`
- **Free tier**: 20 checks (using 8)

### Checks (one per scheduler)

All 8 checks have `channels="*"` set so any future notification channel
auto-applies. The Discord channel `3fabf739-3bfa-4868-8f7c-8f289c52df55` is
already attached.

| Slug | Timeout | Grace | Source file |
|---|---|---|---|
| `mod_metrics` | 900 s | 300 s | `src/scheduler/modMetricsScheduler.ts` |
| `guild_snapshot` | 300 s | 120 s | `src/scheduler/guildSnapshotScheduler.ts` |
| `ops_health` | 60 s | 120 s | `src/scheduler/opsHealthScheduler.ts` |
| `stale_application_check` | 3600 s | 600 s | `src/scheduler/staleApplicationCheck.ts` |
| `security_audit` | 3600 s | 600 s | `src/scheduler/securityAuditScheduler.ts` |
| `byte_multiplier` | 3600 s | 600 s | `src/scheduler/byteMultiplierScheduler.ts` |
| `disk_space` | 3600 s | 600 s | `src/scheduler/diskSpaceScheduler.ts` |
| `event_timeout` | 300 s | 120 s | `src/scheduler/eventTimeoutScheduler.ts` |

Ping URLs are documented in `CREDENTIALS.md` as a copy-paste-ready `.env` block
under `HC_*_URL`. Phase 2.2 / 2.3 / 2.4 will wire these env vars into the
schedulers and add a `pingHealthcheck()` helper.

### Status badge in README

The Healthchecks project-wide badge is embedded in `README.md` and links to
the Better Stack status page:

```
https://healthchecks.io/badge/792dd9df-1b80-4555-9efd-7e5f3cb5b88a/oUZDhyJL.svg
```

---

## Sentry

- **Console**: <https://watchthelight.sentry.io/>
- **Org**: `watchthelight`
- **Project (dashboard)**: `pawtropolis-web` (`4511183400861696`)
- **Project (bot)**: separate, currently in a different org — not yet migrated
- **Free tier**: 5k errors / 50 replays / 10k spans per month
- **Server hooks**: `web/src/hooks.server.ts` (Phase 1.4)
- **Client hooks**: `web/src/hooks.client.ts` (Phase 1.5, replay-on-error only)

---

## Axiom

- **Console**: <https://app.axiom.co/>
- **Dataset**: `pawtropolis` (single dataset for both bot + dashboard logs)
- **Free tier**: 500 GB ingest / 30-day retention
- **Pino transport**: `@axiomhq/pino` (will be wired in Phase 2.5)

---

## Incident response

When an alert fires in the ops Discord channel:

1. **Triage**: Check the Better Stack status page (<https://status.pawtropolis.tech>)
   to see which monitor is down.
2. **Stack trace**: Open Sentry (<https://watchthelight.sentry.io/>) and look
   for new issues in the `pawtropolis-web` project.
3. **SSH in**: `ssh bash-ec2`
4. **Process state**: `pm2 status` then `pm2 logs pawtropolis --lines 100`
   (or `pawtropolis-web` if the dashboard is the suspect).
5. **Disk pressure**: `df -h /home/ubuntu` — gp3 30 GB, common cause of
   schedulers stalling.
6. **DB integrity**: `node scripts/verify-db-integrity.js data/data.db`.
7. **Scheduler health**: Check Healthchecks.io to see which scheduler stopped
   pinging — the `ops_health` and `disk_space` checks are the canaries.
8. **Recover**: `pm2 restart pawtropolis pawtropolis-web` if needed.
9. **Post-fix**: Confirm Better Stack auto-resolves the incident; the status
   page should flip back to operational within 1–2 check intervals.

### DB lost or corrupt

Use the Litestream restore drill (`scripts/litestream-restore.sh`) — it pulls
the latest snapshot from Cloudflare R2 to a temporary path, runs integrity
checks, and reports recoverability **without touching the live DB**.

If the live DB is gone:

```bash
pm2 stop pawtropolis pawtropolis-web
litestream restore -config /etc/litestream.yml -o /home/ubuntu/pawtropolis-tech/data/data.db /home/ubuntu/pawtropolis-tech/data/data.db
node scripts/verify-db-integrity.js data/data.db
pm2 start pawtropolis pawtropolis-web
```

The `pm2 stop` is critical — never restore on top of a DB that another
process has open.
