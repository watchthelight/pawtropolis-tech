/**
 * Pawtropolis Tech -- src/features/serverAudit/docs.ts
 * WHAT: Markdown document generators (ROLES, CHANNELS, CONFLICTS, HIERARCHY,
 *       SERVER-INFO) plus issue partitioning.
 * WHY: Extracted from serverAuditDocs.ts (#00010).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { AcknowledgedIssue } from "../../store/acknowledgedSecurityStore.js";
import {
  DANGEROUS_PERMISSIONS,
  type RoleData,
  type ChannelData,
  type ServerData,
  type SecurityIssue,
} from "./types.js";

export interface PartitionedIssues {
  active: SecurityIssue[];
  acknowledged: Array<{ issue: SecurityIssue; ack: AcknowledgedIssue }>;
}

export function partitionIssues(
  issues: SecurityIssue[],
  acknowledged: Map<string, AcknowledgedIssue>
): PartitionedIssues {
  const result: PartitionedIssues = { active: [], acknowledged: [] };

  for (const issue of issues) {
    const ack = acknowledged.get(issue.issueKey);

    if (ack && ack.permissionHash === issue.permissionHash) {
      // Issue is acknowledged AND permissions haven't changed
      result.acknowledged.push({ issue, ack });
    } else {
      // Not acknowledged OR permissions changed (invalidated)
      result.active.push(issue);
    }
  }

  return result;
}

// Build a See Also footer that links to the other auto-generated docs in
// docs/internal-info/ plus the parent audit-security-flow guide. The current
// file is excluded so each doc only links to its siblings.
export function generateSeeAlsoFooter(currentFile: string): string {
  const all: { file: string; description: string }[] = [
    { file: "ROLES.md", description: "full role permission matrix and staff/bot role details" },
    { file: "CHANNELS.md", description: "channel hierarchy and permission overwrites" },
    { file: "CONFLICTS.md", description: "security issues found by `/audit security`" },
    { file: "HIERARCHY.md", description: "top-to-bottom role position list" },
    { file: "SERVER-INFO.md", description: "server settings and aggregate statistics" },
    { file: "DIFF.md", description: "permission changes since the previous audit" },
  ];
  const siblings = all
    .filter((entry) => entry.file !== currentFile)
    .map((entry) => `- [${entry.file}](${entry.file}) — ${entry.description}`)
    .join("\n");
  return `
---

## See Also

${siblings}
- [/audit security command flow](../audit-security-flow.md) — how this file is generated
- [Audits index](../audits/README.md) — broader audit and security documentation
- [Leadership Guide](../LEADERSHIP-GUIDE.md) — the role tier that runs \`/audit security\`
`;
}

// Generate ROLES.md
export function generateRolesDoc(roles: RoleData[], serverInfo: ServerData): string {
  const staffRoles = roles.filter(
    (r) => r.permissions.some((p) => DANGEROUS_PERMISSIONS.includes(p)) && r.name !== "@everyone" && !r.managed
  );
  const botRoles = roles.filter((r) => r.managed && r.tags?.botId);
  const integrationRoles = roles.filter((r) => r.managed && !r.tags?.botId);
  const boosterRole = roles.find((r) => r.tags?.premiumSubscriberRole);

  let doc = `# Server Roles — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}
**Guild ID:** ${serverInfo.id}
**Total Roles:** ${roles.length}

## Summary

| Category | Count |
|----------|-------|
| Staff Roles (with mod perms) | ${staffRoles.length} |
| Bot Roles | ${botRoles.length} |
| Integration Roles | ${integrationRoles.length} |
| Booster Role | ${boosterRole ? "1" : "0"} |
| Other Roles | ${roles.length - staffRoles.length - botRoles.length - integrationRoles.length - (boosterRole ? 1 : 0)} |

---

## Role Hierarchy (by position)

| Position | Role | Color | Members | Managed | Key Permissions |
|----------|------|-------|---------|---------|-----------------|
`;

  for (const role of roles) {
    const keyPerms = role.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p)).slice(0, 3).join(", ");
    const managed = role.managed ? (role.tags?.botId ? "Bot" : "Integration") : "";
    doc += `| ${role.position} | ${role.name} | ${role.color} | ${role.memberCount} | ${managed} | ${keyPerms || "-"} |\n`;
  }

  doc += `
---

## Permission Matrix

Legend: ✅ = Has permission | ❌ = Does not have

| Role | Admin | ManageGuild | ManageRoles | ManageChannels | Ban | Kick | ManageMsg | Webhooks |
|------|-------|-------------|-------------|----------------|-----|------|-----------|----------|
`;

  for (const role of roles.slice(0, 50)) {
    const check = (perm: string) => (role.permissions.includes(perm) ? "✅" : "❌");
    doc += `| ${role.name.substring(0, 25)} | ${check("Administrator")} | ${check("ManageGuild")} | ${check("ManageRoles")} | ${check("ManageChannels")} | ${check("BanMembers")} | ${check("KickMembers")} | ${check("ManageMessages")} | ${check("ManageWebhooks")} |\n`;
  }

  if (roles.length > 50) {
    doc += `\n*...and ${roles.length - 50} more roles (truncated for readability)*\n`;
  }

  doc += `
---

## Staff Roles (Detailed)

`;

  for (const role of staffRoles) {
    doc += `### ${role.name}
- **ID:** ${role.id}
- **Position:** ${role.position}
- **Members:** ${role.memberCount}
- **Mentionable:** ${role.mentionable ? "Yes" : "No"}
- **Hoisted:** ${role.hoisted ? "Yes" : "No"}
- **Permissions:** ${role.permissions.join(", ")}

`;
  }

  doc += `
---

## Bot Roles

`;

  for (const role of botRoles) {
    doc += `### ${role.name}
- **ID:** ${role.id}
- **Bot ID:** ${role.tags?.botId || "Unknown"}
- **Position:** ${role.position}
- **Permissions:** ${role.permissions.join(", ")}

`;
  }

  doc += `
---

## All Role IDs (for reference)

| Role | ID |
|------|----|
`;

  for (const role of roles) {
    doc += `| ${role.name} | \`${role.id}\` |\n`;
  }

  doc += generateSeeAlsoFooter("ROLES.md");
  return doc;
}

// Generate CHANNELS.md
export function generateChannelsDoc(channels: ChannelData[], serverInfo: ServerData): string {
  const categories = channels.filter((c) => c.type === "Category");
  const textChannels = channels.filter((c) => c.type === "Text");
  const voiceChannels = channels.filter((c) => c.type === "Voice");
  const forumChannels = channels.filter((c) => c.type === "Forum");
  const threads = channels.filter((c) => c.type.includes("Thread"));

  let doc = `# Server Channels — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}
**Guild ID:** ${serverInfo.id}
**Total Channels:** ${channels.length}

## Summary

| Type | Count |
|------|-------|
| Categories | ${categories.length} |
| Text Channels | ${textChannels.length} |
| Voice Channels | ${voiceChannels.length} |
| Forum Channels | ${forumChannels.length} |
| Threads | ${threads.length} |
| Other | ${channels.length - categories.length - textChannels.length - voiceChannels.length - forumChannels.length - threads.length} |

---

## Channel Hierarchy

`;

  const uncategorized = channels.filter((c) => !c.parentId && c.type !== "Category" && !c.type.includes("Thread"));

  if (uncategorized.length > 0) {
    doc += `### (No Category)

| Channel | Type | ID | NSFW | Slowmode |
|---------|------|----|------|----------|
`;
    for (const ch of uncategorized) {
      doc += `| ${ch.name} | ${ch.type} | \`${ch.id}\` | ${ch.nsfw ? "Yes" : "No"} | ${ch.rateLimitPerUser || 0}s |\n`;
    }
    doc += "\n";
  }

  for (const category of categories) {
    const children = channels.filter((c) => c.parentId === category.id);
    doc += `### ${category.name}

**Category ID:** \`${category.id}\`

| Channel | Type | ID | NSFW | Slowmode |
|---------|------|----|------|----------|
`;
    for (const ch of children) {
      doc += `| ${ch.name} | ${ch.type} | \`${ch.id}\` | ${ch.nsfw ? "Yes" : "No"} | ${ch.rateLimitPerUser || 0}s |\n`;
    }
    doc += "\n";
  }

  doc += `---

## Permission Overwrites by Channel

> **Note:** Channels marked "Inherits from category" have no explicit overwrites and use their parent category's permissions.

`;

  for (const channel of channels) {
    doc += `### #${channel.name}

**ID:** \`${channel.id}\` | **Type:** ${channel.type}${channel.parentName ? ` | **Category:** ${channel.parentName}` : ""}

`;
    if (channel.overwrites.length === 0) {
      if (channel.type === "Category") {
        doc += `*No permission overwrites (uses server defaults)*\n\n`;
      } else {
        doc += `*Inherits from category — no explicit overwrites*\n\n`;
      }
    } else {
      doc += `| Target | Type | Allow | Deny |
|--------|------|-------|------|
`;
      for (const ow of channel.overwrites) {
        doc += `| ${ow.name} | ${ow.type} | ${ow.allow.join(", ") || "-"} | ${ow.deny.join(", ") || "-"} |\n`;
      }
      doc += "\n";
    }
  }

  doc += `---

## All Channel IDs (for reference)

| Channel | Type | ID | Category |
|---------|------|----|----------|
`;

  for (const ch of channels.filter((c) => c.type !== "Category")) {
    doc += `| ${ch.name} | ${ch.type} | \`${ch.id}\` | ${ch.parentName || "-"} |\n`;
  }

  doc += generateSeeAlsoFooter("CHANNELS.md");
  return doc;
}

// Generate CONFLICTS.md
export function generateConflictsDoc(
  partitioned: PartitionedIssues,
  serverInfo: ServerData
): string {
  const { active, acknowledged } = partitioned;

  const critical = active.filter((i) => i.severity === "critical");
  const high = active.filter((i) => i.severity === "high");
  const medium = active.filter((i) => i.severity === "medium");
  const low = active.filter((i) => i.severity === "low");

  let doc = `# Permission Conflicts & Security Concerns — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}
**Guild ID:** ${serverInfo.id}
**Active Issues:** ${active.length}
**Acknowledged:** ${acknowledged.length}

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${critical.length} |
| 🟠 High | ${high.length} |
| 🟡 Medium | ${medium.length} |
| 🟢 Low | ${low.length} |
| ✅ Acknowledged | ${acknowledged.length} |

---

`;

  if (critical.length > 0) {
    doc += `## 🔴 Critical Issues\n\n`;
    for (const issue of critical) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (high.length > 0) {
    doc += `## 🟠 High Priority Issues\n\n`;
    for (const issue of high) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (medium.length > 0) {
    doc += `## 🟡 Medium Priority Issues\n\n`;
    for (const issue of medium) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (low.length > 0) {
    doc += `## 🟢 Low Priority / Notes\n\n`;
    for (const issue of low) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (active.length === 0 && acknowledged.length === 0) {
    doc += `## ✅ No Issues Found\n\nNo permission conflicts or security concerns were detected.\n`;
  } else if (active.length === 0 && acknowledged.length > 0) {
    doc += `## ✅ All Issues Acknowledged\n\nAll detected issues have been reviewed and acknowledged by staff.\n\n---\n\n`;
  }

  // Acknowledged issues section
  if (acknowledged.length > 0) {
    doc += `## ✅ Acknowledged Issues\n\nThese issues have been reviewed by staff and marked as intentional.\n\n`;

    for (const { issue, ack } of acknowledged) {
      const ackDate = new Date(ack.acknowledgedAt * 1000).toISOString().split("T")[0];
      doc += `### [${issue.id}] ${issue.title} *(Acknowledged)*\n\n`;
      doc += `- **Affected:** ${issue.affected}\n`;
      doc += `- **Issue:** ${issue.issue}\n`;
      doc += `- **Acknowledged by:** <@${ack.acknowledgedBy}> on ${ackDate}\n`;
      if (ack.reason) {
        doc += `- **Reason:** ${ack.reason}\n`;
      }
      doc += `\n*To unacknowledge, use \`/audit unacknowledge ${issue.id}\`*\n\n---\n\n`;
    }
  }

  doc += generateSeeAlsoFooter("CONFLICTS.md");
  return doc;
}

// Generate HIERARCHY.md - Visual role hierarchy with permission analysis
export function generateHierarchyDoc(roles: RoleData[], serverInfo: ServerData): string {
  // Sort roles by position (highest first)
  const sortedRoles = [...roles].sort((a, b) => b.position - a.position);

  let doc = `# Role Hierarchy — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}

This document shows the complete role hierarchy from highest to lowest position.
Roles higher in the list can manage roles lower in the list (if they have ManageRoles permission).

---

## Hierarchy Overview

\`\`\`
`;

  // Build ASCII hierarchy
  for (const role of sortedRoles) {
    const position = String(role.position).padStart(3, " ");
    const name = role.name.length > 30 ? role.name.slice(0, 27) + "..." : role.name.padEnd(30, " ");
    const managed = role.managed ? " [BOT]" : "";
    const admin = role.permissions.includes("Administrator") ? " [ADMIN]" : "";
    const members = `(${role.memberCount} members)`;

    doc += `${position}│ ${name}${managed}${admin} ${members}\n`;
  }

  doc += `\`\`\`

---

## Permission Scope by Position

Shows which roles each ManageRoles-capable role can assign/remove:

| Role | Position | Can Manage | Protected Above |
|------|----------|------------|-----------------|
`;

  // Find roles with ManageRoles
  const manageRolesRoles = sortedRoles.filter(
    (r) => r.permissions.includes("ManageRoles") || r.permissions.includes("Administrator")
  );

  for (const role of manageRolesRoles) {
    if (role.name === "@everyone") continue;

    const canManage = sortedRoles.filter((r) => r.position < role.position && r.name !== "@everyone");
    const protectedAbove = sortedRoles.filter((r) => r.position >= role.position && r.id !== role.id);

    doc += `| ${role.name} | ${role.position} | ${canManage.length} roles | ${protectedAbove.length} roles |\n`;
  }

  doc += `
---

## Hierarchy Inversions

Roles where a lower-positioned role has more dangerous permissions than a higher-positioned role:

`;

  // Check for hierarchy inversions
  let inversionsFound = false;
  for (let i = 0; i < sortedRoles.length; i++) {
    const higherRole = sortedRoles[i]!;
    if (higherRole.name === "@everyone" || higherRole.managed) continue;

    const higherDangerous = higherRole.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p));

    for (let j = i + 1; j < sortedRoles.length; j++) {
      const lowerRole = sortedRoles[j]!;
      if (lowerRole.name === "@everyone" || lowerRole.managed) continue;

      const lowerDangerous = lowerRole.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p));
      const escalated = lowerDangerous.filter((p) => !higherDangerous.includes(p));

      if (escalated.length > 0) {
        inversionsFound = true;
        doc += `### ${lowerRole.name} (pos ${lowerRole.position}) > ${higherRole.name} (pos ${higherRole.position})

**Permissions ${lowerRole.name} has that ${higherRole.name} lacks:**
${escalated.map((p) => `- ${p}`).join("\n")}

---

`;
        break; // Only report once per pair
      }
    }
  }

  if (!inversionsFound) {
    doc += "*No hierarchy inversions detected. Role positions align with permissions.*\n\n";
  }

  doc += `---

## Staff Role Details

Detailed permission breakdown for roles with moderation capabilities:

`;

  // Find staff roles (those with dangerous perms and not bots)
  const staffRoles = sortedRoles.filter(
    (r) =>
      !r.managed &&
      r.name !== "@everyone" &&
      r.permissions.some((p) => DANGEROUS_PERMISSIONS.includes(p))
  );

  for (const role of staffRoles) {
    const dangerousPerms = role.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p));
    const otherPerms = role.permissions.filter((p) => !DANGEROUS_PERMISSIONS.includes(p));

    doc += `### ${role.name}

- **Position:** ${role.position}
- **Members:** ${role.memberCount}
- **Color:** ${role.color}

**Dangerous Permissions:**
${dangerousPerms.map((p) => `- ${p}`).join("\n") || "- None"}

**Other Permissions:**
${otherPerms.slice(0, 10).map((p) => `- ${p}`).join("\n")}${otherPerms.length > 10 ? `\n- ...and ${otherPerms.length - 10} more` : ""}

---

`;
  }

  doc += `---

*Generated by Pawtropolis Tech security audit system*
`;

  doc += generateSeeAlsoFooter("HIERARCHY.md");
  return doc;
}

// Generate SERVER-INFO.md
export function generateServerInfoDoc(serverInfo: ServerData, roles: RoleData[], channels: ChannelData[]): string {
  return `# Server Information — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}

---

## General Information

| Property | Value |
|----------|-------|
| Server Name | ${serverInfo.name} |
| Server ID | \`${serverInfo.id}\` |
| Owner | ${serverInfo.ownerTag} (\`${serverInfo.ownerId}\`) |
| Created | ${new Date(serverInfo.createdAt).toLocaleDateString()} |
| Member Count | ${serverInfo.memberCount.toLocaleString()} |
| Description | ${serverInfo.description || "None"} |

---

## Server Settings

| Setting | Value |
|---------|-------|
| Verification Level | ${serverInfo.verificationLevel} |
| Explicit Content Filter | ${serverInfo.explicitContentFilter} |
| 2FA for Mods | ${serverInfo.mfaLevel} |
| Boost Tier | Level ${serverInfo.boostTier} |
| Boost Count | ${serverInfo.boostCount} |
| Vanity URL | ${serverInfo.vanityURLCode ? `discord.gg/${serverInfo.vanityURLCode}` : "None"} |

---

## Special Channels

| Channel | ID |
|---------|-----|
| Rules Channel | ${serverInfo.rulesChannelId ? `\`${serverInfo.rulesChannelId}\`` : "Not set"} |
| System Channel | ${serverInfo.systemChannelId ? `\`${serverInfo.systemChannelId}\`` : "Not set"} |

---

## Server Features

${serverInfo.features.length > 0 ? serverInfo.features.map((f) => `- ${f}`).join("\n") : "No special features enabled."}

---

## Statistics

| Metric | Count |
|--------|-------|
| Total Roles | ${roles.length} |
| Total Channels | ${channels.length} |
| Categories | ${channels.filter((c) => c.type === "Category").length} |
| Text Channels | ${channels.filter((c) => c.type === "Text").length} |
| Voice Channels | ${channels.filter((c) => c.type === "Voice").length} |
| Forum Channels | ${channels.filter((c) => c.type === "Forum").length} |

---

## Role Distribution

| Category | Count |
|----------|-------|
| Roles with Admin | ${roles.filter((r) => r.permissions.includes("Administrator")).length} |
| Roles with Mod Perms | ${roles.filter((r) => r.permissions.includes("BanMembers") || r.permissions.includes("KickMembers")).length} |
| Bot Roles | ${roles.filter((r) => r.tags?.botId).length} |
| Mentionable Roles | ${roles.filter((r) => r.mentionable).length} |
| Hoisted Roles | ${roles.filter((r) => r.hoisted).length} |

---

## Channel Settings Overview

| Setting | Count |
|---------|-------|
| NSFW Channels | ${channels.filter((c) => c.nsfw).length} |
| Channels with Slowmode | ${channels.filter((c) => c.rateLimitPerUser && c.rateLimitPerUser > 0).length} |
| Channels with Custom Perms | ${channels.filter((c) => c.overwrites.length > 0).length} |
${generateSeeAlsoFooter("SERVER-INFO.md")}`;
}

/**
 * Generate server audit documentation
 * @param guild - The Discord guild to audit
 * @param outputDir - Output directory (default: docs/internal-info)
 * @returns Audit result summary
 */
