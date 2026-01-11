# Permission Conflicts & Security Concerns — 🎆 Pawtropolis™ | Furry • LGBTQ+

**Generated:** 2026-01-11T20:35:22.430Z
**Guild ID:** 896070888594759740
**Active Issues:** 45
**Acknowledged:** 9

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 19 |
| 🟡 Medium | 26 |
| 🟢 Low | 0 |
| ✅ Acknowledged | 9 |

---

## 🟠 High Priority Issues

### [HIGH-011] Hierarchy Inversion

- **Affected:** Roles: Community Manager (pos 219) > Quarantined (pos 221)
- **Issue:** Lower-positioned role "Community Manager" has dangerous permissions that "Quarantined" lacks: Administrator, BanMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Manager or remove the excess permissions.

---

### [HIGH-012] Hierarchy Inversion

- **Affected:** Roles: Senior Administrator (pos 214) > Community Manager (pos 219)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Community Manager" lacks: KickMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Senior Administrator or remove the excess permissions.

---

### [HIGH-013] Hierarchy Inversion

- **Affected:** Roles: Senior Administrator (pos 214) > Enter Key (pos 218)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Enter Key" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Senior Administrator or remove the excess permissions.

---

### [HIGH-014] Hierarchy Inversion

- **Affected:** Roles: Senior Administrator (pos 214) > Community Development Lead (pos 217)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Community Development Lead" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Senior Administrator or remove the excess permissions.

---

### [HIGH-015] Hierarchy Inversion

- **Affected:** Roles: Senior Administrator (pos 214) > Mooster (pos 215)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Mooster" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Senior Administrator or remove the excess permissions.

---

### [HIGH-016] Hierarchy Inversion

- **Affected:** Roles: Administrator (pos 212) > Staff of the Month (pos 213)
- **Issue:** Lower-positioned role "Administrator" has dangerous permissions that "Staff of the Month" lacks: BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Administrator or remove the excess permissions.

---

### [HIGH-017] Hierarchy Inversion

- **Affected:** Roles: Moderation Team (pos 205) > VRC Group Lead (pos 211)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "VRC Group Lead" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Moderation Team or remove the excess permissions.

---

### [HIGH-018] Hierarchy Inversion

- **Affected:** Roles: Moderation Team (pos 205) > Senior Moderator (pos 210)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Senior Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Moderation Team or remove the excess permissions.

---

### [HIGH-019] Hierarchy Inversion

- **Affected:** Roles: Moderation Team (pos 205) > Moderator (pos 209)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Moderation Team or remove the excess permissions.

---

### [HIGH-020] Hierarchy Inversion

- **Affected:** Roles: Moderation Team (pos 205) > Junior Moderator (pos 208)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Junior Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Moderation Team or remove the excess permissions.

---

### [HIGH-021] Hierarchy Inversion

- **Affected:** Roles: Community Apps (pos 202) > Moderation Team (pos 205)
- **Issue:** Lower-positioned role "Community Apps" has dangerous permissions that "Moderation Team" lacks: ManageChannels, ManageRoles
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Apps or remove the excess permissions.

---

### [HIGH-022] Hierarchy Inversion

- **Affected:** Roles: Gatekeeper (pos 203) > Staff on Break (pos 204)
- **Issue:** Lower-positioned role "Gatekeeper" has dangerous permissions that "Staff on Break" lacks: MentionEveryone
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Gatekeeper or remove the excess permissions.

---

### [HIGH-023] Hierarchy Inversion

- **Affected:** Roles: Community Apps (pos 202) > Gatekeeper (pos 203)
- **Issue:** Lower-positioned role "Community Apps" has dangerous permissions that "Gatekeeper" lacks: ManageChannels, ManageRoles, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Apps or remove the excess permissions.

---

### [HIGH-024] Hierarchy Inversion

- **Affected:** Roles: Community Ambassador (pos 196) > Community Apps (pos 202)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Community Apps" lacks: ManageMessages, MentionEveryone
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Ambassador or remove the excess permissions.

---

### [HIGH-025] Hierarchy Inversion

- **Affected:** Roles: Community Ambassador (pos 196) > VRC Group Team (pos 201)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "VRC Group Team" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Ambassador or remove the excess permissions.

---

### [HIGH-026] Hierarchy Inversion

- **Affected:** Roles: Community Ambassador (pos 196) > Events Manager (pos 200)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Events Manager" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Ambassador or remove the excess permissions.

---

### [HIGH-027] Hierarchy Inversion

- **Affected:** Roles: Community Ambassador (pos 196) > Event Host (pos 199)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Event Host" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Ambassador or remove the excess permissions.

---

### [HIGH-028] Hierarchy Inversion

- **Affected:** Roles: Community Ambassador (pos 196) > Ness :3 (pos 198)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Ness :3" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Ambassador or remove the excess permissions.

---

### [HIGH-029] Hierarchy Inversion

- **Affected:** Roles: Community Ambassador (pos 196) > vroom vroom (pos 197)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "vroom vroom" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Ambassador or remove the excess permissions.

---

## 🟡 Medium Priority Issues

### [MED-010] Potentially Sensitive Channel Accessible

- **Affected:** Channel: #「🐴」3d-modeling (1450227604152914131)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Risk:** May be unintentionally accessible to regular members.
- **Recommendation:** Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.

---

### [MED-030] ManageRoles Scope Warning

- **Affected:** Role: VRC Group Lead (position 211)
- **Issue:** Role can assign/remove 211 roles below it. 11 roles are protected above.
- **Risk:** Ensure position is intentional. Lower positions = more assignable roles.
- **Recommendation:** Review role position. Move up if this is a senior staff role.

---

### [MED-031] ManageRoles Scope Warning

- **Affected:** Role: Senior Moderator (position 210)
- **Issue:** Role can assign/remove 210 roles below it. 12 roles are protected above.
- **Risk:** Ensure position is intentional. Lower positions = more assignable roles.
- **Recommendation:** Review role position. Move up if this is a senior staff role.

---

### [MED-032] ManageRoles Scope Warning

- **Affected:** Role: Community Apps (position 202)
- **Issue:** Role can assign/remove 202 roles below it. 20 roles are protected above.
- **Risk:** Ensure position is intentional. Lower positions = more assignable roles.
- **Recommendation:** Review role position. Move up if this is a senior staff role.

---

### [MED-033] ManageRoles Scope Warning

- **Affected:** Role: Patreon (position 148)
- **Issue:** Role can assign/remove 148 roles below it. 74 roles are protected above.
- **Risk:** Ensure position is intentional. Lower positions = more assignable roles.
- **Recommendation:** Review role position. Move up if this is a senior staff role.

---

### [MED-034] ManageRoles Scope Warning

- **Affected:** Role: DS.ME (position 131)
- **Issue:** Role can assign/remove 131 roles below it. 91 roles are protected above.
- **Risk:** Ensure position is intentional. Lower positions = more assignable roles.
- **Recommendation:** Review role position. Move up if this is a senior staff role.

---

### [MED-035] Channel Overrides Category Deny

- **Affected:** Channel: #「💎」Lounge (896070891174260764)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-036] Channel Overrides Category Deny

- **Affected:** Channel: #「👑」Werewolf's Den (1234323389892788284)
- **Issue:** Channel explicitly allows ViewChannel for Community Member, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-037] Channel Overrides Category Deny

- **Affected:** Channel: #「👑」Werewolf's Den (1234323389892788284)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-038] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」Lead VC (1393462083366162536)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-039] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」Senior VC (1393464031762710589)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-040] Channel Overrides Category Deny

- **Affected:** Channel: #「💡」member-feedback (1193455312326377592)
- **Issue:** Channel explicitly allows SendMessages for Community Member, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-041] Channel Overrides Category Deny

- **Affected:** Channel: #「🌐」affiliate-chat (896070890188603450)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-042] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」answers (896070891539169310)
- **Issue:** Channel explicitly allows SendMessages for Moderation Team, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-043] Channel Overrides Category Deny

- **Affected:** Channel: #「🛬」user-join (896070889005781033)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-044] Channel Overrides Category Deny

- **Affected:** Channel: #「🛫」user-left (896070891744682066)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-045] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」modmail﹒logs (1169361527065808936)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-046] Channel Overrides Category Deny

- **Affected:** Channel: #「🗯️」waiting (1425834142330912790)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-047] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」Staff (896070890738040863)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-048] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」staff-news (896070891539169317)
- **Issue:** Channel explicitly allows AddReactions for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-049] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」appeals (932485736366759977)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-050] Channel Overrides Category Deny

- **Affected:** Channel: #「🔑」ban-summaries (1383333916596899894)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Risk:** Intentional access expansion or accidental permission leak.
- **Recommendation:** Verify this override is intentional. Consider syncing with category if not.

---

### [MED-051] Webhook Access to Sensitive Channels

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role has ManageWebhooks and can access 1 sensitive channels: 「🐴」3d-modeling
- **Risk:** Users with this role can create webhooks that impersonate staff/bots in sensitive channels.
- **Recommendation:** Restrict ManageWebhooks to truly trusted roles, or limit channel access.

---

### [MED-052] Webhook Access to Sensitive Channels

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role has ManageWebhooks and can access 1 sensitive channels: 「🐴」3d-modeling
- **Risk:** Users with this role can create webhooks that impersonate staff/bots in sensitive channels.
- **Recommendation:** Restrict ManageWebhooks to truly trusted roles, or limit channel access.

---

### [MED-053] Gate Channel Potentially Exposed

- **Affected:** Channel: #「✅」verify-artist (896070890188603442)
- **Issue:** Channel appears to be a gate/verification channel but @everyone can view it.
- **Risk:** Verified members may still see verification prompts, or unverified users may have more access than intended.
- **Recommendation:** Review if this channel should be hidden from verified members.

---

### [MED-054] Gate Channel Potentially Exposed

- **Affected:** Channel: #「❓」verify (896070891539169311)
- **Issue:** Channel appears to be a gate/verification channel but @everyone can view it.
- **Risk:** Verified members may still see verification prompts, or unverified users may have more access than intended.
- **Recommendation:** Review if this channel should be hidden from verified members.

---

## ✅ Acknowledged Issues

These issues have been reviewed by staff and marked as intentional.

### [CRIT-003] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** Only given to trusted users

*To unacknowledge, use `/audit unacknowledge CRIT-003`*

---

### [CRIT-005] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** Giving the Administrator role to Senior Admin is intentional, and this is only given to vetted, trusted users.

*To unacknowledge, use `/audit unacknowledge CRIT-005`*

---

### [HIGH-008] Privilege Escalation Risk *(Acknowledged)*

- **Affected:** Role: Administrator (896070888779317248)
- **Issue:** Role has both BanMembers and ManageRoles permissions.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, part of moderation structure, only given to trusted individuals.

*To unacknowledge, use `/audit unacknowledge HIGH-008`*

---

### [MED-001] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Wick (1394581676579094600)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-07
- **Reason:** Intentional, but should use Pawtech in the future probably. Look into it

*To unacknowledge, use `/audit unacknowledge MED-001`*

---

### [MED-002] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Server Owner (896070888779317254)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, it's part of an old linked role.

*To unacknowledge, use `/audit unacknowledge MED-002`*

---

### [MED-004] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@600968933293424640> on 2026-01-10
- **Reason:** Batch acknowledged after hash fix deployment

*To unacknowledge, use `/audit unacknowledge MED-004`*

---

### [MED-006] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-006`*

---

### [MED-007] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-007`*

---

### [LOW-009] Wide @everyone/@here Access *(Acknowledged)*

- **Affected:** Role: Moderation Team (987662057069482024)
- **Issue:** 15 members can mention @everyone/@here.
- **Acknowledged by:** <@697169405422862417> on 2026-01-09
- **Reason:** Intentional

*To unacknowledge, use `/audit unacknowledge LOW-009`*

---

