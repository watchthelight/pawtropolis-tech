# Pawtech Quick Reference

> For full documentation, see [BOT-HANDBOOK.md](BOT-HANDBOOK.md) and [MOD-HANDBOOK.md](MOD-HANDBOOK.md)

---

## Reviewing Applications

When a new application comes in, click the **Claim** button first so other mods know you're handling it. Then use the **Accept**, **Reject**, or **Kick** buttons to take action.

If an application is bugged and you can't use the buttons, use these commands instead:

- `/accept`: approve the application
- `/reject reason:Your reason here`: reject with explanation
- `/kick reason:Your reason here`: kick from server
- `/unclaim`: release so someone else can review it

Each command accepts one of these to identify the application:
- `app:A1B2C3`: the short code shown on the embed
- `user:@Username`: mention or pick from the list
- `uid:123456789`: their Discord ID if they already left

For rejections, add `perm:true` if they should never be allowed to re-apply.

To see what's waiting for review, run `/listopen`. Use `scope:all` to see everything or `scope:drafts` for incomplete applications.

Need to look up someone's history? `/search user:@Username` pulls up all their past applications and decisions.

Made a mistake with a permanent rejection? `/unblock target:@Username` lets them apply again.

## Checking Your Stats

Run `/stats user moderator:@YourName` to see your approval rate, response times, and activity breakdown. You can adjust the time range with `days:30` or whatever period you want.

`/stats leaderboard` shows rankings by review count, so you can see who's been most active.

For server-wide numbers, `/stats approval-rate` shows the overall approve vs reject breakdown.

## Server Activity

`/stats activity` shows a heatmap of message activity by day and hour. You can look back up to 8 weeks with `weeks:8`.

`/health` shows bot uptime and response latency.

## Events (Movie & Game Night)

**Movie Night:** Use `/movie start channel:#movie-vc` to begin tracking. When done, `/movie end` finalizes attendance and assigns tier roles to anyone who stayed 30+ minutes.

**Game Night:** Use `/event game start channel:#game-vc` to begin tracking. When done, `/event game end` calculates qualification based on percentage of event attended (default 50%).

Check attendance with `/movie attendance` or `/event game attendance`. Add `user:@Username` to look up someone's progress.

**Movie Tier Roles** (30+ min per event):
- ![@Red Carpet Guest - 1+ movies](https://status.pawtropolis.tech/badges/movie-tier-1.svg)
- ![@Popcorn Club - 5+ movies](https://status.pawtropolis.tech/badges/movie-tier-2.svg)
- ![@Director's Cut - 10+ movies](https://status.pawtropolis.tech/badges/movie-tier-3.svg)
- ![@Cinematic Royalty - 20+ movies](https://status.pawtropolis.tech/badges/movie-tier-4.svg)

**Game Tier Roles** (50%+ of event duration):
Configured via `/roles add-game-tier`. Use `/roles list type:game_night` to see current tiers.

## Utility Commands

To post something as the bot, use `/send message:Your text here`. Add `embed:true` for a nicer format, or `reply_to:` with a message ID to reply to something specific.

If someone seems suspicious, `/flag user:@Username reason:Alt account` flags them for other staff to see.

## Audit & Detection Tools

Check if an image is AI-generated:
- `/isitreal message:<message_id_or_link>`: scans all images in a message

Flag suspicious users:
- `/flag user:@Username reason:Alt account`: marks user for extra review

Server audits (leadership only):
- `/audit members`: scan for bot accounts
- `/audit nsfw`: scan avatars for NSFW content

## Tips

- Only use ONE identifier per command (app code, user mention, OR user ID: not multiple)
- Always claim before reviewing to avoid stepping on someone else's work
- The `perm:true` option is permanent: use it sparingly
- User left the server? Their Discord ID still works with the `uid:` option

---

## See Also

**Main docs:** [Bot Handbook](BOT-HANDBOOK.md) | [Staff Policies](MOD-HANDBOOK.md) | [Permissions](PERMS-MATRIX.md)

**By role:** [Gatekeeper](GATEKEEPER-GUIDE.md) | [Moderator](MODERATOR-GUIDE.md) | [Admin](ADMIN-GUIDE.md) | [Leadership](LEADERSHIP-GUIDE.md)
