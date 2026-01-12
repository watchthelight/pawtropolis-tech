# Permission Conflicts & Security Concerns — 🎆 Pawtropolis™ | Furry • LGBTQ+

**Generated:** 2026-01-12T16:34:51.755Z
**Guild ID:** 896070888594759740
**Active Issues:** 0
**Acknowledged:** 54

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 0 |
| 🟡 Medium | 0 |
| 🟢 Low | 0 |
| ✅ Acknowledged | 54 |

---

## ✅ All Issues Acknowledged

All detected issues have been reviewed and acknowledged by staff.

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

### [HIGH-011] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Manager (pos 219) > Quarantined (pos 221)
- **Issue:** Lower-positioned role "Community Manager" has dangerous permissions that "Quarantined" lacks: Administrator, BanMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-011`*

---

### [HIGH-012] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Senior Administrator (pos 214) > Community Manager (pos 219)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Community Manager" lacks: KickMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-012`*

---

### [HIGH-013] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Senior Administrator (pos 214) > Enter Key (pos 218)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Enter Key" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-013`*

---

### [HIGH-014] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Senior Administrator (pos 214) > Community Development Lead (pos 217)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Community Development Lead" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-014`*

---

### [HIGH-015] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Senior Administrator (pos 214) > Mooster (pos 215)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Mooster" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-015`*

---

### [HIGH-016] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Administrator (pos 212) > Staff of the Month (pos 213)
- **Issue:** Lower-positioned role "Administrator" has dangerous permissions that "Staff of the Month" lacks: BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-016`*

---

### [HIGH-017] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 205) > VRC Group Lead (pos 211)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "VRC Group Lead" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-017`*

---

### [HIGH-018] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 205) > Senior Moderator (pos 210)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Senior Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-018`*

---

### [HIGH-019] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 205) > Moderator (pos 209)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-019`*

---

### [HIGH-020] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 205) > Junior Moderator (pos 208)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Junior Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-020`*

---

### [HIGH-021] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Apps (pos 202) > Moderation Team (pos 205)
- **Issue:** Lower-positioned role "Community Apps" has dangerous permissions that "Moderation Team" lacks: ManageChannels, ManageRoles
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-021`*

---

### [HIGH-022] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Gatekeeper (pos 203) > Staff on Break (pos 204)
- **Issue:** Lower-positioned role "Gatekeeper" has dangerous permissions that "Staff on Break" lacks: MentionEveryone
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-022`*

---

### [HIGH-023] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Apps (pos 202) > Gatekeeper (pos 203)
- **Issue:** Lower-positioned role "Community Apps" has dangerous permissions that "Gatekeeper" lacks: ManageChannels, ManageRoles, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-023`*

---

### [HIGH-024] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 196) > Community Apps (pos 202)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Community Apps" lacks: ManageMessages, MentionEveryone
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-024`*

---

### [HIGH-025] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 196) > VRC Group Team (pos 201)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "VRC Group Team" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-025`*

---

### [HIGH-026] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 196) > Events Manager (pos 200)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Events Manager" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-026`*

---

### [HIGH-027] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 196) > Event Host (pos 199)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Event Host" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-027`*

---

### [HIGH-028] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 196) > Ness :3 (pos 198)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Ness :3" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-028`*

---

### [HIGH-029] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 196) > vroom vroom (pos 197)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "vroom vroom" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-029`*

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

### [MED-010] Potentially Sensitive Channel Accessible *(Acknowledged)*

- **Affected:** Channel: #「🐴」3d-modeling (1450227604152914131)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-010`*

---

### [MED-030] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: VRC Group Lead (position 211)
- **Issue:** Role can assign/remove 211 roles below it. 11 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-030`*

---

### [MED-031] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: Senior Moderator (position 210)
- **Issue:** Role can assign/remove 210 roles below it. 12 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-031`*

---

### [MED-032] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: Community Apps (position 202)
- **Issue:** Role can assign/remove 202 roles below it. 20 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-032`*

---

### [MED-033] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: Patreon (position 148)
- **Issue:** Role can assign/remove 148 roles below it. 74 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-033`*

---

### [MED-034] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: DS.ME (position 131)
- **Issue:** Role can assign/remove 131 roles below it. 91 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-034`*

---

### [MED-035] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「💎」Lounge (896070891174260764)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-035`*

---

### [MED-036] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「👑」Werewolf's Den (1234323389892788284)
- **Issue:** Channel explicitly allows ViewChannel for Community Member, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-036`*

---

### [MED-037] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「👑」Werewolf's Den (1234323389892788284)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-037`*

---

### [MED-038] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」Lead VC (1393462083366162536)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-038`*

---

### [MED-039] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」Senior VC (1393464031762710589)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-039`*

---

### [MED-040] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「💡」member-feedback (1193455312326377592)
- **Issue:** Channel explicitly allows SendMessages for Community Member, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-040`*

---

### [MED-041] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🌐」affiliate-chat (896070890188603450)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-041`*

---

### [MED-042] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」answers (896070891539169310)
- **Issue:** Channel explicitly allows SendMessages for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-042`*

---

### [MED-043] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🛬」user-join (896070889005781033)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-043`*

---

### [MED-044] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🛫」user-left (896070891744682066)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-044`*

---

### [MED-045] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」modmail﹒logs (1169361527065808936)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-045`*

---

### [MED-046] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🗯️」waiting (1425834142330912790)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-046`*

---

### [MED-047] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」Staff (896070890738040863)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-047`*

---

### [MED-048] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」staff-news (896070891539169317)
- **Issue:** Channel explicitly allows AddReactions for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-048`*

---

### [MED-049] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」appeals (932485736366759977)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-049`*

---

### [MED-050] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」ban-summaries (1383333916596899894)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-050`*

---

### [MED-051] Webhook Access to Sensitive Channels *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role has ManageWebhooks and can access 1 sensitive channels: 「🐴」3d-modeling
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-051`*

---

### [MED-052] Webhook Access to Sensitive Channels *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role has ManageWebhooks and can access 1 sensitive channels: 「🐴」3d-modeling
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-052`*

---

### [MED-053] Gate Channel Potentially Exposed *(Acknowledged)*

- **Affected:** Channel: #「✅」verify-artist (896070890188603442)
- **Issue:** Channel appears to be a gate/verification channel but @everyone can view it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-053`*

---

### [MED-054] Gate Channel Potentially Exposed *(Acknowledged)*

- **Affected:** Channel: #「❓」verify (896070891539169311)
- **Issue:** Channel appears to be a gate/verification channel but @everyone can view it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-054`*

---

### [LOW-009] Wide @everyone/@here Access *(Acknowledged)*

- **Affected:** Role: Moderation Team (987662057069482024)
- **Issue:** 15 members can mention @everyone/@here.
- **Acknowledged by:** <@697169405422862417> on 2026-01-09
- **Reason:** Intentional

*To unacknowledge, use `/audit unacknowledge LOW-009`*

---

