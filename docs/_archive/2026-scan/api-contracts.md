# API Contracts - Pawtropolis Tech

> Auto-generated project documentation | 2026-03-01 | Exhaustive Scan

## Overview
This document catalogs all interaction entry points for the Pawtropolis Tech Discord bot: slash commands, button interactions, modal submissions, select menus, event listeners, and HTTP endpoints.

## Slash Commands (37 Total)

Create tables organized by feature area:

### Core & Health
- /health - Bot health check (uptime, ping, build info) - Public
- /update - Force check & update commands - Owner-only
- /sync - Sync slash commands to Discord - Owner-only
- /panic - Emergency shutdown - Owner-only
- /test - Testing utilities - Owner-only
- /developer (trace, stats) - Debug traces & errors - Staff

### Application Review (Gatekeeping)
- /gate (start, status, reset, end) - Main gatekeeping workflow - Staff - DB: applications, application_responses, pending_users
- /accept - Accept application - Staff - DB: applications, application_responses
- /reject - Reject application - Staff - DB: applications, application_responses
- /kick - Kick rejected member - Staff - DB: applications, application_responses
- /unclaim - Unclaim application - Staff - DB: applications
- /search - Search applications - Staff - DB: applications
- /listopen - List open applications - Staff - DB: applications
- /flag - Manually flag user - JuniorMod+ - DB: flagged_users
- /unblock - Remove from block list - Staff - DB: blocked_users

### Art Management
- /art (jobs, bump, finish, view, leaderboard, all, assign, getstatus, cancel, reassign) - Art management - Artists/Staff - DB: art_jobs, artist_queue
- /artistqueue (list, sync, move, skip, unskip, history, setup) - Artist rotation queue - ManageRoles - DB: artist_queue
- /redeemreward - Assign art from queue - JuniorMod+/Ambassadors/ManageRoles - DB: artist_queue, art_jobs

### Event Tracking
- /event movie (start, end, attendance, list, user, bump, credit, manual, recover) - Movie night - Staff - DB: movie_event, movie_attendance
- /event game (start, end, qualify, list, user, bump, credit, manual, recover) - Game night - Staff - DB: game_event, game_attendance
- /attendance (user, leaderboard) - Event attendance stats - Public - DB: movie_attendance, game_attendance

### Configuration
- /config (get, setChannels, setFeatures, setRoles, setAdvanced, toggleapis) - Server config - Admin - DB: guild_config
- /config artist (list, assign, unassign, setup) - Artist config - Admin
- /config movie (set-tier-roles, set-channel, set-minutes) - Movie config - Admin
- /config game (set-channel, set-minutes, set-category) - Game config - Admin
- /config poke (add-category, remove-category, exclude-channel, clear-excluded) - Poke config - Admin
- /config isitreal (set-api, get-api, disable) - AI detection config - Admin
- /config data - Server data settings - Admin

### Statistics & Analytics
- /stats user - User approval stats - Public
- /stats leaderboard - Top applicants - Public
- /stats approval-rate - Team approval rates - Staff
- /stats activity - Command activity - Staff
- /stats history - Historical analytics - Staff
- /stats export - Export data (CSV) - Owner

### Moderation & Safety
- /audit (members, nsfw, security) - Server audit - CommunityManager/BotDev
- /report submit - User report - Public - DB: report_log
- /isitreal - AI content detection - Staff - DB: ai_detection_log

### Utility
- /send - Anonymous staff message - Staff
- /roles - Show available roles - Public
- /help - Command help system - Public
- /modmail - Modmail system - Staff - DB: modmail_tickets
- /purge - Message purge - Mod+
- /poke - Ping specific user - Owner
- /usebyte - Byte token distribution - Staff - DB: byte_tokens
- /resetdata - Reset metrics epoch - Owner - DB: metrics_epoch
- /backfill - Historical data backfill - Owner
- /sample - Sample data generator - Owner
- /skullmode - Toggle skull mode - Owner
- /database (check, recover) - Database health & recovery - Owner

## Button Interactions

| Pattern | Custom ID Format | Handler File | Purpose |
|---------|-----------------|--------------|---------|
| Review Approve | `v1:decide:approve:code[HEX6]` | src/features/review/handlers/buttons.ts | Open approval modal |
| Review Accept | `v1:decide:accept:code[HEX6]` | src/features/review/handlers/buttons.ts | Open accept modal |
| Review Reject | `v1:decide:reject:code[HEX6]` | src/features/review/handlers/buttons.ts | Open rejection modal |
| Review Kick | `v1:decide:kick:code[HEX6]` | src/features/review/handlers/buttons.ts | Open kick modal |
| Review Claim | `v1:decide:claim:code[HEX6]` | src/features/review/handlers/buttons.ts | Claim application |
| Review Unclaim | `v1:decide:unclaim:code[HEX6]` | src/features/review/handlers/buttons.ts | Open unclaim modal |
| Open Modmail | `v1:decide:modmail:code[HEX6]` | src/features/review/handlers/buttons.ts | Open modmail thread |
| Permanent Reject | `v1:decide:permreject:code[HEX6]` | src/features/review/handlers/buttons.ts | Open perm reject modal |
| Copy UID | `v1:decide:copyuid:code[HEX6]:user[ID]` | src/features/review/handlers/buttons.ts | Copy user ID |
| Ping Unverified | `v1:ping_unverified:code[HEX6]:user[ID]` | src/features/review/handlers/buttons.ts | Ping user in channel |
| DB Recovery | `dbrecover:(validate\|restore-dry\|restore-confirm):[ID]:[NONCE]` | src/features/dbRecoveryButtons.ts | Database recovery workflow |
| Audit Confirm | `audit:(members\|nsfw):(confirm\|cancel):[NONCE]` | src/commands/audit.ts | Audit confirmation |
| Report Resolve | `v1:report:resolve:[HEX6]` | src/features/report/handlers.ts | Resolve report |
| Modmail Open | `modmail:open:[TICKET_ID]` | src/features/modmail/handlers.ts | Open thread |
| Modmail Close | `modmail:close:[THREAD_ID]` | src/features/modmail/handlers.ts | Close thread |
| Gate Start | `gate:start:[APP_ID]` | src/features/gate.ts | Start interview |
| Gate Done | `gate:done:[APP_ID]` | src/features/gate.ts | Complete interview |

## Modal Submissions

| Modal Type | Custom ID Format | Handler File | Input Fields | Purpose |
|-----------|-----------------|--------------|-------------|---------|
| Reject | `v1:decide:modal:reject:code[HEX6]` | src/features/review/handlers/modals.ts | reason | Rejection reason |
| Accept | `v1:decide:modal:accept:code[HEX6]` | src/features/review/handlers/modals.ts | reason (optional) | Approval comment |
| Kick | `v1:decide:modal:kick:code[HEX6]` | src/features/review/handlers/modals.ts | reason | Kick reason |
| Unclaim | `v1:decide:modal:unclaim:code[HEX6]` | src/features/review/handlers/modals.ts | reason | Unclaim reason |
| Perm Reject | `v1:decide:modal:permreject:code[HEX6]` | src/features/review/handlers/modals.ts | reason | Permanent rejection |
| Gate Interview | `gate:modal:[APP_ID]` | src/commands/gate/gateMain.ts | answer_[Q1-Q5] | Interview responses |
| Modmail Compose | `modmail:compose:[TICKET_ID]` | src/features/modmail/handlers.ts | response_text | Modmail reply |
| Report Submit | `report:submit` | src/features/report/handlers.ts | reason, attachment | Report submission |

## Select Menus

| Menu Type | Custom ID | Handler File | Purpose |
|-----------|----------|--------------|---------|
| Artist Rotation | `artist_rotation:assign:[TYPE]` | src/features/artistRotation/handlers.ts | Select art type |
| Channel Config | `config:channel:select` | src/commands/config/setChannels.ts | Select config channels |
| Role Config | `config:role:select` | src/commands/config/setRoles.ts | Select config roles |
| AI API Select | `isitreal:select_api` | src/commands/config/isitreal.ts | Select AI API |

## Discord Event Listeners

| Event | Handler File | Purpose |
|-------|-------------|---------|
| `ready` | src/index.ts | Schema validation, command sync, identity logging |
| `interactionCreate` | src/index.ts | Central routing hub |
| `messageCreate` | src/features/messageActivityLogger.ts | Activity tracking |
| `messageCreate` | src/listeners/messageDadMode.ts | Dad joke responses |
| `messageCreate` | src/listeners/messageSkullMode.ts | Skull emoji reactions |
| `guildMemberAdd` | src/features/botDetection.ts | Bot detection heuristic |
| `guildMemberAdd` | src/features/avatarScan.ts | NSFW avatar scanning |
| `voiceStateUpdate` | src/features/movieNight.ts | Movie attendance tracking |
| `voiceStateUpdate` | src/features/events/gameNight.ts | Game attendance tracking |
| `threadCreate` | src/events/forumPostNotify.ts | Forum post notifications |

## HTTP Endpoints

### Status API (Port 3002)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/status` | None | Shields.io badge JSON |
| GET | `/api/health` | None | Detailed health JSON |
| GET | `/health` | None | Health JSON (alias) |
| GET | `/` | None | Root info |
| OPTIONS | `/*` | None | CORS preflight (204) |

### Linked Roles OAuth2 (Port 3001)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/linked-roles` | None | Redirect to Discord OAuth2 |
| GET | `/linked-roles/callback` | OAuth2 | Exchange code, set metadata |
| GET | `/` | None | Server info |

Rate limits: General 10/min, OAuth 5/5min, State token expiry 10min.

## Scheduled Tasks

| Scheduler | File | Frequency | Purpose |
|-----------|------|-----------|---------|
| Event Timeout | src/scheduler/eventTimeoutScheduler.ts | Every 5 min | Auto-end events after 12 hours |
| Security Audit | src/scheduler/securityAuditScheduler.ts | Configurable | Periodic security snapshots |
| Byte Multiplier | src/scheduler/byteMultiplierScheduler.ts | Periodic | Expire XP multiplier tokens |
| Mod Metrics | src/scheduler/modMetricsScheduler.ts | Periodic | Aggregate moderator statistics |
| Ops Health | src/scheduler/opsHealthScheduler.ts | Configurable | Health monitoring checks |
| Disk Space | src/scheduler/diskSpaceScheduler.ts | Periodic | Monitor disk usage |
| Stale Apps | src/scheduler/staleApplicationCheck.ts | Periodic | Clean up stale applications |

## Permission Matrix

| Level | Roles | Example Commands |
|-------|-------|-----------------|
| Public | Everyone | /health, /help, /roles, /attendance, /stats user |
| Artists | Server Artists | /art jobs, /art finish |
| JuniorMod+ | Junior Mods and above | /flag |
| Staff | All staff roles | /gate, /accept, /reject, /send, /modmail |
| Mod+ | Moderators and above | /purge |
| Admin | Admins | /config |
| CommunityManager | CM/CDL | /audit |
| Owner | Bot owner(s) | /panic, /database, /resetdata, /backfill |

---

## See Also

- [Bot Handbook](./BOT-HANDBOOK.md): full per-command details for everything in this catalog
- [Slash Commands Reference](./reference/slash-commands.md): curated user-facing command list
- [Slash Commands System](./SLASH-COMMANDS.md): developer guide for creating commands
- [Permissions Matrix](./PERMS-MATRIX.md): full permission rules behind the table above
- [Architecture](./architecture.md): where these interaction handlers live in the codebase
