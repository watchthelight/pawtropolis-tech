# Pawtropolis Tech Gatekeeper
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Transparent, server-owned Discord gatekeeping bot: pinned application, staff review actions, modmail bridge, and clean audit logs.

**Maintainer:** watchthelight (Bash) • admin@watchthelight.org • Discord: `watchthelight`  
**License:** MIT © 2025 watchthelight (Bash) 

---

## What’s built (current status)

- ✅ **Project scaffold**: Node 20 + TypeScript, discord.js v14, tsx, tsup, eslint/prettier, pino logs, env validation.
- ✅ **Branding & licensing**: MIT license, package metadata, file headers.
- ✅ **Database**: SQLite with migrations/runner, WAL pragmas, seeds.
- ✅ **Seeded config**: TEST guild `1427677679280324730`, reviewer role `896070888749940774`, 5 application questions.
- ✅ **Slash command `/health`**: uptime + WS ping.
- ✅ **Admin suite (Step 3)**: `/gate setup | config | status | reset` with Zod validation and staff perms.
- ✅ **Hosting**: EC2 Ubuntu t*-micro, Node 20, PM2, SSH alias `pawtech` → `ubuntu@3.209.223.216`.
- 🟡 **Gate entry UX (Step 4)**: in progress — pinned gate embed + Start button → paged modals → draft persistence.
- ⛔ **Submission pipeline (Step 5)**: staff review card with Q&A + action buttons.
- ⛔ **Accept/Reject/Kick (Step 6)**: idempotent flows, welcome ping, DM reason, cooldowns.
- ⛔ **Ping Applicant (Step 7)**: temp mention in unverified + jump link + auto-delete.
- ⛔ **Modmail bridge (Step 8)**: thread ↔ DM mirror, close, transcript pointer.
- ⛔ **Admin UX polish (Step 9)**: question CRUD commands, policy flags, audit log channel.
- 🟡 **Observability (Step 10)**: basic logs done; still adding status health report, backup/rotate script, and runbook.

---

## Roadmap (10 parts)

1) **Foundations & guild setup** — ✅  
2) **Data model & storage** — ✅  
3) **Slash commands & config management** — ✅  
4) **Gate entry UX** — 🟡 building now  
5) **Submission & staff review card** — next  
6) **Accept / Reject / Kick flows**  
7) **Ping Applicant jump-link**  
8) **Modmail thread bridge**  
9) **Admin UX & hardening**  
10) **Observability, backups, packaging, deploy docs**

---

## Dev quickstart (local)

```bash
# Windows PowerShell or Bash
cp .env.example .env   # then fill values
npm ci
npm run db:migrate
npm run deploy:cmds    # with GUILD_ID set to your test guild
npm run dev            # tsx watch
