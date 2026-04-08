# PR6 — Web Control Panel (Discord OAuth + Admin Panel)

## 🧭 Overview

Implements a Fastify-based web panel for guild admins to visualize logs, view mod stats, and update configuration interactively.

## 🧩 Changes

- Added Fastify web app with Discord OAuth2.
- Routes: `/panel/login`, `/panel/config`, `/panel/logs`, `/panel/mods`.
- Integrated live charts (Chart.js) for analytics display.
- Role-based permissions enforced from Discord roles.
- Config updates write directly to SQLite config tables.

## ✅ Acceptance Criteria

- [ ] OAuth2 login flow functional.
- [ ] `/panel/config` syncs with `/config` command changes.
- [ ] `/panel/logs` updates live with recent events.
- [ ] Access restricted to guild admins.
- [ ] Logs load in <1s with 200 entries.

## 🧪 Testing Plan

1. Log in via Discord OAuth.
2. Confirm correct guild list and settings.
3. Update config → validate in DB.
4. Trigger bot actions → observe real-time log update.
5. Attempt unauthorized access → verify denial.

## ⚙️ Files Touched

- `src/server/panel.ts`
- `src/auth/oauth.ts`
- `src/templates/config.html`
- `src/templates/logs.html`
- `src/templates/mods.html`

---

> **Archived doc.** Historical PR implementation notes. See the [_archive index](../README.md), the [current docs](../../README.md), or [Architecture: System Overview](../../architecture/system-overview.md) for the current dashboard.
