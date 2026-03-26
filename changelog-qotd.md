# QOTD Suggestion System

New feature. Requested by Entropy.

## New Commands
- **`/qotd suggest`** - Opens a modal for members to submit a QOTD question (10-500 chars). Rate limited to 1/hour, max 5 pending per user.
- **`/qotd pull`** - Staff only. Pulls a random approved suggestion ephemerally. Marks it as used so it won't come up again.
- **`/qotd queue`** - Staff only. Shows count of approved + pending suggestions.

## Review Flow
Suggestions post as embed cards to <#1486268526585974875> with **Approve** / **Reject** buttons. Rejection opens a modal for a reason. Both actions DM the suggester with the result. Cards update in-place with status + who reviewed.

## Backend
- New `qotd_suggestion` table: `id`, `guild_id`, `user_id`, `question`, `status` (pending/approved/rejected/used), `short_code`, review metadata, timestamps
- `guild_config.qotd_review_channel_id` column added
- Button routing: `qotd:(approve|reject):code<HEX6>` via `BTN_QOTD_RE` in modalPatterns
- Modal routing: `v1:modal:qotd:suggest` and `v1:modal:qotd:reject:<HEX6>` added to `identifyModalRoute()`
- Feature module at `src/features/qotd/` (types, db, card, handlers)
- Lazy-init prepared statements, shortCode-based button IDs, staff checks via `hasRole(member, ROLE_IDS.GATEKEEPER)`

No auto-posting, no scheduler. Staff pulls questions and posts QOTD manually. Bot is purely a suggestion pool.

---

# Level Reward Dedup Fix (INC-005)

Third attempt. This one uses schema-level enforcement.

## Problem
Previous fixes wrote dedup markers to `role_assignments`, but **150+ user/level combos from pre-fix grants had no markers**. When Amaribot re-synced level roles for those users, the bot found no prior record and re-granted rewards + DMs.

## Fix
- New `level_reward_granted` table with `UNIQUE(guild_id, user_id, level)` constraint
- Dedup check replaced with single `INSERT OR IGNORE` - if `changes === 0`, the row already existed, skip. If `changes === 1`, first-time grant, proceed.
- Migration 057 backfills from all existing `role_assignments` entries so every historical grant is covered
- No TOCTOU race possible. The UNIQUE constraint is enforced by SQLite at the engine level. Previous approach (SELECT then INSERT) could theoretically interleave between check and write.

## Files Changed
- `migrations/057_level_reward_dedup.ts` - new table + backfill
- `src/features/levelRewards.ts` - replaced SELECT+INSERT dedup with `INSERT OR IGNORE`
