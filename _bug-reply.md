**Problem found:** Replies sent to the bot in DMs during an open modmail thread were forwarded to staff silently. The applicant got no feedback, so a message that landed fine looked identical to one that failed. `src/features/modmail/routing.ts:409` sent the relay to the staff thread and stopped there.

**Fix:** The applicant's own DM now gets a check mark reaction once the message is confirmed in the staff thread. The reaction fires only after the thread send succeeds, so no check mark means the relay did not go through. A failed reaction cannot break the relay itself. Three regression tests cover the ack on success, the absence of an ack on failure, and delivery surviving a reaction error.

Fixed in `6e259409`. Deployed and live.
