# PR4 — Logging Channel Integration + Dashboard

## 🧭 Overview

Adds centralized logging to all major actions (accept, reject, claim, unclaim, submission).  
Each guild can now configure a dedicated logging channel or fall back to the `LOGGING_CHANNEL` env variable.  
Also includes the foundation for a web dashboard JSON feed (`/logs/dashboard.json`).

## 🧩 Changes

- Added `logging_channel_id` column to guild configuration table.
- Implemented `logActionPretty()` in `logger.ts` for unified embed card output.
- Added `/config set logging` to define per-guild logging channel.
- Added persistent log storage table `action_log`.
- Built Fastify route `/logs/dashboard.json` to expose recent logs.

## ✅ Acceptance Criteria

- [ ] All moderation actions emit embeds to the configured channel.
- [ ] Fallback to `LOGGING_CHANNEL` works correctly.
- [ ] Logs are persisted in SQLite.
- [ ] `/logs/dashboard.json` returns latest entries.
- [ ] Logging channel configuration persists through restarts.

## 🧪 Testing Plan

1. Run `/config set logging #mod-logs`
2. Submit test application, claim, and reject → verify embed.
3. Inspect DB table `action_log`.
4. Run `curl localhost:3000/logs/dashboard.json` → verify JSON.
5. Delete channel → ensure fallback activates.

## ⚙️ Files Touched

- `src/config/loggingStore.ts`
- `src/features/logger.ts`
- `src/db/ensure.ts`
- `src/commands/config.ts`
- `src/server/routes/dashboard.ts`

---

> **Archived doc.** Historical PR implementation notes. See the [_archive index](../README.md), the [current docs](../../README.md), or [Logging and ModStats](../../reference/logging-and-modstats.md) for current logging behavior.
