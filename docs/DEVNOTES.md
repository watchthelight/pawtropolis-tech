# Developer Notes

## AI Detection Engines — Status (2026-03-18)

The `/isitreal` command and dashboard Scan AI button use 4 parallel AI-generated image detection APIs. Results are averaged across responding services.

| Engine | Status | Notes |
|--------|--------|-------|
| **Hive Moderation** | **Down** — 403 Invalid Auth Token | Key expired or revoked. Regenerate at https://thehive.ai/dashboard |
| **SightEngine** | **Working** | Returns `type.ai_generated` score 0-1. Credentials: `SIGHTENGINE_API_USER` + `SIGHTENGINE_API_SECRET` |
| **Optic (AI or Not)** | **Out of credits** | Free tier exhausted (10/10 images used). Top up at https://aiornot.com/dashboard |
| **RapidAPI AI Art** | **Not configured** | Key commented out in `.env`. Sign up at https://rapidapi.com/ai-image-detection/api/ai-generated-image-detection-api |

### Env Vars

```
HIVE_API_KEY=           # https://thehive.ai/pricing
SIGHTENGINE_API_USER=   # https://sightengine.com/pricing
SIGHTENGINE_API_SECRET= # (same account)
OPTIC_API_KEY=          # https://aiornot.com/api
RAPIDAPI_KEY=           # https://rapidapi.com/ai-image-detection/api/ai-generated-image-detection-api
```

Keys can be set via `/config isitreal` in Discord (no restart needed) or by editing `.env` on the server (restart required).

### How It Works

- Each image is sent to all enabled engines in parallel (`Promise.allSettled`)
- Failed/unconfigured engines are excluded from the average (not counted as 0)
- 15-second timeout per API call
- Engine names are obfuscated in Discord output ("Engine 1-4") to prevent gaming
- Per-guild toggles stored in `ai_detection_toggles` table

### Pricing

| Engine | Free Tier | Paid |
|--------|-----------|------|
| Hive | Unknown (was working, now 403) | https://thehive.ai/pricing |
| SightEngine | 500 ops/month | $9/mo for 2,000 ops |
| Optic | 10 images | Pay-as-you-go |
| RapidAPI | Varies by plan | ~$0.001/image |

### Code Paths

- Orchestrator: `src/features/aiDetection/index.ts`
- Individual services: `src/features/aiDetection/{hive,rapidai,sightengine,optic}.ts`
- Types: `src/features/aiDetection/types.ts`
- Health checks: `src/features/aiDetection/health.ts`
- Config command: `src/commands/config/isitreal.ts`
- Slash/context menu: `src/commands/isitreal.ts`
- Dashboard scan API: `src/web/dashboardApi.ts` (routes `/api/scan/:appId/ai` and `/api/scan/:appId/nsfw`)
- Dashboard scan proxy: `web/src/routes/api/scan/[appId]/[scanType]/+server.ts`
- Scan panel UI: `web/src/lib/components/review/ScanPanel.svelte`

---

## Google Cloud Vision — NSFW Detection

Used for avatar and banner NSFW scanning on the dashboard and automated avatar monitoring.

### Env Vars

```
GOOGLE_VISION_API_KEY=  # https://console.cloud.google.com/apis/credentials
```

### Pricing

- SafeSearch Detection is **free** when bundled with Label Detection (which we request but discard)
- First 1,000 requests/month free, then $1.50 per 1,000

### Thresholds

| Classification | Condition |
|---------------|-----------|
| `hard_evidence` | adult score >= 0.8 |
| `soft_evidence` | adult >= 0.5 OR racy >= 0.8 |
| `suggestive` | racy >= 0.5 |
| `none` | below all thresholds |

Real-time avatar monitor uses 80% threshold (intentionally high to minimize false positives on anime/furry content).

### Code Paths

- Vision API: `src/features/googleVision.ts`
- Avatar scanner: `src/features/avatarScan.ts`
- Real-time monitor: `src/features/avatarNsfwMonitor.ts`
- DB table: `avatar_scan` (includes banner columns as of migration 054)

---

## Voice Session Tracking

Started 2026-03-17. No historical data before this date.

- Table: `voice_session` (migration 052)
- Tracker: `src/features/voiceSessionTracker.ts`
- Seeds on bot startup, closes all on shutdown
- Newsletter voice minutes backfilled from Discord Server Insights for weeks of Mar 3-9 and Mar 10-16

---

## Guild Snapshot System

Bot writes live Discord gateway data to SQLite every 5 minutes so the web dashboard can display it.

- Tables: `guild_snapshot` (live), `guild_snapshot_log` (daily)
- Scheduler: `src/scheduler/guildSnapshotScheduler.ts`
- Online count (`approximatePresenceCount`) fetched via REST every 30 min (not every 5 min) to reduce API load
- Channel names cached in `channel_cache` table for resolving IDs to `#channel-name`
- Invite tracking in `invite_usage` table for growth source attribution

---

## Newsletter Stats

- Shows the **last completed calendar week** (Mon 00:00 UTC → Sun 23:59 UTC), not a rolling 7-day window
- Matches Discord Server Insights week boundaries
- Communicators count may be higher than Discord's because Discord excludes users who opted out of analytics tracking
- Query: `web/src/lib/server/queries/pulse.ts` → `getNewsletterStats()`
