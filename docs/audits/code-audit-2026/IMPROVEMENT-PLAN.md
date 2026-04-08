# Code Audit 2026 — Improvement Plan

Generated: 2026-03-05
Source: 8 audit rounds, 130+ files, 79 findings

## Pass Order

Improvements are grouped into passes that can be committed independently.
Each pass should run `npm run check` before committing.

---

## Pass 1: Dead Code Removal (est. 15 min)

Remove confirmed dead code. Safe because nothing references these.

| Finding | File | What to Remove |
|---------|------|----------------|
| F002 | `src/index.ts:1016` | Unused `role` in `for (const [roleId, role] of addedRoles)` |
| F029 | `src/features/gate.ts:1` | Stray `1;` prefix before JSDoc comment |
| F030 | `src/features/gate.ts:1367-1372` | Dead `gatekeeper_ping` step (vestigial) |
| F033 | `src/features/review/claims.ts:61-67` | `getReviewClaim` function + re-exports in review/index.ts and review.ts |
| F053 | `src/features/modmail/threadPerms.ts:411-419` | Dead `modmail_parent_channel_id` access block |
| F062 | `src/features/modPerformance.ts:436,453` | `getModeratorMetrics`, `getTopModerators` (never imported) |
| F062 | `src/features/artistRotation/queue.ts:464` | `getAssignmentHistory` (never imported) |
| F065 | `src/lib/buildInfo.ts:395,409` | `getShortBuildId`, `getBuildAge` (never imported) |

**Cross-ref check before removing:**
- `grep -r "getReviewClaim" src/ web/` — confirm no consumers (only barrel re-exports)
- `grep -r "getModeratorMetrics\|getTopModerators\|getAssignmentHistory" src/ web/` — confirm no consumers
- `grep -r "getShortBuildId\|getBuildAge" src/ web/` — confirm no consumers

---

## Pass 2: Type Safety Quick Fixes (est. 20 min)

Fix `as any` casts and loose typing where the fix is straightforward.

| Finding | File | Fix |
|---------|------|-----|
| F003 | `src/index.ts:1137` | Replace `(interaction as any).customId` with `'customId' in interaction ? interaction.customId : 'unknown'` |
| F007 | `src/db/db.ts:74-77` | Replace `(err as any)?.name` with `err instanceof Error ? err.name : String(err)` pattern |
| F035 | `src/features/review/flows/kick.ts:174` | Replace `(err as any)?.code` with `(err as { code?: number })?.code` |
| F042 | `src/commands/audit.ts:331` | Replace `catch (editErr: any)` with `catch (editErr: unknown)` + narrowing |
| F045 | `src/commands/listopen.ts:645,738` | Type handler params as `ButtonInteraction` and `StringSelectMenuInteraction` |
| F054 | `src/features/avatarScan.ts:79` | Remove `as any` from displayAvatarURL options (use ImageURLOptions type) |

**Cross-ref check:** F045 requires checking how index.ts passes interactions to these handlers.

---

## Pass 3: Shared Utility Extraction (est. 15 min)

Extract duplicated utilities into shared modules.

| Finding | File | Fix |
|---------|------|-----|
| F008 | `src/db/db.ts:177` + `src/db/ensure.ts:485` | Extract `SQL_IDENTIFIER_RE` to `src/db/utils.ts`, import in both |
| F043 | `src/commands/audit.ts:1682` + `src/features/welcome.ts:220` | Import `sleep` from `src/lib/retry.ts` (already has it) instead of local copies |

---

## Pass 4: Logging & Error Handling Fixes (est. 10 min)

| Finding | File | Fix |
|---------|------|-----|
| F010 | `src/db/db.ts:246` | Add `logger.debug({ err }, "...")` to bare `catch {}` |
| F023 | `src/features/gate.ts:1355` | Remove misleading "fire-and-forget" comment (line 1356 GOTCHA is correct) |
| F034 | `src/features/review/queries.ts:121` | Change `logger.info` to `logger.debug` for routine query timing |
| F047 | `src/commands/audit.ts:899` | Replace `guild.members.fetch()` with `guild.memberCount` for confirmation count |
| F051 | `src/commands/database.ts:300` | Change `StrictHostKeyChecking=no` to `StrictHostKeyChecking=accept-new` |
| F067 | `src/store/flagsStore.ts:47` | Change `SELECT *` to `SELECT 1` in existence check |

---

## Pass 5: Config Column Allowlist Sync (est. 10 min)

| Finding | File | Fix |
|---------|------|-----|
| F016 | `src/lib/config.ts:608-629` | Add `nsfw_alert_role_id` to ALLOWED_CONFIG_COLUMNS. Audit full GuildConfig type (lines 83-175) against the Set to find any other missing columns. |

**Cross-ref check:** Compare every field in `GuildConfig` type against `ALLOWED_CONFIG_COLUMNS`. Any mismatch means upserts silently drop that column.

---

## Pass 6: Hardcoded Guild ID (est. 5 min)

| Finding | File | Fix |
|---------|------|-----|
| F001 | `src/index.ts:838` | Replace `const ALLOWED_GUILD = "896070888594759740"` with `env.GUILD_ID` |

**Cross-ref check:** Verify `env.GUILD_ID` is always set (it is — required by `env.ts` schema).
Wait — `env.ts` says GUILD_ID is `z.string().optional()`. So this would need a fallback or making GUILD_ID required. Investigate before fixing.

---

## Pass 7: Web Dashboard Session Security (est. 30 min)

| Finding | File | Fix |
|---------|------|-----|
| F072 | `web/src/lib/server/session.ts` | Encrypt cookie value using `crypto.createCipheriv` with a server secret, or use server-side session storage |
| F075 | Multiple web server files | Add env validation at web startup for GUILD_ID, OAUTH2_REDIRECT_URI |
| F079 | `web/src/lib/server/events/fan-out.ts` | Add MAX_CLIENTS check in addClient() |

---

## Pass 8: Documentation Cleanup (est. 10 min)

| Finding | File | Fix |
|---------|------|-----|
| F011 | `src/db/ensure.ts:508-515,630-636` | Move orphaned JSDoc blocks to directly above their functions |
| F012 | `src/db/ensure.ts:278` | Type `runReviewActionMigration` param as `Database` instead of `any` |
| F050 | `audit/02_DEAD_CODE_REPORT.md` | Update report: mark removed items as resolved, update counts |

---

## Deferred (Large Scope)

These are valuable but require more than a quick fix session.

| Finding | Scope | Description |
|---------|-------|-------------|
| F032 | ~2 hours | Refactor 4 action runners into shared pipeline (650 -> 200 lines) |
| F018 | ~30 min | Extract shared ensureGuildConfigColumns helper (7 functions -> 1) |
| F024 | ~30 min | Extract shared resolveApplication for gate commands |
| F041 | ~1.5 hours | Split audit.ts (1684 lines) into subcommand modules |
| F052 | ~1 hour | Refactor modmail open to accept params interface instead of interaction |
| F036/F076 | ~days | Test coverage for review system and web dashboard |

---

## Pre-Improvement Checklist

Before starting any pass:
1. `git stash` any uncommitted changes
2. `npm run check` — verify clean baseline
3. Read the specific round report for cross-reference warnings
4. After each pass: `npm run check` again, then commit

After all passes:
1. Run full test suite: `npm test`
2. Deploy with tests: `./deploy.sh`
3. Monitor PM2 logs for 10 minutes after deploy

---

## See Also

- [Code Audit 2026 (parent)](../CODE-AUDIT-2026.md) — full audit summary and findings rollup
- [Improvement Prompt](IMPROVEMENT-PROMPT.md) — copy-paste session prompt for executing this plan
- Round reports: [1](round-1-foundation.md) · [2](round-2-gate-system.md) · [3](round-3-review-system.md) · [4](round-4-large-commands.md) · [5](round-5-feature-modules.md) · [6](round-6-shared-utilities.md) · [7](round-7-stores-schedulers-config.md) · [8](round-8-web-dashboard.md)
