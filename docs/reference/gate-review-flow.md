# Gate and Review Flow

How the application system works.

## Step 1: User Submits Application

1. User joins the server and lands in the Unverified Area; on Pawtropolis the gate channel is `「❓」verify` (`896070891539169311`).
2. User clicks the **Verify** button on the welcome embed.
3. Bot shows a multi-page modal flow with the questions configured per guild via `/gate set-questions`. On Pawtropolis the embed advertises **6 simple questions**.
4. Each modal page validates required fields client-side; the bot persists drafts so an interrupted flow can be resumed.
5. User submits the final page.
6. Bot validates and saves the application to the database.
7. Bot posts a review card in the configured review channel.

> The staff-facing `/gate` slash command is for setup, status checks, and welcome-message configuration. It is not how members submit applications.

## Step 2: Moderator Claims

1. Mod clicks "Claim" button on review card
2. Bot checks if already claimed
3. If available, bot assigns to mod
4. Button changes to "Unclaim"
5. Card color changes to yellow

## Step 3: Accept or Reject

**To Accept:**
```
/accept app_id:123 reason:"Welcome!"
```

**To Reject:**
```
/reject app_id:123 reason:"Doesn't meet requirements"
```

Both commands:
- Update database
- Send DM to user
- Update review card color
- Log to audit channel

## Review Card Colors

- Blue = Pending (unclaimed)
- Yellow = Claimed by a mod
- Green = Accepted
- Red = Rejected

## Database Flow

```
Application submitted
  → review_action table (status: pending)
  → action_log (action: submit)

Mod claims
  → review_action (claimed_by, claimed_at)
  → action_log (action: claim)

Mod accepts
  → review_action (status: accepted, decided_at)
  → action_log (action: accept, reason)
  → User gets member role
  → User gets DM

Mod rejects
  → review_action (status: rejected, decided_at)
  → action_log (action: reject, reason)
  → User gets DM
  → Optionally kicked (if auto_kick_rejected=1)
```

## DM Templates

Acceptance and rejection DMs can be customized with `/config set`:

```
/config set acceptance_message "Welcome to the community!"
/config set rejection_message "Thanks for applying..."
```

## Unclaiming

If a mod claims by mistake:
```
/unclaim app_id:123
```

This releases the application back to the queue.

## Common Issues

**Application not showing?**
- Check review channel is set correctly
- Bot needs Send Messages permission

**Can't claim?**
- Someone else already claimed it
- Refresh to see current status

**DM not sent?**
- User has DMs disabled
- Bot still completes the action

## Known Issues

- Applications don't show in stats until claimed (need to add submit action to action_log)
- Pretty cards sometimes don't post to logging channel (logging_channel_id missing from config)

---

## See Also

- [Gatekeeper Guide](../GATEKEEPER-GUIDE.md) — the role guide for the people who actually run this flow
- [Bot Handbook — Gate System](../BOT-HANDBOOK.md#gate-system-application-review) — the user-facing command reference
- [Database Schema](database-schema.md) — `review_action` and `action_log` table definitions
- [Logging and ModStats](logging-and-modstats.md) — how accept/reject actions feed the per-mod stats
