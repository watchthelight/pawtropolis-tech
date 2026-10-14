# Gatekeeper Guide

![@Gatekeeper](https://raw.githubusercontent.com/watchthelight/pawtropolis-tech/main/docs/badges/svg/role-gatekeeper.svg?v=10e9a595)

You review applications and decide who gets into the server.

**Other docs:** [Quick Reference](MOD-QUICKREF.md) &#8226; [Bot Handbook](BOT-HANDBOOK.md) &#8226; [Staff Policies](MOD-HANDBOOK.md)

---

## What You Can Do

### The Gate System

When someone wants to join the server, they fill out an application. You review it and decide whether to accept, reject, or kick.

**How it works:**
1. A new member clicks the Verify button in 「❓」verify
2. They answer the questions the bot asks them
3. The application lands in the staff channel as a review card for the Gatekeeper team
4. A Gatekeeper claims it (so others know it's being handled) and reviews it
5. The Gatekeeper makes the call: Accept, Reject, Kick, or question them through Modmail
6. The bot handles the rest (roles, DMs, welcome messages)

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

## Rules for Application Review

### Age Ranges Are Not Okay

We don't accept age ranges, for safety reasons. If a minor answers the age question with something like `16-18`, we have no way of knowing when they turn 18. That matters a lot when a report comes in about that user: their age is part of the context we moderate with.

The only exception is a range that is entirely 18 or over. Whatever the range, they're an adult, unless they're lying about their age (which is its own moderation issue).

You will also see ranges like `12-15`, which are not okay under Discord ToS, and joke ranges like `18-99`. Have them narrow it down to one age. Some people troll this question, and it's our job to rule that out.

### Verify Their Profile

Checking the applicant's profile is one of the easiest and most effective ways to tell whether someone needs moderation. Look at all of it:

- Profile picture
- Banner
- Bio
- Status
- Server Tag

Statuses and Server Tags are the two people miss most. Check them anyway: they have to follow our rules too. Server profiles are fine as long as they follow Discord's ToS.

**AI content:** No AI-generated content on accounts, including profile pictures and banners. They have to change it before they can be approved. `/isitreal` (see AI Detection above) helps when you're unsure.

**NSFW or suggestive content:** No adult content anywhere on the profile. This is the most common problem, and it often hides in the status or Server Tag.

### Response Time

Applications should be reviewed within **6 hours** of submission. The applications channel can get clogged fast, so use the dashboard's Reviews page or `/listopen` to find applications that slipped past.

If someone has claimed an application but hasn't acted on it, ping that Gatekeeper.

### Communicate With Your Team

This is the big one. If you have a question or you aren't sure about an application, ask your team. Asking for help doesn't make you any less of a Gatekeeper, and it's encouraged.

---

## Common Mistakes to Avoid

1. Forgetting to claim. Always claim first: otherwise two people end up reviewing the same application.
2. Mixing identifiers. Pick one of `app:`, `user:`, or `uid:` per command and stick with it.
3. Treating `perm:true` like a regular reject. It's permanent and irreversible without `/unblock`. Save it for spam, bots, and clear rule violations.
4. Skipping the password check. Most "rejects" are people who guessed the password wrong: they can just try again.
5. Accepting an age range. Ask for a single age unless the whole range is 18 or over.
6. Only checking the avatar. Status and Server Tag need the same look as the picture, banner, and bio.
7. Letting a claim sit. Applications are due within 6 hours: act on it or `/unclaim`.

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
