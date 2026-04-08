# Administrator Guide

You configure bot settings, manage role automation, and handle emergencies.

**Prerequisite:** [Moderator Guide](MODERATOR-GUIDE.md) | **Other docs:** [Quick Reference](../MOD-QUICKREF.md) - [Bot Handbook](BOT-HANDBOOK.md)

> **Server Reference:** For complete role/channel/permission data, see [internal-info/](internal-info/) docs.

---

## Everything You Had Before

You still have all Moderator capabilities:
- Gate system (accept, reject, kick, claim, listopen, search)
- Flagging users and AI detection
- Event management (movie & game nights)
- Activity heatmaps
- Bot presence updates
- Skull mode

[Review Moderator Guide](MODERATOR-GUIDE.md)

---

## What's New at This Level

### Server Configuration

You control how the bot behaves across your server.

**Command:**
- `/config set <setting> <value>` — Change a bot setting
- `/config get <setting>` — Check a specific setting's status
- `/config view` — See all current settings at once

**Key settings you can configure:**

| Setting | What it controls |
|---------|------------------|
| `logging_channel` | Where bot actions get logged |
| `flags_channel` | Where Silent-Since-Join alerts go |
| `flags_threshold` | How many days before flagging silent members |
| `dadmode` | The "Hi hungry, I'm Dad!" joke feature |
| `skullmode` | Random skull emoji reactions |
| `pingdevonapp` | Ping Bot Dev on new applications |
| `mod_roles` | Roles that can run all bot commands |
| `gatekeeper` | Role for gatekeeper features |
| `modmail_log_channel` | Where modmail logs go |
| `review_roles` | How roles appear on review cards |
| `qotd_review_channel_id` | Channel where QOTD suggestions are posted for staff review |

[Full documentation](BOT-HANDBOOK.md#config)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Skull mode added in [v4.8.0](../CHANGELOG.md#480---2025-12-08)*

---

### Role Automation Setup

Configure automatic role assignments based on Amaribot levels and event attendance.

**Commands:**
- `/roles add-level-tier level:N role:@Role` — Connect an Amaribot level to a role
- `/roles add-level-reward level:N role:@Role` — Give a one-time token role at a level
- `/roles add-movie-tier tier_name:Name role:@Role movies_required:N` — Set up movie attendance tiers
- `/roles add-game-tier tier_name:Name role:@Role games_required:N` — Set up game attendance tiers
- `/roles list type:...` — See all configured mappings
- `/roles remove-level-tier level:N` — Delete a level tier
- `/roles remove-level-reward level:N` — Delete a level reward
- `/roles remove-movie-tier tier_name:Name` — Delete a movie tier
- `/roles remove-game-tier tier_name:Name` — Delete a game tier

**Level Tiers vs Level Rewards:**
- **Level Tiers** are the roles Amaribot assigns (like "Engaged Fur LVL 15")
- **Level Rewards** are bonus roles you give at milestones (like "Event Ticket")

[Full documentation](BOT-HANDBOOK.md#roles)

*Introduced in [v1.1.0](../CHANGELOG.md#110---2025-11-25)*

---

### Emergency Controls

If role automation starts misbehaving, you can halt it immediately.

**Commands:**
- `/panic on` — Stop all automatic role grants
- `/panic off` — Resume normal operation
- `/panic status` — Check if panic mode is currently on

**When to use panic mode:**
- Roles going to wrong people
- Duplicate roles being added
- Any unexpected role behavior
- Before making configuration changes, as a precaution

Panic mode survives bot restarts. It stays on until you explicitly turn it off.

[Full documentation](BOT-HANDBOOK.md#panic)

*Introduced in [v1.1.1](../CHANGELOG.md#111---2025-11-25)*

---

### Advanced Statistics

Export and manage moderator statistics for performance reviews.

**Commands:**
- `/stats export days:N` — Download stats as CSV for spreadsheet analysis
- `/stats reset password:...` — Reset all metrics to zero (requires password confirmation)

**Export includes:**
- Every action (accepts, rejects, kicks)
- Timestamps and response times
- Reasons given for rejections
- Application IDs for reference

**When to reset:**
- New moderation team
- Significant policy changes
- Testing cleanup before going live
- Fresh start for a new season

[Full documentation](BOT-HANDBOOK.md#modstats)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Review System Configuration

Configure how the review system notifies staff about new applications.

**Commands:**
- `/review-set-notify-config` — Set up notifications for new forum posts
  - `mode`: post (reply in thread) or channel (send to separate channel)
  - `role`: Which role to ping
  - `forum`: Which forum to watch
  - `cooldown`: Seconds between notifications
  - `max_per_hour`: Cap on notifications per hour
- `/review-get-notify-config` — View current notification settings
- `/review-set-listopen-output mode:...` — Control if `/listopen` is public or ephemeral

[Full documentation](BOT-HANDBOOK.md#review-set-notify-config)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

## Tips for This Level

1. **Test config changes carefully** — One wrong setting can break the workflow for your whole team
2. **Document your role mappings** — Keep notes on why each level tier and reward exists
3. **Use panic mode proactively** — Turn it on before making changes, not after things break
4. **Review exports regularly** — Monthly stats reviews help catch burnout early
5. **Check `/config view` periodically** — Make sure settings haven't drifted

---

## What's Coming Next

When you advance to **Leadership** (Community Manager and above), you'll unlock:

- **Server Audits** — `/audit members` and `/audit nsfw` to scan for bots and inappropriate content
- **Data Management** — `/backfill` to rebuild activity data, `/resetdata` for metrics
- **Bot Branding** — `/update banner` and `/update avatar` to customize the bot
- **Artist Rotation** — Full queue management with `/artistqueue`
- **Moderation History** — `/stats history` for detailed performance reviews

[LEADERSHIP-GUIDE.md](LEADERSHIP-GUIDE.md)

---

## See Also

**Previous:** [Moderator Guide](MODERATOR-GUIDE.md) | **Next:** [Leadership Guide](LEADERSHIP-GUIDE.md)

**Reference:** [Bot Handbook](BOT-HANDBOOK.md) - [Staff Policies](MOD-HANDBOOK.md) - [Permissions](PERMS-MATRIX.md)
