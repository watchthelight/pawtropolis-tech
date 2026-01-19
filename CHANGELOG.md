# Changelog

All changes to Pawtropolis Tech are tracked here.

**Versions:** [Unreleased](#unreleased) | [5.1.0](#510---2026-01-17) | [5.0.0](#500---2026-01-12) | [4.9.2](#492---2026-01-07) | [4.9.1](#491---2026-01-07) | [4.9.0](#490---2026-01-04) | [4.8.0](#480---2025-12-08) | [4.7.1](#471---2025-12-03) | [4.7.0](#470---2025-12-03) | [4.6.0](#460---2025-12-03) | [4.5.0](#450---2025-12-02) | [4.4.4](#444---2025-12-03) | [4.4.3](#443---2025-12-03) | [4.4.2](#442---2025-12-03) | [4.4.1](#441---2025-12-03) | [4.4.0](#440---2025-12-03) | [4.3.0](#430---2025-12-02) | [4.2.0](#420---2025-12-01) | [4.1.0](#410---2025-12-01) | [4.0.3](#403---2025-12-01) | [4.0.2](#402---2025-12-01) | [4.0.1](#401---2025-12-01) | [4.0.0](#400---2025-12-01) | [Earlier versions](#earlier-versions)

## [Unreleased]

### Added

- **`/attendance` Command** — Public event attendance stats and leaderboards:
  - `/attendance user [user]` — View your own or another user's movie/game night stats
  - `/attendance leaderboard [type]` — View top event attendees with optional movie/game filter
  - Shows total qualified events, time spent, and recent event history
  - Leaderboard displays top 15 with user's own rank if not listed
  - Available to everyone — no permission requirements
  - See `src/commands/attendance.ts`

### Changed

- **`/event` Permission Update** — Now accessible to Event Host and Events Manager roles, in addition to Moderator+. Allows independent event hosts to manage movie/game nights without needing mod roles.

- **`/config set movie_threshold` → `/config set-advanced movie_threshold`** — Moved to fix Discord's 25-subcommand limit. The `/config set` group was at 26 subcommands which caused command registration to fail.

- **`/report` Command Enhancements** — Updated per manager feedback:
  - **Thread title is now the user ID** — Makes searching for existing reports easier
  - **Mod team ping** — Automatically pings `@Moderation Team` when a report is created
  - **Reuses existing threads** — If a user already has a report thread, new reports post there instead of creating a new thread
  - **Default channel fallback** — Now defaults to `#reports` if no report forum is configured via `/config set report_forum`
  - **New `actions` option** — Reporters can document what actions they took (e.g., "Deleted message", "Issued warning")

---

## [5.1.0] - 2026-01-17

### Added

- **`/report` Command** — Ambassador content violation reporting system:
  - Ambassadors and staff can report rule violations with screenshot evidence
  - Creates forum thread in configurable report forum channel
  - Staff resolves reports via Resolve button with optional note
  - Thread automatically archived on resolution
  - Configure with `/config set report_forum channel:#content-reports`
  - See `src/commands/report.ts`, `src/features/report/`

- **Disk Space Monitor** — Scheduler that monitors server disk usage and alerts before outages:
  - Runs every 30 minutes (configurable via `DISK_SPACE_CHECK_INTERVAL_MINUTES`)
  - Warning alert at 80% usage, critical alert at 90%
  - Critical alerts ping bot_dev_role
  - Includes suggested cleanup commands in alert embed
  - 4-hour cooldown between repeated alerts (unless escalating from warning to critical)
  - See `src/scheduler/diskSpaceScheduler.ts`

- **`/usebyte` Command** — Self-service byte token redemption for XP multipliers:
  - Members with Byte Token roles can redeem them without opening support tickets
  - Supports 5 token rarities: Common (2x/12h), Rare (3x/24h), Epic (5x/48h), Legendary (5x/72h), Mythic (10x/168h)
  - Confirmation flow shows token info, multiplier details, and expiration time
  - Warning displayed when redemption would replace an active multiplier
  - Automatic expiration cleanup via scheduler (runs every 60 seconds)
  - Full audit trail logging with new action types
  - See `src/commands/usebyte.ts`, `src/features/byteTokenHandler.ts`, `src/scheduler/byteMultiplierScheduler.ts`
- **New Audit ActionTypes** for byte token system:
  - `byte_token_redeemed` — User redeemed a byte token
  - `byte_multiplier_applied` — Multiplier role granted to user
  - `byte_multiplier_expired` — Scheduler removed expired multiplier role
  - `byte_multiplier_replaced` — User upgraded to higher multiplier
- **Database Table** `active_byte_multipliers` — Tracks active XP multipliers with expiration times
- **Ambassador `/redeemreward` access** — Community Ambassadors can now use `/redeemreward` to assign art rewards, improving ticket response time

### Fixed

- **Trace ID consistency** — Permission denied embeds now use the request context trace ID instead of generating a new one. This ensures `/developer trace` can find the trace for any error. Fixed in:
  - `src/lib/permissionCard.ts`
  - `src/features/review/handlers/buttons.ts`
  - `src/features/review/handlers/modals.ts`
  - `src/features/modmail/threadOpen.ts`

- **Byte token stacking race condition** — Fixed issue where rapidly clicking multiple confirm buttons could stack multiplier roles. Now removes ALL multiplier roles before adding the new one, with post-add cleanup for concurrent requests.

---

## [5.0.0] - 2026-01-12

### Added

- **`/art cancel` Subcommand** — Staff-only command to cancel an art job without counting towards the artist's completed pieces:
  - Use case: Job reassignment, recipient left server, request withdrawn
  - Adds new "cancelled" status to job workflow (separate from "done")
  - Cancelled jobs don't appear in `/art jobs`, `/art all`, or leaderboards
  - Usage: `/art cancel id:<job_number> [reason:<text>]`

- **Security Audit Overhaul** — Major enhancement to `/audit security` with comprehensive permission analysis:
  - **Snapshot & Diff Tracking** — Each audit stores a snapshot for change detection between runs
  - **New Subcommands:**
    - `/audit trends [days]` — Show security issue trends over 7/30 days
    - `/audit diff` — Show permission changes since last audit with dangerous change highlights
  - **New Security Checks:**
    - Role hierarchy inversions (lower role with more perms than higher)
    - ManageRoles scope warnings (position vs assignable roles)
    - Channel sync validation (overrides category denials)
    - Webhook access to sensitive channels detection
    - Gate channel exposure detection
    - Unverified role dangerous permission detection
  - **New Documentation:**
    - `HIERARCHY.md` — Visual role hierarchy with permission analysis
    - `DIFF.md` — Permission changes since last audit (auto-generated)
  - **Enhanced Scheduler:**
    - Now posts diff alerts when dangerous permissions are added
    - Pings leadership for critical issues AND dangerous permission changes
    - Stores snapshots for trend tracking
  - **Database Tables:**
    - `security_audit_snapshots` — Complete audit state for diff tracking
    - `security_issue_history` — Issue counts over time for trends
    - `bot_permission_requirements` — Document expected bot permissions (future)
  - See `migrations/042_security_audit_snapshots.ts`, `src/features/securityDiff.ts`, `src/store/securitySnapshotStore.ts`

- **Automated Security Audit Scheduler** — New scheduler that runs `/audit security` automatically every 30 minutes:
  - Posts results to the logging channel (#bot-logs)
  - Pings Server Dev, Community Manager, and Senior Administrator roles for unacknowledged critical issues
  - Helps catch dangerous permission misconfigurations like INC-002 (Community Apps with Admin)
  - See `src/scheduler/securityAuditScheduler.ts`
- **`/skullmode` Command Registration** — The `/skullmode` command was missing from Discord command registration. Now properly registered in `buildCommands.ts` and `index.ts`.
- **`/developer trace` Command** — Staff can now look up verbose trace details from error card trace IDs:
  - Request overview (command, user, guild, outcome, duration)
  - Execution timeline with individual phase timings
  - Database queries with SQL and timing
  - User context (roles, permissions)
  - Full error details (kind, code, message, stack trace in dev)
  - Custom attributes and affected entities
  - Traces stored in-memory for 30 minutes (500 trace max)
- **`/developer stats` Command** — Shows trace cache statistics (size, TTL, memory estimate)
- **Slash Command System Documentation** — Comprehensive developer guide at `docs/SLASH-COMMANDS.md` covering:
  - Command file structure and required exports
  - Registration in `buildCommands.ts` and `index.ts`
  - Deployment process and runtime auto-sync
  - Interaction handlers (buttons, modals, autocomplete)
  - Helper patterns (withStep, withSql, permissions)
  - Troubleshooting guide and checklist for new commands
- **`metrics_reset` ActionType** — New audit trail action type for `/resetdata` command. Previously used `modmail_close` as a workaround.
- **New Audit ActionTypes** — Added 5 new action types for unified audit trail logging:
  - `flag_added` — User manually flagged as suspicious
  - `flag_removed` — User unflagged
  - `message_purge` — Bulk message deletion
  - `dm_sent` — Anonymous DM sent via `/send`
  - `user_unblocked` — Permanent rejection removed
- **Audit Trail Logging** — Added `logActionPretty` calls to `/flag`, `/purge`, `/send`, and `/unblock` commands for unified audit trail visibility.

### Security

- **Rate Limit on `/send`** — Added 60-second cooldown per user to prevent DM spam abuse via the anonymous message command.
- **Rate Limit on `/poke`** — Added 60-second cooldown per user to prevent notification spam.
- **Rate Limit on `/stats export`** — Added 5-minute cooldown per user to prevent expensive CSV generation abuse.
- **DM Permission Restrictions** — Added `.setDMPermission(false)` to prevent guild-only commands from being used in DMs:
  - `/roles` — Role automation configuration
  - `/flag` — User flagging system
  - `/art` — Artist job management
  - `/artistqueue` — Artist rotation queue management

### Fixed

- **`/resetdata` ActionType** — Changed from incorrect `"modmail_close"` to proper `"metrics_reset"` action type for accurate audit logging.

### Changed

- **Command Instrumentation Unification (Complete: 10 Phases)** — Standardized execution tracing across 50+ command handlers using `withStep()` and `withSql()` patterns:
  - **Config Handlers (11 files)**: setRoles, setChannels, setAdvanced, setFeatures, get, artist, movie, game, poke, isitreal, toggleapis
  - **Gate Commands (5 files)**: gateMain (10 subcommands), accept, reject, kick, unclaim
  - **Event Commands (3 files)**: event/index (router), event/movie (7 handlers), event/game (7 handlers)
  - **Complex Commands (9 files)**: send, purge, backfill, resetdata, panic, audit (5 subcommands), database, update (4 subcommands), help
  - **Remaining Commands (5 files)**: poke (verified), redeemreward (4 phases), review/setNotifyConfig (6 phases), review/getNotifyConfig (6 phases), review-set-listopen-output (4 phases)
  - All commands now have consistent phase tracking for debugging via `/developer trace`
  - Database operations are properly instrumented for query timing in error cards
  - Updated `withStep()` to accept all interaction types (ChatInput, Modal, Button)
- **Structured Logging `evt` Fields** — Added `evt` (event type) field to all logger calls in commands for consistent log aggregation and filtering:
  - `/unblock` — 8 event types: `unblock_success`, `unblock_error`, `unblock_dm_sent`, `unblock_dm_failed`, etc.
  - `/search` — 3 event types: `search_executed`, `search_unauthorized`, `search_error`
  - `/stats user` — Added `stats_user_view` event
  - `/stats export` — Added `stats_export` event
- **Deployment Script Robustness** — Improved `deploy.sh` reliability:
  - Added `set -euo pipefail` for stricter error handling
  - Added post-deploy health check (waits 3s, verifies PM2 process status)
  - Added remote tarball cleanup step
  - Updated step count from 7 to 9 steps

### Deprecated

- **`/movie` Command** — This command is deprecated in favor of `/event movie`. All subcommands (start, end, attendance, add, credit, bump, resume) show a deprecation notice in the response footer. Target removal: **v6.0.0**. Migration path: Use the equivalent `/event movie *` subcommands which are part of the unified event tracking system.

### Removed

- **Dead Code Cleanup** — Removed 9 unused exports and 2 unused imports:
  - `invalidateDraftsCache` from listopen.ts
  - `clearMetricsEpoch` from metricsEpoch.ts
  - `APPLICANT_ACTIONS`, `getModeratorMetrics`, `getTopModerators` from modPerformance.ts
  - `getConfiguredGuilds` from notifyConfig.ts
  - `getAssignmentHistory`, `getRecentAssignments` from roleAutomation.ts
  - `OAUTH_RATE_LIMIT_MAX_REQUESTS` from constants.ts
  - Unused `ensureDeferred` imports from movie.ts and unblock.ts

---

## [4.9.2] - 2026-01-07

### Fixed

- **`/audit acknowledge` & `/audit unacknowledge` Timeout** — Fixed "The application did not respond" error that occurred when these commands took too long. Interaction is now deferred immediately before permission checks.
- **`/audit security` Git Sync** — Fixed push failures when the server's git repo was out of sync with remote. The command now auto-syncs (fetch, stash, pull --rebase, pop) before pushing.

### Changed

- **`/audit security` Verbose Progress** — Now shows real-time progress updates instead of "is thinking":
  - Fetching server roles
  - Analyzing permissions
  - Git operations (sync, commit, push)
  - Final summary with issue breakdown

---

## [4.9.1] - 2026-01-07

### Changed

- **`/unclaim` Admin Override** — Administrators+ can now unclaim applications claimed by other staff members. Previously, only the person who claimed an application could unclaim it. This allows admins to resolve stalemates when a staff member is unavailable.

---

## [4.9.0] - 2026-01-04

### Added

- **GitHub Actions CI/CD** - Automated quality checks on every push/PR:
  - Typecheck, lint, format check, and test jobs
  - Coverage reports uploaded as artifacts
  - Build verification for production readiness
- **Dynamic README Badges** - Auto-updating badges via GitHub Gist:
  - Commands count, lines of code, test count, coverage percentage, version
  - Updated automatically on push to main (every 6 hours fallback)
  - Scripts in `scripts/generate-badge-metrics.js`
- **Status Endpoint** - Bot now serves `/api/status` and `/api/health` endpoints:
  - Shields.io-compatible JSON format for status badges
  - Shows online/offline status, uptime, WebSocket latency
  - Runs on port 3002 (configurable via `STATUS_PORT` env var)
- **Auto-Commit Assets** - `/update banner` and `/update avatar` now auto-push to GitHub:
  - Assets saved to `assets/` folder and committed automatically
  - Requires `GITHUB_BOT_TOKEN`, `GITHUB_BOT_USERNAME`, `GITHUB_BOT_EMAIL`, `GITHUB_REPO` env vars
  - Reply includes link to GitHub commit on success
- **Professional README** - Redesigned with centered banner, avatar, and badge rows

- **Security Issue Acknowledgments** - Staff can now acknowledge security warnings that are intentional:
  - `/audit acknowledge <issue-id> [reason]` - Mark a security warning as intentional (e.g., Chat Reviver needs MentionEveryone)
  - `/audit unacknowledge <issue-id>` - Remove acknowledgment if you change your mind
  - Acknowledged issues appear in a separate "Acknowledged Issues" section in CONFLICTS.md
  - Acknowledgments auto-reset when underlying permissions change (forcing re-review)
  - Shows who acknowledged each issue and when, with optional reason
- **Server Audit Documentation** - Comprehensive internal documentation of server structure:
  - `docs/internal-info/ROLES.md` - All 219 roles with positions, colors, member counts, and full permission matrix
  - `docs/internal-info/CHANNELS.md` - All 225 channels with categories, types, and permission overwrites
  - `docs/internal-info/CONFLICTS.md` - Security analysis identifying 7 issues (2 critical, 1 high, 4 medium)
  - `docs/internal-info/SERVER-INFO.md` - Server metadata, settings, and statistics
  - `/audit security` - Bot command to regenerate documentation, auto-commit, and push to GitHub with link
  - `scripts/audit-server-full.ts` - Re-runnable script to regenerate documentation
- **Unclaim Button** - Review cards have an "Unclaim" button that requires typing "UNCLAIM" to confirm. Only the person who claimed it can unclaim.
- **Incident Log** - Added `INCIDENTS.md` to track production incidents and resolutions
- **Game Night Tracking** - New `/event game` command for game night attendance tracking with percentage-based qualification:
  - `/event game start #channel` - Start tracking attendance in a voice channel
  - `/event game end` - End event and calculate qualification based on % of event duration attended
  - `/event game attendance` - View attendance stats (live during event, historical after)
  - `/event game add/credit/bump` - Manual attendance adjustments
  - `/config set game_threshold` - Configure qualification percentage (default: 50%)
  - `/config get game_config` - View game night configuration
- **Game Night Tier Roles** - Automatic tier role rewards for game night attendance:
  - `/roles add-game-tier` - Configure tier roles (e.g., 1 game = T1, 5 games = T2)
  - `/roles remove-game-tier` - Remove a game tier
  - `/roles list` - View configured game tiers
  - Automatically assigns roles when users qualify, removes lower tiers
  - DMs users with progress updates after each game night
- **Unified Event System** - `/event movie` now mirrors `/movie` (which is deprecated). Both movie and game nights use the same underlying tracking system.
- **Combined Event Stats** - Movie and game night attendance tracked in same database for unified statistics

### Security

- **Guild Allowlist** - Bot now only operates in Pawtropolis (guild ID `896070888594759740`). Automatically leaves any other server it's added to. See INC-001 in `INCIDENTS.md`.

### Fixed

- **Movie Night DM Role Display** - DMs now show the actual role name (e.g., "Movie Buff") instead of "@unknown-role" since role mentions don't render in DMs

### Changed

- **Repository Renamed** - Repo renamed from `pawtech-v2` to `pawtropolis-tech`. All URLs and references updated throughout codebase.
- **Documentation Unified Events** - All staff docs now reference both movie and game nights under unified "Events" section:
  - BOT-HANDBOOK: Combined Movie Night + Game Night into single Events section
  - MODERATOR-GUIDE, MOD-QUICKREF: Updated with both event types and commands
  - ADMIN-GUIDE: Added game tier role commands
- **Badge Files Reorganized** - Moved badge JSON files from root to `.github/badges/` for cleaner project structure
- **Modmail Open Message** - Now includes clearer instructions: explains that replies go to staff only, are confidential, and verification continues after modmail closes
- **Permission System Redesign** - Commands now use specific role names instead of generic "staff" permissions. Each command requires a minimum role level. Bot owners and server devs can bypass all restrictions. Error messages show which roles you need. See `PERMS-MATRIX.md` for details.
- **Analytics Command Consolidation** - Unified analytics commands under `/stats`:
  - `/activity` → `/stats activity`
  - `/approval-rate` → `/stats approval-rate`
  - `/modstats leaderboard` → `/stats leaderboard`
  - `/modstats user` → `/stats user`
  - `/modstats export` → `/stats export`
  - `/modstats reset` → `/stats reset`
  - `/modhistory` → `/stats history`

### Removed

- **`/activity`** - Replaced by `/stats activity`
- **`/approval-rate`** - Replaced by `/stats approval-rate`
- **`/modstats`** - Replaced by `/stats`
- **`/modhistory`** - Replaced by `/stats history`
- **`/analytics`** and **`/analytics-export`** - Replaced by `/stats activity`

### Deprecated

- **`/movie` command** - Use `/event movie` instead. The `/movie` command still works but will be removed in a future version.

### Security

- Added cooldowns to prevent spam and abuse:
  - Avatar NSFW scans: 1 hour per user
  - `/search`: 30 seconds per user, 50ms delay between API calls
  - `/backfill`: 30 minutes per server
  - `/purge`: 5 minutes per user
  - `/flag`: 15 seconds (increased from 2)
  - `/artistqueue sync`: 5 minutes per server
- Added 30-second lockout after wrong passwords on `/resetdata` and `/purge`
- Hide sensitive data in error messages and logs
- Added input validation to prevent malicious code injection
- Limited modmail memory to 10,000 entries to prevent crashes
- Limited flagged user queries to 10,000 entries

---

## [4.8.0] - 2025-12-08

### Added

- **Better Permission Errors** - Permission denied messages now show which roles you need to use a command
- **"Is It Real?" Context Menu** - Right-click any message → Apps → "Is It Real?" to check if images are AI-generated
- **Skull Mode** - Random skull emoji reactions. Use `/skullmode chance:N` to set odds, `/config set skullmode` to toggle on/off

### Removed

- Removed right-click context menu for opening modmail threads

### Fixed

- **Welcome Card Retry Logic** - Welcome cards now retry up to 3 times when network errors occur
- **Bot Dev Ping** - Fixed bug where bot devs weren't getting pinged on new applications even when enabled

### Changed

- `/update status` without text now clears the status instead of showing an error
- **AI Detection API Switch** - Switched from Illuminarty to RapidAPI. Update your `.env` file with `RAPIDAPI_KEY`

---

## [4.7.1] - 2025-12-03

### Fixed

- Fixed autocomplete and select menus not working in `/help` command

### Changed

- Only the person who ran `/help` can use its buttons and menus
- Removed all emojis from help system for a cleaner look

---

## [4.7.0] - 2025-12-03

### Added

- **Interactive Help System** - New `/help` command with search, categories, autocomplete, and navigation. Only shows commands you have permission to use.

- **Movie Night Improvements**:
  - Users already in voice chat get credit when `/movie start` runs
  - Sessions save every 5 minutes and recover after bot restarts
  - New commands: `/movie add`, `/movie credit`, `/movie bump` for manual attendance adjustments
  - Use `/movie resume` to check recovered session status

- **AI Detection Setup Wizard** - New `/config isitreal` command to set up API keys with a visual dashboard. Test keys before saving. No restart needed.

---

## [4.6.0] - 2025-12-03

### Added

- **AI Detection Command** - New `/isitreal` command checks if images are AI-generated using Hive, SightEngine, and Optic APIs. Shows average score and breakdown per service. Staff-only.

### Documentation

- Added cross-links between all handbooks
- Fixed outdated references and dates

### Removed

- Removed ~1,400 lines of unused code and 14 old migration files
- Fixed duplicate migration numbers
- Cleaned up 10 empty folders

---

## [4.5.0] - 2025-12-02

### Database

- Improved database query speed by caching prepared statements across 10 files
- Added transaction wrapping to ensure atomic operations
- Added validation helpers for Discord IDs and empty values

### Security

- Prevented SQL injection attacks with input validation
- Moved API keys out of URLs to prevent log exposure
- Added permission checks for dangerous `/database recover` command
- Added rate limiting to expensive commands
- Prevented path manipulation attacks in file handling
- Limited reason text to 512 characters to prevent bloat

### Refactored

- Cleaned up file structure by merging scattered utilities
- Fixed naming conflicts between types
- Updated import paths across 15 files

### Changed

- Better error handling with debug logging instead of silent failures
- Notify users when critical operations fail

### Performance

- **Much faster queries**: Fixed slow database patterns that were making too many requests
- **Faster NSFW audits**: Changed from one-at-a-time to batch processing (100+ seconds → ~15 seconds for 1000 members)
- **New database indexes**: Added 5 indexes to speed up common searches
- **Memory protection**: Added limits to prevent crashes during high traffic

### Cleanup

- Removed unused code and functions
- Dropped empty database tables
- Cleaned up unused test files

---

## [4.4.4] - 2025-12-03

### Changed

- Split large files into smaller, easier-to-maintain modules:
  - Modmail threads code split into 5 files
  - Modstats split into 5 files
  - Gate commands split into 7 files
  - Config commands split into 11 files

---

## [4.4.3] - 2025-12-03

### Changed

- Split review handlers into 6 smaller files
- Extracted modmail thread state code

---

## [4.4.2] - 2025-12-03

### Changed

- Removed website references (website no longer exists)

---

## [4.4.1] - 2025-12-03

### Added

- Added AI detection tool links to moderator handbook

---

## [4.4.0] - 2025-12-03

### Added

- **Auto NSFW Avatar Scan** - Bot now scans avatars automatically when users change them. Alerts go to logging channel.
- **Resume NSFW Audits** - Can now resume interrupted audits. Progress saves to database.
- `/health` command now shows active event listeners

### Changed

- NSFW audit progress updates more frequently with better feedback

---

## [4.3.0] - 2025-12-02

### Added

- **New `/audit nsfw` command** - Scan avatars for NSFW content using Google Vision API. Can scan all members or only flagged users.

### Changed

- Split `/audit` into `/audit members` and `/audit nsfw` subcommands

### Removed

- Removed unused suggestions feature (~1,700 lines of code)

---

## [4.2.0] - 2025-12-01

### Changed

- Added many new configuration options to `/config` command

---

## [4.1.0] - 2025-12-01

### Changed

- More configuration options and improvements

---

## [4.0.3] - 2025-12-01

### Changed

- Minor handbook fixes

---

## [4.0.2] - 2025-12-01

### Changed

- Expanded documentation

---

## [4.0.1] - 2025-12-01

### Changed

- Minor documentation updates

---

## [4.0.0] - 2025-12-01

### Added

- **Art Jobs System** - New `/art` command to track commissions and requests. Fully integrated with search.

---

## Earlier Versions

### [3.1.2] - 2025-11-30
- Added moderator handbook
- Removed cage command

### [3.1.1] - 2025-11-30
- Cleaned up 89 roadmap files

### [3.1.0] - 2025-11-30
- Fixed memory leaks with LRU cache
- Added scheduler health monitoring
- Fixed 40+ bugs from codebase audit

### [3.0.0] - 2025-11-30
- Full codebase audit (48 issues found and fixed)
- Fixed SQL injection bug
- Fixed memory leaks
- Security improvements

### [2.3.1 - 2.3.11] - 2025-11-29
- Created BOT-HANDBOOK and MOD-QUICKREF documentation

### [2.3.0] - 2025-11-29
- **Artist Rotation System** - Queue management for rotating artist role

### [2.2.0] - 2025-11-28
- Added `/search` command
- Added suggestions system (later removed)
- Added approval rate analytics
- Added stale application checker

### [2.1.0] - 2025-11-27
- Cleaned up project structure

### [2.0.0 - 2.0.4] - 2025-11-26
- **Major error handling overhaul**
- Added comprehensive error system
- Security hardening
- Bug fixes

### [1.1.0 - 1.1.5] - 2025-11-25
- Added role automation system
- Added `/movie` command for movie night voting
- Added `/panic` emergency lockdown
- Added documentation

### [1.0.0] - 2025-11-25
- **Initial release**
- Gate system for application review
- Modmail system
- Review system with claim tracking
- Mod tools (`/flag`, `/modstats`, `/purge`, etc.)
- Analytics and activity tracking
- Full configuration system

