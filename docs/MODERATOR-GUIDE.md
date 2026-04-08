# Moderator Guide

You run server events and have more tools to keep things healthy.

**Prerequisite:** [Gatekeeper Guide](GATEKEEPER-GUIDE.md) | **Other docs:** [Quick Reference](../MOD-QUICKREF.md) &#8226; [Bot Handbook](BOT-HANDBOOK.md)

---

## Everything You Had Before

You still have all Gatekeeper capabilities:
- Gate system (accept, reject, kick, claim, listopen, search)
- Flagging users
- AI detection (`/isitreal`)
- Viewing stats

📖 [Review Gatekeeper Guide →](GATEKEEPER-GUIDE.md)

---

## What's New at This Level

### Events (Movie & Game Night)

Run events and track who attends. Both movie nights and game nights are supported.

**Movie Night Commands:**
- `/movie start channel:#movie-vc` — Begin tracking attendance
- `/movie end` — Stop tracking and finalize attendance
- `/movie attendance [user:@Name]` — Check attendance history

**Game Night Commands:**
- `/event game start channel:#game-vc` — Begin tracking attendance
- `/event game end` — Stop tracking and calculate qualification
- `/event game attendance [user:@Name]` — Check attendance history

**How it works:**
1. Start tracking when the event begins
2. Bot monitors who's in the voice channel and for how long
3. End tracking when event is over
4. Roles are assigned based on qualification

**Movie Night Tiers** (require 30+ min per event):
- 1+ movies — First tier
- 5+ movies — Second tier
- 10+ movies — Third tier
- 20+ movies — Top tier

**Game Night Tiers** (require 50%+ of event duration):
- 1+ games — First tier
- 5+ games — Second tier
- 10+ games — Third tier
- 20+ games — Top tier

📖 [Full documentation →](BOT-HANDBOOK.md#events)

📋 *Introduced in [v1.1.0](../CHANGELOG.md#110---2025-11-25)*

---

### Server Activity Heatmap

See when the server is busiest.

**Command:**
- `/stats activity [weeks:N]` — Show activity heatmap (default: 4 weeks, max: 8)

The heatmap shows message activity by day and hour. Useful for:
- Planning events at peak times
- Understanding quiet periods
- Spotting unusual activity patterns

📖 [Full documentation →](BOT-HANDBOOK.md#activity)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Bot Presence

Update what the bot is doing/playing.

**Commands:**
- `/update activity type:... text:...` — Set the bot's activity
- `/update status [text:...]` — Set custom status (or clear it with no text)

**Activity types:**
- `Playing` — "Playing [text]"
- `Watching` — "Watching [text]"
- `Listening` — "Listening to [text]"
- `Competing` — "Competing in [text]"

📖 [Full documentation →](BOT-HANDBOOK.md#update)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Status clear added in [v4.8.0](../CHANGELOG.md#480---2025-12-08)*

---

### Skull Mode

Randomly reacts to messages with skull emoji, just for fun.

**Commands:**
- `/skullmode chance:N` — Set odds (1-1000) for skull reactions
- `/config set skullmode enabled:true/false` — Toggle on/off

Lower numbers = more skulls. Set to 1000 for rare skulls, 1 for constant skulls.

📖 [Full documentation →](BOT-HANDBOOK.md#skull-mode)

📋 *Introduced in [v4.8.0](../CHANGELOG.md#480---2025-12-08)*

---

## Tips for This Level

1. **Event timing matters** — Start tracking when the event begins, end when it finishes
2. **Check activity before events** — Use `/stats activity` to pick good times
3. **Bot status is visible to everyone** — Keep it appropriate
4. **Skull mode is opt-in** — Make sure leadership wants it enabled before turning it on

---

## What's Coming Next

When you advance to **Administrator**, you'll unlock:

- **Server Configuration** — Change bot settings with `/config`
- **Role Automation** — Set up automatic role assignment
- **Emergency Controls** — `/panic` to stop all automation instantly
- **Advanced Stats** — Export and reset moderator statistics

📖 [ADMIN-GUIDE.md →](ADMIN-GUIDE.md)

---

## See Also

**Previous:** [Gatekeeper Guide](GATEKEEPER-GUIDE.md) | **Next:** [Admin Guide](ADMIN-GUIDE.md)

**Reference:** [Bot Handbook](BOT-HANDBOOK.md) &#8226; [Staff Policies](MOD-HANDBOOK.md) &#8226; [Permissions](../PERMS-MATRIX.md)
