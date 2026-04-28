# Ticket System — Production Cutover

This document describes how to flip Pawtropolis from the third-party Ticket Tool bot to the first-party ticket system shipped in migrations 067 + 068 and the `src/features/tickets/` module tree.

## Pre-flight

1. **Confirm migrations applied** on the production DB.
   ```bash
   ssh bash-ec2 'cd /opt/pawtropolis && npx tsx scripts/migrate.ts'
   ```
   Expected output ends with applied migrations including 067 and 068.

2. **Confirm bot has needed permissions** in the Tickets category (`1103734436291412099`):
   - Manage Channels
   - Manage Roles
   - Manage Threads
   - Manage Messages
   - Send Messages, Embed Links, Attach Files, Read Message History
   - Mention Everyone

3. **Deploy slash commands** so `/postticketpanel`, `/closeticket`, `/assignticket` show up in the slash list.
   ```bash
   ssh bash-ec2 'cd /opt/pawtropolis && npm run deploy:cmds'
   ```

4. **Restart the bot** so the new listeners (transcript capture, attachment mirror) are running.
   ```bash
   ssh bash-ec2 'pm2 restart pawtropolis-bot'
   ```

5. **Smoke test on the test guild** (`1491989610182606919`, EmojiBank001):
   - Configure `TICKETS_CATEGORY_ID` and `TICKETS_PANEL_CHANNEL_ID` env vars on the test bot deployment.
   - Run `/postticketpanel` — verify two embeds appear.
   - Click each of 10 buttons — verify channel created with correct name + greeting + Claim/Close row + private staff thread.
   - Send a few messages; verify they appear in `ticket_message`.
   - Close one — verify channel renames to `closed-…`, archive JSON written, dashboard shows transcript.

## Cutover (production guild `896070888594759740`)

1. **Announce in staff channel**, 24 hours ahead. "Ticket panel changing — old open tickets keep working until they close, new tickets land on our system."

2. **Run `/postticketpanel` as a server admin.**
   - Idempotent — if our panels already exist (footer marker `Pawtropolis Ticket System • <stack>`), it edits in place.
   - First run posts both embeds fresh.

3. **Manually delete** the two existing Ticket Tool panel messages in `1103728856294236160`:
   - Tickets stack (Ticket Tool message ID `1498047878268981349`)
   - Verification stack (Ticket Tool message ID `1450238500632006667`)

4. **Verify** by clicking each of our 10 buttons as a regular user (test account):
   - Tickets stack: Support, Report User, Report Staff, VRChat World Bug Report, VRC Sticker Wall, Art Ticket Redeem
   - Verification stack: 2D Artist, 3D Artist, Music Creator, Fursuit Creator
   - Each opens with the correct permission template (reports = Mod Team only; rest visible to Community Ambassador + sometimes Mod Team).

5. **Spot-check a legacy art ticket** — open one of the existing 26 Ticket Tool channels and run `/redeemreward` on it. Should fall through to the `$add` path because there's no `ticket` row. Confirms back-compat.

## Retro-rename (one-shot)

For any first-party art tickets that were opened **before** Phase 8a (/redeemreward integration) shipped, channel names won't yet include the assigned artist. Catch them up:

```bash
ssh bash-ec2 'cd /opt/pawtropolis && npx dotenvx run -- tsx scripts/retro-rename-art-tickets.ts --dry-run'
```

If the dry-run output looks correct, drop `--dry-run`:

```bash
ssh bash-ec2 'cd /opt/pawtropolis && npx dotenvx run -- tsx scripts/retro-rename-art-tickets.ts'
```

The script:
- Iterates `ticket WHERE status='open' AND legacy_source IS NULL AND type_key='art-redeem'`.
- Resolves current artist via `TicketService.getCurrentArtistId` (latest open `art_job` joined to `ticket_id`, fallback to latest `artist_assignment_log` by channel).
- Renames the channel to include the artist's nickname / globalName / username, sanitized.
- Idempotent — skips if the channel name already matches.
- Sleeps 3 seconds between renames to be polite (Discord rate limit is 2 per 10 minutes per channel; per-channel we are never close, but global politeness avoids cluster API spikes).

## Coexistence — what stays on Ticket Tool

The 26 in-flight Ticket Tool tickets continue to function unchanged:

- They have **no** `ticket` row in our DB → `/redeemreward` falls back to sending `$add <@artistId>` to Ticket Tool, exactly as today.
- They have **no** Claim or Close button from us — the red Close button on the Ticket Tool greeting embed still works for closing.
- They have **no** transcript capture — only first-party tickets get mirrored into `ticket_message`.

Once those 26 close naturally, Ticket Tool can be removed from the server. No deadline; bleed-off is the whole point.

## Rollback

If the new system needs to be rolled back:

1. **Disable the new panel** by deleting our two embeds in `1103728856294236160`.
2. **Re-post Ticket Tool's panels** through the Ticket Tool dashboard.
3. **Stop /redeemreward from creating ticket rows** — temporary measure; the existing branch on `legacy_source` already gates this so legacy channels keep working without changes. New tickets opened on Ticket Tool would have no `ticket` row, so `/redeemreward` would send `$add` again.
4. **Stop bot** if needed — first-party tickets that already opened keep their channels but no further state mutations happen.

The schema (migrations 067 + 068) is additive only — no rollback migration needed. Tables can be dropped at leisure if a decision is made to abandon the project.

## File map (for future maintenance)

| Concern | File |
|---|---|
| DB schema | `migrations/067_ticket_system.ts`, `migrations/068_ticket_greeting_message_id.ts` |
| Type registry | `src/features/tickets/{types,registry}.ts` |
| Service layer | `src/features/tickets/service.ts` |
| Permission templates | `src/features/tickets/permissions.ts` |
| Counter allocation | `src/features/tickets/counters.ts` |
| Embed/button rendering | `src/features/tickets/rendering.ts` |
| Panel embeds | `src/features/tickets/panels.ts` |
| Button + modal handlers | `src/features/tickets/handlers.ts` |
| Transcript capture | `src/features/tickets/transcript.ts` |
| Attachment mirror | `src/features/tickets/attachments.ts` |
| Slash commands | `src/commands/{postticketpanel,closeticket,assignticket}.ts` |
| /redeemreward integration | `src/features/artistRotation/handlers.ts:152-220` (path branch on `legacy_source`) |
| Web list + detail | `web/src/routes/dashboard/tickets/` |
| Web queries | `web/src/lib/server/queries/tickets.ts` |
| Web attachment proxy | `web/src/routes/api/tickets/[ticketId]/attachments/[attachmentId]/+server.ts` |
| SSE event types | `web/src/lib/types/events.ts` (search `ticket:`) |

## Open follow-ups (not blocking cutover)

- Cleanup policy for `data/ticket-attachments/` (e.g., delete files >180 days for closed tickets).
- Reopen flow if/when staff request it.
- Auto-close inactivity if/when the open queue grows unmanageable.
- Migrate the 26 Ticket Tool channels into our DB as `legacy_source='ticket_tool'` ghost rows so dashboard can list them read-only.
- Modlog channel mirror of ticket events.
