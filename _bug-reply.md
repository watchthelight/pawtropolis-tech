**Problem found:** Buying a token you already wear is a no-op on Discord. No role event fires and no audit entry is written, so the bot never learned the purchase happened and the copy was lost. That is why the first test came back empty. The 60s window I blamed earlier had nothing to do with it. Separately, the member cache only held 500 of 8,235 members, so roles people already had kept reading as newly added and fired phantom captures.

**Fix:** Mimu's shop confirmation is now the source of truth. The bot reads the granted role out of it and banks the item while leaving the role you already have. Repeat buys stack, including two in quick succession, which the old debounce quietly ate. The cache now covers the whole server. `/resetprofile user:<member> password:<pw>` clears one member's reward history so testing can start from zero. 42 new tests.

Fixed in `e8369706`. Deployed and live.
