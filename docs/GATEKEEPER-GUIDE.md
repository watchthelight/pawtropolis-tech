# Gatekeeper Guide

![@Gatekeeper](https://cdn.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/role-gatekeeper.svg?v=5)

You review applications and decide who gets into the server.

**Other docs:** [Quick Reference](MOD-QUICKREF.md) &#8226; [Bot Handbook](BOT-HANDBOOK.md) &#8226; [Staff Policies](MOD-HANDBOOK.md)

---

## What You Can Do

### The Gate System

When someone wants to join the server, they fill out an application. You review it and decide whether to accept, reject, or kick.

**How it works:**
1. Someone clicks Verify in the gate channel
2. A review card appears in your staff channel
3. You claim it (so others know you're handling it)
4. You make the call: Accept, Reject, or Kick
5. The bot handles the rest (roles, DMs, welcome messages)

**Commands:**
- `/accept`: Approve an application (they get the member role)
- `/reject reason:... [perm:true]`: Deny with explanation (optionally permanent)
- `/kick reason:...`: Remove without formal rejection (can reapply)
- `/unclaim`: Release a claimed application for someone else
- `/listopen`: See pending applications (`scope:all` for everything)
- `/search user:@Name`: Look up someone's application history

**Identifying applications:** Use ONE of these with any command:
- `app:A1B2C3`: The short code on the review card
- `user:@Username`: Mention or pick from list
- `uid:123456789`: Discord ID (for users who left)

📖 [Full documentation →](BOT-HANDBOOK.md#gate-system-application-review)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Working with Claims

**Always claim before reviewing.** This prevents two mods from working on the same application.

- Click "Claim Application" on the review card
- The card updates to show you've claimed it
- Other mods see "Claimed by @YourName"
- Take your action (accept/reject/kick)
- If you need to step away, use `/unclaim` to release it

**Pro tip:** If buttons aren't working, use the slash commands instead. They do the same thing.

📖 [Full documentation →](BOT-HANDBOOK.md#what-the-claim-system-does)

---

### Flagging Suspicious Users

If something looks off about a user, flag them so other staff can see it.

**Command:**
- `/flag user:@Username reason:Why they're suspicious`

Flagged users get a warning indicator on their review card. Good reasons to flag:
- Possible alt account of banned user
- Suspicious join pattern
- Failed password multiple times
- Username matches known problem users

📖 [Full documentation →](BOT-HANDBOOK.md#flag)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Updated in [v4.8.0](../CHANGELOG.md#unreleased) (15s cooldown)*

---

### AI Detection

You can scan submitted art to check whether it's AI-generated.

**Command:**
- `/isitreal message:<message_id_or_link>`: Scans images for AI generation

**Quick method:** Right-click any message → Apps → "Is It Real?"

The bot uses multiple detection services and shows confidence scores. Not perfect, but helps catch obvious AI art.

📖 [Full documentation →](BOT-HANDBOOK.md#isitreal)

📋 *Introduced in [v4.6.0](../CHANGELOG.md#460---2025-12-03)* | *Context menu added in [v4.8.0](../CHANGELOG.md#480---2025-12-08)*

---

### Checking Your Stats

The bot tracks your review activity.

**Commands:**
- `/stats user moderator:@YourName`: Your personal stats
- `/stats leaderboard`: See how everyone's doing

Stats include:
- Total reviews (accepts, rejects, kicks)
- Average response time
- Activity breakdown by day

📖 [Full documentation →](BOT-HANDBOOK.md#modstats)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Getting Help

**Commands:**
- `/help`: Interactive help browser (search or browse by category)
- `/health`: Check if the bot is running properly

**If something's broken**, check the [Troubleshooting section](BOT-HANDBOOK.md#troubleshooting) in the handbook.

**If that doesn't help**, ask in staff chat. Include:
- What you were trying to do
- What happened instead
- The application code (like `A1B2C3`) if relevant

📖 [Full documentation →](BOT-HANDBOOK.md#help)

---

## Common Mistakes to Avoid

1. Forgetting to claim. Always claim first: otherwise two people end up reviewing the same application.
2. Mixing identifiers. Pick one of `app:`, `user:`, or `uid:` per command and stick with it.
3. Treating `perm:true` like a regular reject. It's permanent and irreversible without `/unblock`. Save it for spam, bots, and clear rule violations.
4. Skipping the password check. Most "rejects" are people who guessed the password wrong: they can just try again.

---

## What Moderator Adds

Moderators also have:

- Movie and game night attendance tracking
- The server activity heatmap
- Bot presence/status controls
- Skull mode

See the [Moderator Guide](MODERATOR-GUIDE.md) for details.

---

## See Also

**Next:** [Moderator Guide](MODERATOR-GUIDE.md)

**Reference:** [Bot Handbook](BOT-HANDBOOK.md) &#8226; [Staff Policies](MOD-HANDBOOK.md) &#8226; [Permissions](PERMS-MATRIX.md)
