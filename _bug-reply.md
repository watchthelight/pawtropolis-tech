**Problem found:** `/redeemreward` refused Junior Mods with "You need the Ambassador role or Manage Roles permission." The handler at `redeemreward.ts:133` gated on the Ambassador role OR Manage Roles only, and Junior Mods carry neither, so the refusal fired for the whole junior tier.

**Fix:** The gate now passes any staff at Junior Moderator and above, plus the Ambassador role, plus Manage Roles. Redeeming an art reward is a low-risk use of role management, so the full staff team can run it. Added 5 regression tests covering the Junior Mod, Moderator, Ambassador, and Manage Roles paths plus the bare-member denial. Perms matrix and api-contracts updated to match.

Fixed in `616bd59`. Live on next restart.
