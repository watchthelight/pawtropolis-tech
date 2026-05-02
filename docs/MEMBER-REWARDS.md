# Member Rewards

Everything you can earn by being active in Pawtropolis.

Sourced from the `#server-info` forum (canonical, maintained by the Owner). If this doc drifts from the forum, the forum wins.

---

## Table of Contents

- [Level Rewards](#level-rewards)
- [Activity Rewards (Weekly Newsletter)](#activity-rewards-weekly-newsletter)
- [Credit System (Monthly)](#credit-system-monthly)
- [Byte Tokens](#byte-tokens)
- [Movie Night Reward Tiers](#movie-night-reward-tiers)
- [Server Shop & Economy](#server-shop--economy)

---

## Level Rewards

Roles unlock as you level up. Each level adds perks on top of the previous one.

| Level Role ID | Unlocks |
|---------------|---------|
| `896070888712175687` | Media posting in most media channels; video + streaming in voice channels |
| `896070888712175688` | Embed links in most media channels; message history in `1400345890933444628` |
| `896070888712175689` | Next level tier role |
| `1280767926147878962` | Soundboards in voice channels; role `1385194063841722439`; media posting in `896070889462976608` |
| `896070888712175690` | Link embed posting in `896070889462976608`; poll creation in `1437295827134447768` |
| `896070888712175691` | Role `1385194838890119229`; access to `「⭐」known-chat` (`1488258803928404069`) |
| `896070888712175692` | Roles `1385054283904323665`, `1385054324295733278` |
| `1214944241050976276` | Roles `1385195450856112198`, `929950578379993108` |
| `1280766451208421407` | (base unlock) |
| `1280766659539501117` | Roles `1385054324295733278`, `1385195806579097600` |
| `1280766667999285329` | Roles `1414982808631377971`, `1385054324295733278` |
| `896070888712175693` | Roles `1385195929459494952`, `1385195450856112198`, `1402298352560902224` |

Byte tokens are redeemable through `/byte` in channel `896070890457018384`. AllByte tokens need to be in a ticket.

---

## Activity Rewards (Weekly Newsletter)

The top three most active users each week get announced in a weekly newsletter post. The exact role names and reward amounts can shift over time; the in-Discord newsletter thread is the canonical source. Find it linked from the **City Hall** post inside `「🔍」server-info` (the message describing reward systems lists the newsletter channel).

The current shape of the reward (subject to change in the newsletter thread):

### 1st Place

- The active "weekly winner" role tied to that week's newsletter
- A bonus XP grant
- A currency grant
- One monthly credit (counts toward the credit-redemption tiers below)

If the 1st-place user is on a streak, the reward pool doubles. The pool resets when the streak breaks.

### 2nd and 3rd Place

- A "runner-up" role for that week
- A smaller XP grant
- A smaller currency grant

> **Why no exact role IDs here?** The role IDs that previously appeared in this section no longer match the current live "weekly winner" / "runner-up" roles, and the canonical reward breakdown lives in the newsletter post inside `「🔍」server-info` rather than this doc. Refer to the live thread for the current numbers.

---

## Credit System (Monthly)

1st-place weekly winners earn 1 credit per week. Credits accumulate over the four weeks of a month and reset at the start of each month. Only one reward can be redeemed per month.

| Credits | Reward |
|---------|--------|
| 1 | Headshot art piece from a Server Artist |
| 2 | Half-body art piece from a Server Artist |
| 3 | Two $5 Discord shop items |
| 4 | One $9.99 Nitro 2x Boost |

At the end of each month the server also picks two winners from the ambassador pool: the most active text-chat user and the most active voice-chat user. Rewards rotate each month depending on which side was more active. The top slot usually includes art, a Nitro boost, a few Byte tokens, and bulk currency; the runner-up gets a smaller version of the same mix.

---

## Byte Tokens

A Byte is a consumable that multiplies your leveling XP for a set duration. Bytes are obtained through giveaways, events, drops, level rewards, and the shop.

### Types

- **Byte** is a personal token that applies only to your profile.
- **AllByte** is a global token. A staff member activates it, and the multiplier applies to everyone in the server.

AllBytes only come in Epic rarity or higher.

### Rarity

| Rarity | Multiplier | Duration |
|--------|------------|----------|
| Common | 2x | 2 hours |
| Rare | 3x | 6 hours |
| Epic | 4x | 12 hours |
| Legendary | 4x | 24 hours |
| Mythic | 6x | up to 3 days |

### How to Redeem

1. Check your inventory with `/inventory` to confirm the Byte is there.
2. Run `/shop use <item>` to consume it. This adds a role to your profile matching the Byte's level and duration.
3. With the role applied, run `/byte` in channel `896070890457018384` to activate it.
4. For AllBytes, a staff member activates it; the global XP boost is announced in the staff-managed AllByte announcement thread (link in the live `「🔍」server-info` Reward System post).

Only one role of each rarity can be attached at a time. You can't stack another Byte of the same rarity until the first one is consumed, but different rarities can coexist.

---

## Movie Night Reward Tiers

Attend movie nights in the voice channel for at least 30 minutes each to earn credit toward a tier. You can earn at most one movie-night point per day regardless of how many movies are playing.

| Tier | Role ID | Requirement | Perks |
|------|---------|-------------|-------|
| Tier 1 | `1388676461657063505` | Attend 1 movie night | Tier 1 role |
| Tier 2 | `1388676662337736804` | Attend 5 movie nights | 2x chat XP |
| Tier 3 | `1388675577778802748` | Attend 10 movie nights | 3x chat XP |
| Tier 4 | `1388677466993987677` | Attend 20+ movie nights | 5x chat XP + one movie-themed art piece by a Server Artist |

Staff verify attendance before awarding.

---

## Server Shop & Economy

The server economy runs on UnbelievaBoat (bot ID `493716749342998541`). Currency is gems.

### Shop Contents

- Color roles
- Cosmetic roles
- Redemption tickets (art, Nitro, etc.)
- Byte tokens
- VIP access
- Plus other rotating items

### Profile Commands

| Command | What it does |
|---------|--------------|
| `/balance` | Check your balance, or tag someone to check theirs |
| `/leaderboard` | View the currency leaderboard (paginated) |
| `/inventory` | List the items you currently hold |

### Earning Commands

| Command | Cooldown | Reward |
|---------|----------|--------|
| `/pet` | every 3 minutes | 1 to 100 gems |
| `/snuggle` | every 24 hours | 1000 to 7800 gems |
| `/clickcake` | every 20 minutes | 18 gems per click |

You also passively earn 5-10 gems per 30 seconds of chatting.

### Gambling Commands

Bets must be 5000 gems or higher.

| Command | How it resolves |
|---------|-----------------|
| `/rolldice bet:<amount>` | Over 64 wins the bet back; over 90 triples it; a 100 gives 9x. Anything less loses. |
| `/slots bet:<amount>` | Pays out based on matches. |
| `/coinflip guess:<heads\|tails> bet:<amount>` | Double or nothing. |

### Utilities

| Command | What it does |
|---------|--------------|
| `/give currency [@user] [amount]` | Transfer gems to someone |
| `/give item [@user] [item]` | Transfer a giftable item |
| `/shop view` | Browse the shop |
| `/shop buy [item] <amount>` | Purchase an item |
| `/shop item [item]` | Use an item from your inventory (applies the attached role if any) |

### Pick Drops

Random gem drops appear in these channels: `「🧰」bot-stuff` (`896070890457018384`), `「🎹」music` (`896070889798508599`), `「😂」memes` (`896070889462976610`), `「💭」main-chat` (`896070889462976608`), `「📷」media` (`1121191510642274354`), `「❓」qotd` (`896070889198731288`).

Giveaways and events also hand out currency; keep an eye on the announcements.

---

## See Also

- `#server-info` forum in Discord (canonical source)
- [MOD-HANDBOOK.md](MOD-HANDBOOK.md) - staff side of these systems
- [BOT-HANDBOOK.md](BOT-HANDBOOK.md) - command reference
