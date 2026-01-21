# Permission Conflicts & Security Concerns — Pawtropolis™ | Furry • LGBTQ+

**Generated:** 2026-01-21T15:28:07.599Z
**Guild ID:** 896070888594759740
**Active Issues:** 5
**Acknowledged:** 51

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 3 |
| 🟡 Medium | 2 |
| 🟢 Low | 0 |
| ✅ Acknowledged | 51 |

---

## 🟠 High Priority Issues

### [HIGH-013] Hierarchy Inversion

- **Affected:** Roles: Community Manager (pos 219) > Enter Key (pos 220)
- **Issue:** Lower-positioned role "Community Manager" has dangerous permissions that "Enter Key" lacks: Administrator, BanMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Community Manager or remove the excess permissions.

---

### [HIGH-014] Hierarchy Inversion

- **Affected:** Roles: Server Dev (pos 217) > Community Manager (pos 219)
- **Issue:** Lower-positioned role "Server Dev" has dangerous permissions that "Community Manager" lacks: KickMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Server Dev or remove the excess permissions.

---

### [HIGH-015] Hierarchy Inversion

- **Affected:** Roles: Server Dev (pos 217) > Community Development Lead (pos 218)
- **Issue:** Lower-positioned role "Server Dev" has dangerous permissions that "Community Development Lead" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Risk:** Users with the lower role may have more power than their higher-ranked counterparts.
- **Recommendation:** Review role hierarchy. Either elevate Server Dev or remove the excess permissions.

---

## 🟡 Medium Priority Issues

### [MED-007] Webhook Impersonation Risk

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** Role can create/edit webhooks.
- **Risk:** Webhooks can impersonate any user or bot. 1 member(s) can create fake messages.
- **Recommendation:** Limit ManageWebhooks to trusted staff only. Audit webhook usage.

---

### [MED-053] Webhook Access to Sensitive Channels

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** Role has ManageWebhooks and can access 4 sensitive channels: 「🎁」secret-santa, 「🐴」3d-modeling, 「📂」tech﹒logs, 「🔑」staff-news
- **Risk:** Users with this role can create webhooks that impersonate staff/bots in sensitive channels.
- **Recommendation:** Restrict ManageWebhooks to truly trusted roles, or limit channel access.

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

### [CRIT-004] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@600968933293424640> on 2026-01-10
- **Reason:** Batch acknowledged after hash fix deployment

*To unacknowledge, use `/audit unacknowledge CRIT-004`*

---

### [CRIT-005] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** Giving the Administrator role to Senior Admin is intentional, and this is only given to vetted, trusted users.

*To unacknowledge, use `/audit unacknowledge CRIT-005`*

---

### [HIGH-009] Privilege Escalation Risk *(Acknowledged)*

- **Affected:** Role: Administrator (896070888779317248)
- **Issue:** Role has both BanMembers and ManageRoles permissions.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, part of moderation structure, only given to trusted individuals.

*To unacknowledge, use `/audit unacknowledge HIGH-009`*

---

### [HIGH-012] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Manager (pos 219) > Quarantined (pos 222)
- **Issue:** Lower-positioned role "Community Manager" has dangerous permissions that "Quarantined" lacks: Administrator, BanMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-012`*

---

### [HIGH-016] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Senior Administrator (pos 215) > Mooster (pos 216)
- **Issue:** Lower-positioned role "Senior Administrator" has dangerous permissions that "Mooster" lacks: Administrator, BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, ManageWebhooks, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-016`*

---

### [HIGH-017] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Administrator (pos 213) > Staff of the Month (pos 214)
- **Issue:** Lower-positioned role "Administrator" has dangerous permissions that "Staff of the Month" lacks: BanMembers, KickMembers, ManageChannels, ManageGuild, ManageMessages, ManageRoles, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-017`*

---

### [HIGH-018] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 206) > VRC Group Lead (pos 212)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "VRC Group Lead" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-018`*

---

### [HIGH-019] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 206) > Senior Moderator (pos 211)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Senior Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-019`*

---

### [HIGH-020] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 206) > Moderator (pos 210)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-020`*

---

### [HIGH-021] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Moderation Team (pos 206) > Junior Moderator (pos 209)
- **Issue:** Lower-positioned role "Moderation Team" has dangerous permissions that "Junior Moderator" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-021`*

---

### [HIGH-022] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Apps (pos 203) > Moderation Team (pos 206)
- **Issue:** Lower-positioned role "Community Apps" has dangerous permissions that "Moderation Team" lacks: ManageChannels, ManageRoles
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-022`*

---

### [HIGH-023] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Gatekeeper (pos 204) > Staff on Break (pos 205)
- **Issue:** Lower-positioned role "Gatekeeper" has dangerous permissions that "Staff on Break" lacks: MentionEveryone
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-023`*

---

### [HIGH-024] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Apps (pos 203) > Gatekeeper (pos 204)
- **Issue:** Lower-positioned role "Community Apps" has dangerous permissions that "Gatekeeper" lacks: ManageChannels, ManageRoles, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-024`*

---

### [HIGH-025] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 197) > Community Apps (pos 203)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Community Apps" lacks: ManageMessages, MentionEveryone
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-025`*

---

### [HIGH-026] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 197) > VRC Group Team (pos 202)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "VRC Group Team" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-026`*

---

### [HIGH-027] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 197) > Events Manager (pos 201)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Events Manager" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-027`*

---

### [HIGH-028] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 197) > Event Host (pos 200)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Event Host" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-028`*

---

### [HIGH-029] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 197) > Ness :3 (pos 199)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "Ness :3" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-029`*

---

### [HIGH-030] Hierarchy Inversion *(Acknowledged)*

- **Affected:** Roles: Community Ambassador (pos 197) > vroom vroom (pos 198)
- **Issue:** Lower-positioned role "Community Ambassador" has dangerous permissions that "vroom vroom" lacks: ManageMessages, MentionEveryone, ModerateMembers
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge HIGH-030`*

---

### [MED-001] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Wick (1394581676579094600)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-07
- **Reason:** Intentional, but should use Pawtech in the future probably. Look into it

*To unacknowledge, use `/audit unacknowledge MED-001`*

---

### [MED-002] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Community Founder (896070888779317254)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, it's part of an old linked role.

*To unacknowledge, use `/audit unacknowledge MED-002`*

---

### [MED-006] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-006`*

---

### [MED-008] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-008`*

---

### [MED-011] Potentially Sensitive Channel Accessible *(Acknowledged)*

- **Affected:** Channel: #「🐴」3d-modeling (1450227604152914131)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-011`*

---

### [MED-031] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: VRC Group Lead (position 212)
- **Issue:** Role can assign/remove 212 roles below it. 11 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-17
- **Reason:** Reviewed

*To unacknowledge, use `/audit unacknowledge MED-031`*

---

### [MED-032] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: Senior Moderator (position 211)
- **Issue:** Role can assign/remove 211 roles below it. 12 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-17
- **Reason:** Reviewed

*To unacknowledge, use `/audit unacknowledge MED-032`*

---

### [MED-033] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: Community Apps (position 203)
- **Issue:** Role can assign/remove 203 roles below it. 20 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-17
- **Reason:** Reviewed

*To unacknowledge, use `/audit unacknowledge MED-033`*

---

### [MED-034] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: Patreon (position 149)
- **Issue:** Role can assign/remove 149 roles below it. 74 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-17
- **Reason:** Reviewed

*To unacknowledge, use `/audit unacknowledge MED-034`*

---

### [MED-035] ManageRoles Scope Warning *(Acknowledged)*

- **Affected:** Role: DS.ME (position 132)
- **Issue:** Role can assign/remove 132 roles below it. 91 roles are protected above.
- **Acknowledged by:** <@697169405422862417> on 2026-01-17
- **Reason:** Reviewed

*To unacknowledge, use `/audit unacknowledge MED-035`*

---

### [MED-036] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「💎」Lounge (896070891174260764)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-036`*

---

### [MED-037] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「👑」Werewolf's Den (1234323389892788284)
- **Issue:** Channel explicitly allows ViewChannel for Community Member, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-037`*

---

### [MED-038] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「👑」Werewolf's Den (1234323389892788284)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-038`*

---

### [MED-039] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」Lead VC (1393462083366162536)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-039`*

---

### [MED-040] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」Senior VC (1393464031762710589)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-040`*

---

### [MED-041] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「💡」member-feedback (1193455312326377592)
- **Issue:** Channel explicitly allows SendMessages for Community Member, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-041`*

---

### [MED-042] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🌐」affiliate-chat (896070890188603450)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-042`*

---

### [MED-043] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」answers (896070891539169310)
- **Issue:** Channel explicitly allows SendMessages for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-043`*

---

### [MED-044] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🛬」user-join (896070889005781033)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-044`*

---

### [MED-045] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🛫」user-left (896070891744682066)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-045`*

---

### [MED-046] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」modmail﹒logs (1169361527065808936)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-046`*

---

### [MED-047] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🗯️」waiting (1425834142330912790)
- **Issue:** Channel explicitly allows ViewChannel for Moderation Team, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-047`*

---

### [MED-048] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」Staff (896070890738040863)
- **Issue:** Channel explicitly allows Connect for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-048`*

---

### [MED-049] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」staff-news (896070891539169317)
- **Issue:** Channel explicitly allows AddReactions for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-049`*

---

### [MED-050] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」appeals (932485736366759977)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-050`*

---

### [MED-051] Channel Overrides Category Deny *(Acknowledged)*

- **Affected:** Channel: #「🔑」ban-summaries (1383333916596899894)
- **Issue:** Channel explicitly allows SendMessages for @everyone, but category denies it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-051`*

---

### [MED-052] Webhook Access to Sensitive Channels *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role has ManageWebhooks and can access 1 sensitive channels: 「🐴」3d-modeling
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-052`*

---

### [MED-054] Webhook Access to Sensitive Channels *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role has ManageWebhooks and can access 1 sensitive channels: 「🐴」3d-modeling
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-054`*

---

### [MED-055] Gate Channel Potentially Exposed *(Acknowledged)*

- **Affected:** Channel: #「✅」verify-artist (896070890188603442)
- **Issue:** Channel appears to be a gate/verification channel but @everyone can view it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-055`*

---

### [MED-056] Gate Channel Potentially Exposed *(Acknowledged)*

- **Affected:** Channel: #「❓」verify (896070891539169311)
- **Issue:** Channel appears to be a gate/verification channel but @everyone can view it.
- **Acknowledged by:** <@697169405422862417> on 2026-01-12
- **Reason:** Intentional resolution

*To unacknowledge, use `/audit unacknowledge MED-056`*

---

### [LOW-010] Wide @everyone/@here Access *(Acknowledged)*

- **Affected:** Role: Moderation Team (987662057069482024)
- **Issue:** 18 members can mention @everyone/@here.
- **Acknowledged by:** <@697169405422862417> on 2026-01-09
- **Reason:** Intentional

*To unacknowledge, use `/audit unacknowledge LOW-010`*

---

