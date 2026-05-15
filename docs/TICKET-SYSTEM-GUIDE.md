# Ticket System Guide

First-party replacement for Ticket Tool. Covers art commissions, modmail overflow, and general staff tickets. Channels are spawned from a panel of buttons posted by `/postticketpanel`; closing and reassigning happen through dedicated slash commands so the side effects (perms, art jobs, transcripts) stay atomic.

For implementation details and the migration cutover, see [TICKET-SYSTEM-CUTOVER.md](TICKET-SYSTEM-CUTOVER.md).

---

## Commands

### `/postticketpanel`

**Who can use it:** Manage Guild

Posts (or refreshes in place) the panel embeds in the configured panel channel. Idempotent: when ticket types change in the registry, re-run and the existing panel messages are edited rather than duplicated.

Run it once after the bot is deployed to a new server, and again whenever a new ticket type is added or the panel copy changes.

### `/closeticket [reason:...]`

**Who can use it:** Community Ambassador or Mod Team (also requires **Manage Messages**)

Slash equivalent of the red **Close** button on the greeting embed. Useful when the greeting has scrolled off-screen in a long conversation.

- `reason:` is saved to the ticket transcript.
- Same gate as the close button; nothing extra to learn.
- The channel is renamed with a `closed-` prefix and the transcript is uploaded to the configured transcript channel.

### `/assignticket artist:@x`

**Who can use it:** Community Ambassador, Mod Team, or **Manage Roles**

Manually swap the assigned artist on a first-party art ticket. The command:

1. Resolves the current artist from the latest open `art_job` linked to the ticket.
2. Shows a preview embed with **Confirm** and **Cancel** buttons.
3. On confirm: closes the prior `art_job`, inserts a new one linked to the ticket, updates channel permissions so the new artist sees the channel and the old artist does not.
4. Posts a visible reassignment embed in the ticket channel so the requester sees who is now on the job.

Use this whenever a reassignment happens (theodrum → astellarkitty on art-0910, etc.) instead of editing the Ticket Tool roster + database by hand.

---

## Flow

1. **Member** clicks a ticket-type button on the panel.
2. **Bot** creates a private channel and posts the greeting embed (with **Close** button on it).
3. **Staff** handle the request inside the channel. For art tickets, the artist assignment is recorded in `art_job` and linked to the ticket via `ticket_id`.
4. **Staff** close with `/closeticket` or the **Close** button. The transcript uploads automatically.
5. **Staff** reassign with `/assignticket` when the original artist drops, takes leave, or hits queue limits.

---

## See Also

- [BOT-HANDBOOK.md](BOT-HANDBOOK.md) — full per-command details
- [PERMS-MATRIX.md](PERMS-MATRIX.md) — permission tiers
- [TICKET-SYSTEM-CUTOVER.md](TICKET-SYSTEM-CUTOVER.md) — migration from Ticket Tool
- [MOD-HANDBOOK.md](MOD-HANDBOOK.md) — escalation policies
