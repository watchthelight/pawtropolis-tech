# PR7 — Queue Health and Application Lifecycle Monitoring

## 🧭 Overview

Adds `/queuehealth` command for visibility into backlog, claim rate, and stuck applications.  
Includes automated alerts for unclaimed apps and export options.

## 🧩 Changes

- Added `/queuehealth` with summary embed (counts, medians, backlog).
- Introduced queue tracker service reading from `review_action`.
- Added alert system (DM admins on >24h unclaimed tickets).
- Optional CSV export for analytics.
- Integrated queue data into `/analytics` dashboard.

## ✅ Acceptance Criteria

- [ ] `/queuehealth` runs on all guilds.
- [ ] Alert triggers when backlog > threshold or oldest app > 24h.
- [ ] Export format matches internal analytics schema.
- [ ] Data matches `/modstats` activity.
- [ ] Handles multiple guild queues safely.

## 🧪 Testing Plan

1. Create 10+ test apps and delay claims.
2. Run `/queuehealth` → verify backlog data.
3. Wait >24h (or mock time) → check DM alert.
4. Export data and validate CSV fields.
5. Confirm cleanup jobs work without errors.

## ⚙️ Files Touched

- `src/features/queueHealth.ts`
- `src/features/review.ts`
- `src/analytics/queueAnalytics.ts`
- `src/commands/queuehealth.ts`
- `src/server/routes/queue.ts`

---

> **Archived doc.** Historical PR implementation notes. See the [_archive index](../README.md), the [current docs](../../README.md), or [Logging and ModStats](../../reference/logging-and-modstats.md) for current monitoring.
