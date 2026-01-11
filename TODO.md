# Pawtropolis Tech Master TODO

> **Last Updated:** 2026-01-11
> **Audit Reference:** See `audit/` folder for detailed reports

---

## Critical Fixes (P1)

> Reference: [audit/00_EXEC_SUMMARY.md](audit/00_EXEC_SUMMARY.md)

### 1.1 Register Missing Command ✅
- [x] Add `/skullmode` to `src/commands/buildCommands.ts`
- [x] Add to `commands.set()` in `src/index.ts`
- [ ] Run `npm run deploy:cmds`
> Reference: [audit/01_COMMAND_INDEX.md](audit/01_COMMAND_INDEX.md) - Critical Finding

### 1.2 Add Missing Rate Limit ✅
- [x] Add rate limit to `/send` command (DM spam risk)
  ```typescript
  const sendLimit = checkCooldown("send", interaction.user.id, 60 * 1000);
  ```
> Reference: [audit/05_SECURITY_AND_ABUSE_SURFACE.md](audit/05_SECURITY_AND_ABUSE_SURFACE.md) - P1 Critical

### 1.3 Fix Wrong ActionType ✅
- [x] Change `resetdata.ts` from `"modmail_close"` to proper `"metrics_reset"` ActionType
- [x] Add `"metrics_reset"` to ActionType union in `src/logging/pretty.ts`
- [x] Add meta config for the new action type
> Reference: [audit/02_DEAD_CODE_REPORT.md](audit/02_DEAD_CODE_REPORT.md) - Workarounds/Hacks

### 1.4 Deployment Validation ✅
- [x] Add `set -euo pipefail` to `deploy.sh` (line 2)
- [x] Add post-deploy health check after PM2 restart
- [x] Add remote tarball cleanup step
> Reference: [audit/04_DEPLOYMENT_AUDIT.md](audit/04_DEPLOYMENT_AUDIT.md) - P1 Immediate

---

## High Priority Fixes (P2)

### 2.1 Dead Code Cleanup ✅
> Reference: [audit/02_DEAD_CODE_REPORT.md](audit/02_DEAD_CODE_REPORT.md)

Remove unused exports:
- [x] `invalidateDraftsCache` - `src/commands/listopen.ts:285`
- [x] `clearMetricsEpoch` - `src/features/metricsEpoch.ts:158`
- [x] `APPLICANT_ACTIONS` - `src/features/modPerformance.ts:38`
- [x] `getModeratorMetrics` - `src/features/modPerformance.ts:441`
- [x] `getTopModerators` - `src/features/modPerformance.ts:458`
- [x] `getConfiguredGuilds` - `src/features/notifyConfig.ts:186`
- [x] `getAssignmentHistory` - `src/features/roleAutomation.ts:472`
- [x] `getRecentAssignments` - `src/features/roleAutomation.ts:489`
- [N/A] `getShortBuildId` - Actually used by health.ts and errorCardV2.ts
- [N/A] `getBuildAge` - Actually used by health.ts and errorCardV2.ts
- [x] `OAUTH_RATE_LIMIT_MAX_REQUESTS` - `src/lib/constants.ts:61`

Remove unused imports:
- [x] `ensureDeferred` in `src/commands/movie.ts:24`
- [x] `ensureDeferred` in `src/commands/unblock.ts:20`

### 2.2 Logging Gaps ✅
> Reference: [audit/03_LOGGING_GAP_REPORT.md](audit/03_LOGGING_GAP_REPORT.md)

Add new ActionTypes: ✅
- [x] Add `flag_added`, `flag_removed` to ActionType union
- [x] Add `message_purge` ActionType
- [x] Add `dm_sent` ActionType
- [x] Add `user_unblocked` ActionType
- [x] Add meta configs for all new types

Add audit trail logging: ✅
- [x] Add `logActionPretty` to `/flag` command
- [x] Add `logActionPretty` to `/purge` command
- [x] Add `logActionPretty` to `/send` command
- [x] Add `logActionPretty` to `/unblock` command

Add `evt` field to logger calls: ✅
- [x] `src/commands/unblock.ts` - add evt to all logger calls
- [x] `src/commands/search.ts` - add evt to all logger calls
- [x] `src/commands/stats/user.ts` - add evt field
- [x] `src/commands/stats/export.ts` - add evt field

### 2.3 Security Fixes ✅
> Reference: [audit/05_SECURITY_AND_ABUSE_SURFACE.md](audit/05_SECURITY_AND_ABUSE_SURFACE.md)

Add missing `setDMPermission(false)`: ✅
- [x] `src/commands/roles.ts`
- [x] `src/commands/flag.ts`
- [x] `src/commands/art.ts`
- [x] `src/commands/artistqueue.ts`

Add rate limits: ✅
- [x] Add rate limit to `/poke` (60 seconds)
- [x] Add rate limit to `/stats export` (5 minutes)

### 2.4 Deployment Improvements
> Reference: [audit/04_DEPLOYMENT_AUDIT.md](audit/04_DEPLOYMENT_AUDIT.md)

- [ ] Add SSH timeout options to all SSH commands
- [ ] Add deploy lock mechanism (prevent concurrent deploys)
- [ ] Move `REMOTE_HOST` to environment variable
- [ ] Add database backup before deploy (optional)
- [ ] Add rollback capability (keep `dist.backup`)

---

## Command Unification

> **Goal:** Standardize ~50 slash commands to consistent patterns for routing, signatures, instrumentation, and documentation.
> Reference: [.claude/plans/peaceful-stargazing-dijkstra.md](.claude/plans/peaceful-stargazing-dijkstra.md)

### Phase 1: Foundation
- [x] Create `src/commands/_template.ts.example` with golden standard pattern
- [x] Create `docs/reference/command-refactor-checklist.md`

### Phase 2: Priority Fixes
- [x] Fix stats/index.ts mixed signatures
- [x] Fix stats/leaderboard.ts - add withStep, withSql
- [x] Fix stats/user.ts - add withStep, withSql
- [x] Fix stats/export.ts - add withStep, withSql
- [x] Fix stats/reset.ts - add withStep
- [x] Convert config/index.ts if/else to switch
- [ ] Verify all stats commands work
- [ ] Verify all config subcommands work

### Phase 3: Tier 1 Commands (Simple)
- [x] sample.ts - add withStep
- [x] unblock.ts - add withStep, withSql
- [x] skullmode.ts - add withStep
- [x] movie.ts - add withStep, withSql
- [x] roles.ts - add withStep, withSql
- [ ] Verify all Tier 1 commands work

### Phase 4: Tier 2 Commands (Moderate)
- [x] listopen.ts - add withStep, withSql
- [x] search.ts - add withStep, withSql
- [x] flag.ts - add withStep, withSql
- [x] isitreal.ts - add withStep
- [x] art.ts - add withStep to all 8 subcommands
- [x] artistqueue.ts - add withStep, withSql
- [ ] Verify all Tier 2 commands work

### Phase 5-6: Config Handlers (11 files) ✅
- [x] config/setRoles.ts - add withStep, withSql
- [x] config/setChannels.ts - add withStep, withSql
- [x] config/setAdvanced.ts - add withStep, withSql
- [x] config/setFeatures.ts - add withStep, withSql
- [x] config/get.ts - add withStep, withSql
- [x] config/artist.ts - add withStep, withSql
- [x] config/movie.ts - add withStep, withSql
- [x] config/game.ts - add withStep, withSql
- [x] config/poke.ts - add withStep, withSql
- [x] config/isitreal.ts - add withStep
- [x] config/toggleapis.ts - add withStep

### Phase 7: Gate Commands (7 files) ✅
- [x] gate/gateMain.ts - add withStep, withSql
- [x] gate/accept.ts - add withStep, withSql
- [x] gate/reject.ts - add withStep, withSql
- [x] gate/kick.ts - add withStep
- [x] gate/unclaim.ts - add withStep, withSql
- [x] gate/index.ts - verify exports (re-exports only, no changes needed)
- [x] gate/shared.ts - add withStep, withSql exports

### Phase 8: Event Commands ✅
- [x] event/index.ts - verify routing
- [x] event/movie.ts - add withStep, withSql (7 handlers)
- [x] event/game.ts - add withStep, withSql (7 handlers)

### Phase 9: Complex Commands ✅
- [x] audit.ts - add withStep throughout (5 subcommands)
- [x] database.ts - verify withStep coverage (ctx.step pattern)
- [x] send.ts - add withStep
- [x] purge.ts - add withStep
- [x] update.ts - verify patterns (withStep throughout)
- [x] help/index.ts - verify patterns (ctx.step pattern)
- [x] backfill.ts - add withStep
- [x] resetdata.ts - add withStep, withSql
- [x] panic.ts - add withStep

### Phase 10: Remaining Commands ✅
- [x] poke.ts - verify withStep (already had proper withStep coverage)
- [x] redeemreward.ts - add withStep (4 phases: fetch_member, inspect_roles, get_artist, build_confirmation)
- [x] review/setNotifyConfig.ts - add withStep, withSql (auth_check, defer_reply, get_old_config, update_config, edit_reply, log_action)
- [x] review/getNotifyConfig.ts - add withStep, withSql (auth_check, defer_reply, get_config, build_embed, edit_reply, log_action)
- [x] review-set-listopen-output.ts - add withStep (get_old_config, update_config, log_action, reply)

---

## Testing

> Reference: [audit/00_EXEC_SUMMARY.md](audit/00_EXEC_SUMMARY.md) - Test Coverage: 2/10

**Current State:** 163 test files, 4314 tests total (4102 passing)

### Critical Test Coverage ✅
- [x] Permission helpers (`hasManageGuild`, `isReviewer`, `canRunAllCommands`) — `tests/lib/config.test.ts` (26 tests)
- [x] Rate limiter (`checkCooldown`, `clearCooldown`, `formatCooldown`) — `tests/lib/rateLimiter.test.ts` (16 tests)
- [x] `secureCompare` function — `tests/lib/secureCompare.test.ts` (16 tests)
- [x] Gate flow tests — `tests/gate/gateEntryPayload.test.ts`, `tests/commands/gate/gateMain.test.ts`

### Command Tests (Additional)
- [ ] `/health` - basic functionality
- [ ] `/flag` - add/remove flag flow
- [ ] `/search` - permission + rate limit (partial in `tests/commands/search.test.ts`)
- [ ] `/stats reset` - password validation (partial in `tests/commands/stats/reset.test.ts`)

---

## Documentation

### Update Changelog ✅
- [x] Add Command Architecture Unification section under `[Unreleased]`
- [x] Document all standardization changes
- [x] Document security fixes
- [x] Document dead code removal

### Developer Reference ✅
- [x] Create `docs/reference/command-patterns.md`
- [x] Link to template and checklist
- [x] Document common patterns and gotchas

### Deprecation ✅
- [x] Document `/movie` deprecation timeline (use `/event movie` instead)
  - Target removal: v5.0.0 (Q2 2026)
- [x] Add deprecation notice to `/movie` command response
  - Footer added to all embed responses: "⚠️ /movie is deprecated. Please use /event movie instead."

---

## Final Verification

### Pre-Deploy Checks
- [ ] Run `npm run check` (typecheck + lint + format + test)
- [ ] Fix any errors

### Manual Testing
- [ ] Test /stats (activity, leaderboard, user, export, reset)
- [ ] Test /config (view, set, get)
- [ ] Test /gate (claim, accept, reject, kick)
- [ ] Test /audit (security, members, nsfw)
- [ ] Test /help
- [ ] Test /flag and /search

### Error Card Verification
- [ ] Trigger an error intentionally
- [ ] Verify trace shows all withStep phases
- [ ] Verify SQL queries appear in trace

### Deploy
- [ ] Run `./deploy.sh --logs`
- [ ] Monitor for errors
- [ ] Verify production functionality

---

## Audit Reports Reference

| Report | Contents |
|--------|----------|
| [00_EXEC_SUMMARY.md](audit/00_EXEC_SUMMARY.md) | Executive overview, health scores, action plan |
| [01_COMMAND_INDEX.md](audit/01_COMMAND_INDEX.md) | All 37 commands, handlers, button/modal patterns |
| [02_DEAD_CODE_REPORT.md](audit/02_DEAD_CODE_REPORT.md) | 11 unused exports, deprecated code |
| [03_LOGGING_GAP_REPORT.md](audit/03_LOGGING_GAP_REPORT.md) | Missing audit trails, evt fields |
| [04_DEPLOYMENT_AUDIT.md](audit/04_DEPLOYMENT_AUDIT.md) | deploy.sh analysis, robustness improvements |
| [05_SECURITY_AND_ABUSE_SURFACE.md](audit/05_SECURITY_AND_ABUSE_SURFACE.md) | Permissions, rate limits, secrets |

### Per-Command Reports (37/37 complete)
See `audit/commands/` for detailed reports on all commands:
- Gate: accept, reject, kick, unclaim, gate
- Review: listopen, search, flag, sample
- Config: config, review-get-notify-config, review-set-notify-config, review-set-listopen-output
- Stats: stats, roles
- Events: event, movie (deprecated), poke
- Moderation: purge, send, panic, unblock, backfill, resetdata
- Art: art, artistqueue, redeemreward
- Utility: health, help, isitreal, audit, database, update, developer, skullmode, test, utility

---

## Recently Completed

### Art Job Cancellation Feature (2026-01-11)
- [x] Added "cancelled" status to `JOB_STATUSES` in `src/features/artJobs/types.ts`
- [x] Updated store queries to exclude cancelled jobs from active lists
- [x] Added `cancelJob()` function in `src/features/artJobs/store.ts`
- [x] Added `/art cancel` subcommand in `src/commands/art.ts` (staff only)
- [x] Updated test `tests/features/artJobs/index.test.ts` for new status
- [x] Deployed commands to Discord

### Additional Audit Fixes (2026-01-11)
- [x] `stats/approvalRate.ts` - Added withStep instrumentation
- [x] `stats/history.ts` - Added withStep/withSql for all DB operations, evt fields
- [x] `panic.ts` - Added withSql wrappers for DB operations
- [x] `roles.ts` - Removed unused `ensureDeferred` import

### Full Repo Audit (2026-01-11)
- [x] Created `audit/00_EXEC_SUMMARY.md` - Executive summary with health scores
- [x] Created `audit/01_COMMAND_INDEX.md` - All 37 commands indexed
- [x] Created `audit/02_DEAD_CODE_REPORT.md` - 11 unused exports identified
- [x] Created `audit/03_LOGGING_GAP_REPORT.md` - Logging consistency analysis
- [x] Created `audit/04_DEPLOYMENT_AUDIT.md` - deploy.sh robustness improvements
- [x] Created `audit/05_SECURITY_AND_ABUSE_SURFACE.md` - Security analysis
- [x] Created 37 per-command audit reports in `audit/commands/`

### Build Identity & Response State (2026-01-11)
- [x] Created `src/lib/buildInfo.ts` - Central build identity module
- [x] Created `scripts/inject-build-info.ts` - Build-time script for `.env.build`
- [x] Updated `src/lib/wideEvent.ts` - Added ResponseState interface and build identity fields
- [x] Updated `src/lib/wideEventEmitter.ts` - Logs build_* and resp_* prefixes
- [x] Updated `src/lib/cmdWrap.ts` - Tracks error card delivery via setErrorCardSent()
- [x] Updated `src/lib/errorCardV2.ts` - New "Build Identity" and "Response State" embed sections
- [x] Updated `src/lib/sentry.ts` - Release format: `pawtropolis-tech@4.9.2+abc1234`
- [x] Updated `deploy.sh` - Fixed step numbering (7 steps), added build metadata injection
- [x] Updated `src/commands/health.ts` - Displays build info (version, SHA, age, deploy ID, env)

---

## Progress Summary

| Category | Status | Priority |
|----------|--------|----------|
| Full Repo Audit | Complete | Done |
| Critical Fixes (P1) | 4/4 ✅ | Done |
| Dead Code Cleanup | 11/13 (2 N/A) ✅ | Done |
| Logging Gaps | 13/13 ✅ | Done |
| Security Fixes | 8/8 ✅ | Done |
| Command Unification | 10/10 phases ✅ | Done |
| Critical Tests | 4/4 ✅ | Done |
| Documentation | 2/3 sections ✅ | Ongoing |
| Build Identity | Complete | Done |

---

## Notes

- Commit after each logical change (not batched)
- Run `npm run check` frequently
- Test each command after refactoring
- Keep this TODO updated as work progresses
- Reference audit reports for detailed context
