# Permission Conflicts & Security Concerns: Pawtropolis | Furry • LGBTQ+

**Generated:** 2026-05-02T14:22:11.592Z
**Guild ID:** 896070888594759740
**Total Issues Found:** 13

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 1 |
| 🟡 Medium | 8 |
| 🟢 Low | 1 |

---

## 🔴 Critical Issues

### [CRIT-003] Administrator Permission on User Role

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** 2 member(s) have unrestricted server access.
- **Recommendation:** Consider using specific permissions instead of Administrator. Audit who has this role.

---

### [CRIT-004] Administrator Permission on User Role

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** 1 member(s) have unrestricted server access.
- **Recommendation:** Consider using specific permissions instead of Administrator. Audit who has this role.

---

### [CRIT-005] Administrator Permission on User Role

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** 1 member(s) have unrestricted server access.
- **Recommendation:** Consider using specific permissions instead of Administrator. Audit who has this role.

---

## 🟠 High Priority Issues

### [HIGH-010] Privilege Escalation Risk

- **Affected:** Role: Administrator (896070888779317248)
- **Issue:** Role has both BanMembers and ManageRoles permissions.
- **Risk:** Users can potentially escalate privileges by assigning themselves roles up to this role's position.
- **Recommendation:** Ensure role is high in hierarchy and only trusted staff have it. Consider splitting permissions.

---

## 🟡 Medium Priority Issues

### [CRIT-001] Administrator Permission on Bot Role

- **Affected:** Role: Wick (1394581676579094600)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** Bot roles with Admin can be compromised if the bot is vulnerable.
- **Recommendation:** Review if bot actually needs Administrator. Most bots work with specific permissions.

---

### [CRIT-002] Administrator Permission on Bot Role

- **Affected:** Role: Community Founder (896070888779317254)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** Bot roles with Admin can be compromised if the bot is vulnerable.
- **Recommendation:** Review if bot actually needs Administrator. Most bots work with specific permissions.

---

### [CRIT-006] Administrator Permission on Bot Role

- **Affected:** Role: Pawtropolis Tech (1491318557483597887)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** Bot roles with Admin can be compromised if the bot is vulnerable.
- **Recommendation:** Review if bot actually needs Administrator. Most bots work with specific permissions.

---

### [MED-007] Webhook Impersonation Risk

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role can create/edit webhooks.
- **Risk:** Webhooks can impersonate any user or bot. 2 member(s) can create fake messages.
- **Recommendation:** Limit ManageWebhooks to trusted staff only. Audit webhook usage.

---

### [MED-008] Webhook Impersonation Risk

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** Role can create/edit webhooks.
- **Risk:** Webhooks can impersonate any user or bot. 1 member(s) can create fake messages.
- **Recommendation:** Limit ManageWebhooks to trusted staff only. Audit webhook usage.

---

### [MED-009] Webhook Impersonation Risk

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role can create/edit webhooks.
- **Risk:** Webhooks can impersonate any user or bot. 1 member(s) can create fake messages.
- **Recommendation:** Limit ManageWebhooks to trusted staff only. Audit webhook usage.

---

### [MED-012] Potentially Sensitive Channel Accessible

- **Affected:** Channel: #「🐴」3d-modeling-promo (1450227604152914131)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Risk:** May be unintentionally accessible to regular members.
- **Recommendation:** Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.

---

### [MED-013] Potentially Sensitive Channel Accessible

- **Affected:** Channel: #「⚙️」technology (1478733040996847697)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Risk:** May be unintentionally accessible to regular members.
- **Recommendation:** Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.

---

## 🟢 Low Priority / Notes

### [LOW-011] Wide @everyone/@here Access

- **Affected:** Role: Community Staff (987662057069482024)
- **Issue:** 19 members can mention @everyone/@here.
- **Risk:** Potential for spam or disruption.
- **Recommendation:** Consider restricting to staff roles or specific channels only.

---

