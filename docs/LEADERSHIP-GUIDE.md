# Leadership Guide

![@Community Manager](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/role-community-manager.svg?v=5) ![@Community Development Lead](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/role-community-dev-lead.svg?v=5) ![@Community Founder](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/role-community-founder.svg?v=5)

Server-wide audits, data resets, branding, analytics, and the bot-owner-only controls.

**Prerequisite:** [Admin Guide](ADMIN-GUIDE.md) | **Other docs:** [Quick Reference](MOD-QUICKREF.md) | [Bot Handbook](BOT-HANDBOOK.md)

---

## Carried Over from Admin

You keep all Administrator capabilities:
- Gate system and all review commands
- Full server configuration (`/config`)
- Role automation setup (`/roles`)
- Emergency controls (`/panic`)
- Stats export and management
- Event management and activity tools

See [Admin Guide](ADMIN-GUIDE.md) for details.

---

## Leadership-Only Commands

### Server Audits

Sweep the whole member list for bot accounts and for avatars that violate the server's content rules.

**Commands:**
- `/audit members`: Scan all members for bot accounts using detection heuristics
- `/audit nsfw scope:...`: Scan avatars for NSFW content using Google Vision API

**Member Audit Detection Scoring:**

| Check | Points | What it looks for |
|-------|--------|-------------------|
| No avatar | 2 | Default Discord profile picture |
| New account | 3 | Account less than 7 days old |
| No activity | 2 | No messages recorded |
| Low level | 1 | No Level 5+ Amaribot role |
| Bot username | 2 | Patterns like `user_1234` |

Accounts scoring 4+ points get flagged automatically.

**NSFW Audit Scopes:**
- `All members`: Scan everyone (uses more API calls)
- `Flagged members only`: Only scan members flagged by `/audit members`

**Tip:** Run `/audit members` first, then `/audit nsfw scope:Flagged members only` to save API costs.

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#audit)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Members/NSFW split in [v4.4.0](../CHANGELOG.md#440---2025-12-03)*

---

### Data Management

Rebuild activity data and manage server metrics.

**Commands:**
- `/backfill weeks:N`: Rebuild activity data by scanning message history
  - Use after first enabling activity tracking
  - Use if heatmap data seems incomplete
  - `dry-run:true` previews without saving
- `/resetdata password:...`: Reset all moderator metrics (nuclear option)
  - Preserves action log history
  - Only resets calculated stats and leaderboards

**When to use backfill:**
- First time setup (want historical data)
- Data looks wrong on heatmap
- After bot downtime
- After gaining access to new channels

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#backfill)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Backfill cooldown added in [v4.5.0](../CHANGELOG.md#450---2025-12-02)*

---

### Bot Branding

Update the bot's profile picture and the banners shown to applicants and new members.

**Commands:**
- `/update banner image:<attachment>`: Update profile, gate, and welcome banners
- `/update avatar image:<attachment>`: Change the bot's profile picture

**Banner updates affect:**
1. Bot's Discord profile banner
2. Gate message banner (for new applicants)
3. Welcome message banner (for new members)
4. Saved PNG/WebP versions in assets folder

**Avatar processing:**
- GIF files preserve animation
- Other formats are cropped to square, resized to 1024x1024

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#update)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Artist Rotation

Manage the rotation that hands out art commissions to Server Artists.

**Commands:**
- `/artistqueue list`: See current queue order and who's skipped
- `/artistqueue sync`: Update queue to match who has the Server Artist role
- `/artistqueue move user:@Artist position:N`: Put an artist at a specific position
- `/artistqueue skip user:@Artist reason:...`: Temporarily take artist out of rotation
- `/artistqueue unskip user:@Artist`: Put them back in rotation
- `/artistqueue history limit:N`: See past art reward assignments
- `/artistqueue setup`: First-time setup

**Redemption:**
- `/redeemreward user:@Winner type:headshot`: Assign next artist in queue
- `/redeemreward user:@Winner type:fullbody artist:@Artist`: Override with specific artist

**Art types:** headshot, halfbody, fullbody, emoji

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#artistqueue)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Sync cooldown added in [Unreleased](../CHANGELOG.md#unreleased)*

---

### Art Job Management

Track artwork from assignment to completion.

**Staff Commands:**
- `/art all`: View all active jobs server-wide
- `/art assign artist:@Artist scope:user recipient:@Client type:headshot`: Manual job assignment
- `/art assign artist:@Artist scope:special description:"Create server banner"`: Special task

**Job Statuses:** Assigned > Sketching > Lining > Coloring > Done

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#art)

*Introduced in [v4.0.0](../CHANGELOG.md#400---2025-12-01)*

---

### Moderation History

Look up what a specific moderator has been doing.

**Commands:**
- `/stats history moderator:@ModName days:N`: See everything a mod has done
- `/stats history moderator:@ModName export:true`: Download as CSV

**You'll see:**
- Every accept, reject, and kick they've made
- Timestamps and response times
- Reasons given for rejections
- Anomaly scores (flags unusual patterns)
- Reject rate percentage
- Response time percentiles (p50 and p95)

**CSV export includes:** Action type, timestamp, user ID, reason, response time, application ID. Links expire after 24 hours.

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#modhistory)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Visual Analytics

Charts and CSV exports of server activity over time.

**Commands:**
- `/stats approval-rate`: View server-wide approval/rejection rate analytics
- `/stats approval-rate days:N`: Analyze a specific time period
- `/stats leaderboard`: Ranked moderator performance
- `/stats leaderboard export:true`: Download as CSV

**What the charts cover:**
- Application volume trends
- Accept vs reject vs kick distribution
- Busiest days and times
- Whether activity is going up or down

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#analytics)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

## Tips

1. Run `/audit members` once a month: bot accounts accumulate over time and this is the cheapest way to catch them.
2. After a member audit, run `/audit nsfw scope:Flagged members only`. The full scope hits the Vision API for every member and that gets expensive.
3. Skim `/stats history` for each mod once a month. You're looking for burnout (response times creeping up) and for outliers (reject rates that don't match the rest of the team).
4. Don't trust activity heatmaps you haven't backfilled. If the bot was offline for a while, run `/backfill` first.
5. Keep the original PNG/WebP files when you change banners or the avatar: you'll want them if you need to revert.
6. Check `/artistqueue history` periodically. If one artist is getting picked far more than the others, the rotation is broken.

---

## Bot Owner Commands

These commands are restricted to Bot Owner and Server Dev only:

**Database Management:**
- `/database check`: Run integrity checks and show database health stats
- `/database recover`: Interactive assistant for recovering from database corruption

**Multi-Channel Communication:**
- `/poke user:@Username`: Ping someone across every channel in a category

Full docs: [BOT-HANDBOOK](BOT-HANDBOOK.md#database)

*Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

## See Also

**Previous:** [Admin Guide](ADMIN-GUIDE.md) | [Moderator Guide](MODERATOR-GUIDE.md) | [Gatekeeper Guide](GATEKEEPER-GUIDE.md)

**Reference:** [Bot Handbook](BOT-HANDBOOK.md) | [Staff Policies](MOD-HANDBOOK.md) | [Permissions](PERMS-MATRIX.md)
