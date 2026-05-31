/**
 * Pawtropolis Tech -- src/features/serverAudit/analyze.ts
 * WHAT: Fetches roles/channels/server info from a guild and analyzes them for
 *       security issues.
 * WHY: Extracted from serverAuditDocs.ts (#00010).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type Guild } from "discord.js";
import {
  DANGEROUS_PERMISSIONS,
  getPermissionNames,
  getChannelTypeName,
  getVerificationLevelName,
  getExplicitContentFilterName,
  getMfaLevelName,
  computePermissionHash,
  type RoleData,
  type ChannelOverwrite,
  type ChannelData,
  type ServerData,
  type SecurityIssue,
} from "./types.js";

export async function fetchRoles(guild: Guild): Promise<RoleData[]> {
  const roles = await guild.roles.fetch();
  const members = await guild.members.fetch();

  const roleData: RoleData[] = [];

  for (const role of roles.values()) {
    const memberCount = members.filter((m) => m.roles.cache.has(role.id)).size;

    const data: RoleData = {
      id: role.id,
      name: role.name,
      position: role.position,
      color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "default",
      memberCount,
      permissions: getPermissionNames(role.permissions.bitfield),
      mentionable: role.mentionable,
      hoisted: role.hoist,
      managed: role.managed,
    };

    if (role.tags) {
      data.tags = {
        botId: role.tags.botId ?? undefined,
        integrationId: role.tags.integrationId ?? undefined,
        premiumSubscriberRole: role.tags.premiumSubscriberRole ?? undefined,
      };
    }

    roleData.push(data);
  }

  roleData.sort((a, b) => b.position - a.position);
  return roleData;
}

// Fetch all channel data
export async function fetchChannels(guild: Guild, roles: RoleData[]): Promise<ChannelData[]> {
  const channels = await guild.channels.fetch();
  const roleMap = new Map(roles.map((r) => [r.id, r.name]));

  const channelData: ChannelData[] = [];

  for (const channel of channels.values()) {
    if (!channel) continue;

    const overwrites: ChannelOverwrite[] = [];
    if ("permissionOverwrites" in channel) {
      for (const [id, overwrite] of channel.permissionOverwrites.cache) {
        const allowPerms = getPermissionNames(overwrite.allow.bitfield);
        const denyPerms = getPermissionNames(overwrite.deny.bitfield);

        if (allowPerms.length === 0 && denyPerms.length === 0) continue;

        let name = id;
        let type: "role" | "member" = "role";

        if (overwrite.type === 0) {
          name = roleMap.get(id) || `Unknown Role (${id})`;
          type = "role";
        } else {
          try {
            const member = await guild.members.fetch(id);
            name = member.user.tag;
          } catch {
            name = `Unknown Member (${id})`;
          }
          type = "member";
        }

        overwrites.push({ id, type, name, allow: allowPerms, deny: denyPerms });
      }
    }

    let parentName: string | null = null;
    if (channel.parentId) {
      const parent = channels.get(channel.parentId);
      if (parent) parentName = parent.name;
    }

    channelData.push({
      id: channel.id,
      name: channel.name,
      type: getChannelTypeName(channel.type),
      position: "position" in channel ? channel.position : 0,
      parentId: channel.parentId,
      parentName,
      topic: "topic" in channel ? (channel as any).topic : null,
      nsfw: "nsfw" in channel ? (channel as any).nsfw : false,
      rateLimitPerUser: "rateLimitPerUser" in channel ? (channel as any).rateLimitPerUser : null,
      overwrites,
    });
  }

  channelData.sort((a, b) => {
    if (a.type === "Category" && b.type !== "Category") return -1;
    if (b.type === "Category" && a.type !== "Category") return 1;
    if (a.parentId !== b.parentId) {
      if (!a.parentId) return -1;
      if (!b.parentId) return 1;
      return a.parentId.localeCompare(b.parentId);
    }
    return a.position - b.position;
  });

  return channelData;
}

// Fetch server metadata
export async function fetchServerInfo(guild: Guild): Promise<ServerData> {
  const owner = await guild.fetchOwner();

  return {
    name: guild.name,
    id: guild.id,
    ownerId: guild.ownerId,
    ownerTag: owner.user.tag,
    memberCount: guild.memberCount,
    createdAt: guild.createdAt.toISOString(),
    boostTier: guild.premiumTier,
    boostCount: guild.premiumSubscriptionCount || 0,
    verificationLevel: getVerificationLevelName(guild.verificationLevel),
    explicitContentFilter: getExplicitContentFilterName(guild.explicitContentFilter),
    mfaLevel: getMfaLevelName(guild.mfaLevel),
    features: guild.features,
    rulesChannelId: guild.rulesChannelId,
    systemChannelId: guild.systemChannelId,
    description: guild.description,
    vanityURLCode: guild.vanityURLCode,
  };
}

// Analyze permissions for security issues
export function analyzeSecurityIssues(roles: RoleData[], channels: ChannelData[]): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  let issueId = 1;

  // Helper to get severity prefix for display ID
  const severityPrefix = (sev: "critical" | "high" | "medium" | "low") => {
    const map = { critical: "CRIT", high: "HIGH", medium: "MED", low: "LOW" };
    return map[sev];
  };

  for (const role of roles) {
    if (role.permissions.includes("Administrator") && role.name !== "@everyone") {
      const severity = role.managed ? "medium" : "critical";
      // Hash role ID + permissions for change detection
      const hashData = `${role.id}:${role.permissions.sort().join(",")}`;
      issues.push({
        severity,
        id: `${severityPrefix(severity)}-${String(issueId++).padStart(3, "0")}`,
        title: `Administrator Permission on ${role.managed ? "Bot" : "User"} Role`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `This role has full Administrator permission, bypassing all permission checks.`,
        risk: role.managed
          ? `Bot roles with Admin can be compromised if the bot is vulnerable.`
          : `${role.memberCount} member(s) have unrestricted server access.`,
        recommendation: role.managed
          ? `Review if bot actually needs Administrator. Most bots work with specific permissions.`
          : `Consider using specific permissions instead of Administrator. Audit who has this role.`,
        issueKey: `role:${role.id}:admin`,
        permissionHash: computePermissionHash(hashData),
      });
    }
  }

  for (const role of roles) {
    if (role.name === "@everyone") continue;

    const hasBan = role.permissions.includes("BanMembers");
    const hasManageRoles = role.permissions.includes("ManageRoles");
    const hasManageWebhooks = role.permissions.includes("ManageWebhooks");
    const hasMentionEveryone = role.permissions.includes("MentionEveryone");

    // Hash role ID + relevant permissions for each check type
    const roleHashData = `${role.id}:${role.permissions.sort().join(",")}`;

    if (hasBan && hasManageRoles && !role.permissions.includes("Administrator")) {
      issues.push({
        severity: "high",
        id: `HIGH-${String(issueId++).padStart(3, "0")}`,
        title: `Privilege Escalation Risk`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `Role has both BanMembers and ManageRoles permissions.`,
        risk: `Users can potentially escalate privileges by assigning themselves roles up to this role's position.`,
        recommendation: `Ensure role is high in hierarchy and only trusted staff have it. Consider splitting permissions.`,
        issueKey: `role:${role.id}:escalation`,
        permissionHash: computePermissionHash(roleHashData),
      });
    }

    if (hasManageWebhooks && !role.managed) {
      issues.push({
        severity: "medium",
        id: `MED-${String(issueId++).padStart(3, "0")}`,
        title: `Webhook Impersonation Risk`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `Role can create/edit webhooks.`,
        risk: `Webhooks can impersonate any user or bot. ${role.memberCount} member(s) can create fake messages.`,
        recommendation: `Limit ManageWebhooks to trusted staff only. Audit webhook usage.`,
        issueKey: `role:${role.id}:webhook`,
        permissionHash: computePermissionHash(roleHashData),
      });
    }

    if (hasMentionEveryone && role.memberCount > 10 && !hasBan) {
      issues.push({
        severity: "low",
        id: `LOW-${String(issueId++).padStart(3, "0")}`,
        title: `Wide @everyone/@here Access`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `${role.memberCount} members can mention @everyone/@here.`,
        risk: `Potential for spam or disruption.`,
        recommendation: `Consider restricting to staff roles or specific channels only.`,
        issueKey: `role:${role.id}:mention_everyone`,
        permissionHash: computePermissionHash(roleHashData),
      });
    }
  }

  const everyoneRole = roles.find((r) => r.name === "@everyone");
  if (everyoneRole) {
    const dangerousEveryonePerms = everyoneRole.permissions.filter((p) =>
      DANGEROUS_PERMISSIONS.includes(p)
    );
    if (dangerousEveryonePerms.length > 0) {
      const hashData = `everyone:${everyoneRole.permissions.sort().join(",")}`;
      issues.push({
        severity: "critical",
        id: `CRIT-${String(issueId++).padStart(3, "0")}`,
        title: `Dangerous @everyone Permissions`,
        affected: `@everyone role`,
        issue: `@everyone has: ${dangerousEveryonePerms.join(", ")}`,
        risk: `ALL server members, including new joins, have these powerful permissions.`,
        recommendation: `Remove these permissions from @everyone immediately.`,
        issueKey: `everyone:dangerous_perms`,
        permissionHash: computePermissionHash(hashData),
      });
    }
  }

  const sensitiveKeywords = ["mod", "admin", "staff", "private", "secret", "internal", "leadership", "log"];
  for (const channel of channels) {
    const nameLower = channel.name.toLowerCase();
    const isSensitive = sensitiveKeywords.some((kw) => nameLower.includes(kw));

    if (isSensitive) {
      const everyoneOverwrite = channel.overwrites.find((o) => o.type === "role" && o.name === "@everyone");
      const viewDenied = everyoneOverwrite?.deny.includes("ViewChannel");
      if (!viewDenied && channel.type !== "Category") {
        // Hash channel overwrites for change detection
        // Sort by ID for deterministic hashing - Discord API can return overwrites in varying order
        const sortedOverwrites = [...channel.overwrites].sort((a, b) => a.id.localeCompare(b.id));
        const hashData = `${channel.id}:${JSON.stringify(sortedOverwrites)}`;
        issues.push({
          severity: "medium",
          id: `MED-${String(issueId++).padStart(3, "0")}`,
          title: `Potentially Sensitive Channel Accessible`,
          affected: `Channel: #${channel.name} (${channel.id})`,
          issue: `Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.`,
          risk: `May be unintentionally accessible to regular members.`,
          recommendation: `Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.`,
          issueKey: `channel:${channel.id}:sensitive`,
          permissionHash: computePermissionHash(hashData),
        });
      }
    }
  }

  for (const channel of channels) {
    for (const overwrite of channel.overwrites) {
      if (overwrite.type === "role" && overwrite.name.includes("Unknown Role")) {
        // Hash channel + orphaned role ID
        const hashData = `${channel.id}:orphan:${overwrite.id}`;
        issues.push({
          severity: "low",
          id: `LOW-${String(issueId++).padStart(3, "0")}`,
          title: `Orphaned Permission Overwrite`,
          affected: `Channel: #${channel.name} (${channel.id})`,
          issue: `Permission overwrite exists for deleted role: ${overwrite.id}`,
          risk: `Clutter and potential confusion. No immediate security risk.`,
          recommendation: `Clean up orphaned overwrites.`,
          issueKey: `channel:${channel.id}:orphan:${overwrite.id}`,
          permissionHash: computePermissionHash(hashData),
        });
      }
    }
  }

  // =========================================================================
  // PHASE 2: Enhanced Security Checks
  // =========================================================================

  // --- Role Hierarchy Checks ---
  // Build position -> role map for hierarchy analysis
  const rolesByPosition = new Map<number, RoleData>();
  for (const role of roles) {
    rolesByPosition.set(role.position, role);
  }
  const sortedRoles = [...roles].sort((a, b) => b.position - a.position); // Highest first

  // Check for hierarchy inversions (lower role has more dangerous perms than higher)
  for (let i = 0; i < sortedRoles.length; i++) {
    const higherRole = sortedRoles[i]!;
    if (higherRole.name === "@everyone" || higherRole.managed) continue;

    const higherDangerousPerms = higherRole.permissions.filter((p) =>
      DANGEROUS_PERMISSIONS.includes(p)
    );

    for (let j = i + 1; j < sortedRoles.length; j++) {
      const lowerRole = sortedRoles[j]!;
      if (lowerRole.name === "@everyone" || lowerRole.managed) continue;

      const lowerDangerousPerms = lowerRole.permissions.filter((p) =>
        DANGEROUS_PERMISSIONS.includes(p)
      );

      // Find perms the lower role has that the higher role doesn't
      const escalatedPerms = lowerDangerousPerms.filter((p) => !higherDangerousPerms.includes(p));

      if (escalatedPerms.length > 0) {
        const hashData = `hierarchy:${higherRole.id}:${lowerRole.id}:${escalatedPerms.sort().join(",")}`;
        issues.push({
          severity: "high",
          id: `HIGH-${String(issueId++).padStart(3, "0")}`,
          title: `Hierarchy Inversion`,
          affected: `Roles: ${lowerRole.name} (pos ${lowerRole.position}) > ${higherRole.name} (pos ${higherRole.position})`,
          issue: `Lower-positioned role "${lowerRole.name}" has dangerous permissions that "${higherRole.name}" lacks: ${escalatedPerms.join(", ")}`,
          risk: `Users with the lower role may have more power than their higher-ranked counterparts.`,
          recommendation: `Review role hierarchy. Either elevate ${lowerRole.name} or remove the excess permissions.`,
          issueKey: `hierarchy:inversion:${lowerRole.id}:${higherRole.id}`,
          permissionHash: computePermissionHash(hashData),
        });
        break; // Only report once per role pair
      }
    }
  }

  // Check for roles that can ManageRoles above their position (impossible, but check grants)
  for (const role of roles) {
    if (role.name === "@everyone") continue;
    if (role.permissions.includes("ManageRoles") && !role.permissions.includes("Administrator")) {
      // Find roles above this one that this role could theoretically target
      const rolesAbove = roles.filter((r) => r.position > role.position && r.name !== "@everyone");
      // Roles BELOW this one are the ones it can actually assign/remove. (role.position
      // is a hierarchy index, not a count - reporting it as the count was misleading.)
      const rolesBelow = roles.filter((r) => r.position < role.position && r.name !== "@everyone").length;
      if (rolesAbove.length > 0 && role.memberCount > 0) {
        const hashData = `hierarchy:manage_scope:${role.id}:${role.position}`;
        issues.push({
          severity: "medium",
          id: `MED-${String(issueId++).padStart(3, "0")}`,
          title: `ManageRoles Scope Warning`,
          affected: `Role: ${role.name} (position ${role.position})`,
          issue: `Role can assign/remove ${rolesBelow} roles below it. ${rolesAbove.length} roles are protected above.`,
          risk: `Ensure position is intentional. Lower positions = more assignable roles.`,
          recommendation: `Review role position. Move up if this is a senior staff role.`,
          issueKey: `hierarchy:manage_scope:${role.id}`,
          permissionHash: computePermissionHash(hashData),
        });
      }
    }
  }

  // --- Channel Sync Validation ---
  // Check if channels are more permissive than their parent category
  const categoriesById = new Map<string, ChannelData>();
  for (const ch of channels) {
    if (ch.type === "Category") {
      categoriesById.set(ch.id, ch);
    }
  }

  for (const channel of channels) {
    if (channel.type === "Category" || !channel.parentId) continue;

    const parent = categoriesById.get(channel.parentId);
    if (!parent) continue;

    // Check if channel has overwrites that parent doesn't (more permissive)
    for (const chOverwrite of channel.overwrites) {
      const parentOverwrite = parent.overwrites.find((o) => o.id === chOverwrite.id);

      if (chOverwrite.allow.length > 0) {
        // Channel allows something - check if parent denies it or doesn't allow it
        const parentDenied = parentOverwrite?.deny || [];

        const overridesDeny = chOverwrite.allow.filter((p) => parentDenied.includes(p));
        if (overridesDeny.length > 0) {
          const hashData = `sync:${channel.id}:${chOverwrite.id}:${overridesDeny.sort().join(",")}`;
          issues.push({
            severity: "medium",
            id: `MED-${String(issueId++).padStart(3, "0")}`,
            title: `Channel Overrides Category Deny`,
            affected: `Channel: #${channel.name} (${channel.id})`,
            issue: `Channel explicitly allows ${overridesDeny.join(", ")} for ${chOverwrite.name}, but category denies it.`,
            risk: `Intentional access expansion or accidental permission leak.`,
            recommendation: `Verify this override is intentional. Consider syncing with category if not.`,
            issueKey: `channel:${channel.id}:sync_override:${chOverwrite.id}`,
            permissionHash: computePermissionHash(hashData),
          });
        }
      }
    }
  }

  // --- Webhook Abuse Detection ---
  // Check for roles with ManageWebhooks that also have access to sensitive channels
  const webhookRoles = roles.filter(
    (r) => r.permissions.includes("ManageWebhooks") && !r.managed && r.name !== "@everyone"
  );

  for (const role of webhookRoles) {
    const accessibleSensitiveChannels: string[] = [];

    for (const channel of channels) {
      if (channel.type === "Category") continue;

      const nameLower = channel.name.toLowerCase();
      const isSensitive = sensitiveKeywords.some((kw) => nameLower.includes(kw));
      if (!isSensitive) continue;

      // Check if role has access to this channel
      const roleOverwrite = channel.overwrites.find((o) => o.id === role.id);
      const everyoneOverwrite = channel.overwrites.find((o) => o.name === "@everyone");

      // If ViewChannel is not denied for this role, they can access it
      const viewDenied = roleOverwrite?.deny.includes("ViewChannel");
      const everyoneViewDenied = everyoneOverwrite?.deny.includes("ViewChannel");
      const roleViewAllowed = roleOverwrite?.allow.includes("ViewChannel");

      if (!viewDenied && (!everyoneViewDenied || roleViewAllowed)) {
        accessibleSensitiveChannels.push(channel.name);
      }
    }

    if (accessibleSensitiveChannels.length > 0) {
      const hashData = `webhook_sensitive:${role.id}:${accessibleSensitiveChannels.sort().join(",")}`;
      issues.push({
        severity: "medium",
        id: `MED-${String(issueId++).padStart(3, "0")}`,
        title: `Webhook Access to Sensitive Channels`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `Role has ManageWebhooks and can access ${accessibleSensitiveChannels.length} sensitive channels: ${accessibleSensitiveChannels.slice(0, 5).join(", ")}${accessibleSensitiveChannels.length > 5 ? "..." : ""}`,
        risk: `Users with this role can create webhooks that impersonate staff/bots in sensitive channels.`,
        recommendation: `Restrict ManageWebhooks to truly trusted roles, or limit channel access.`,
        issueKey: `role:${role.id}:webhook_sensitive`,
        permissionHash: computePermissionHash(hashData),
      });
    }
  }

  // --- Verification Flow Checks ---
  // Check for gate/verification related channels that might be exposed
  const gateKeywords = ["gate", "verify", "verification", "rules", "welcome", "intake", "onboard"];

  for (const channel of channels) {
    if (channel.type === "Category") continue;

    const nameLower = channel.name.toLowerCase();
    const isGateChannel = gateKeywords.some((kw) => nameLower.includes(kw));

    if (isGateChannel) {
      // Gate channels should typically deny @everyone ViewChannel
      // and only allow unverified/new member roles
      const everyoneOverwrite = channel.overwrites.find((o) => o.name === "@everyone");
      const hasEveryoneAccess = !everyoneOverwrite?.deny.includes("ViewChannel");

      // If @everyone can see it but it looks like a gate, flag it
      if (hasEveryoneAccess && !nameLower.includes("rules")) {
        const hashData = `verification:${channel.id}:exposed`;
        issues.push({
          severity: "medium",
          id: `MED-${String(issueId++).padStart(3, "0")}`,
          title: `Gate Channel Potentially Exposed`,
          affected: `Channel: #${channel.name} (${channel.id})`,
          issue: `Channel appears to be a gate/verification channel but @everyone can view it.`,
          risk: `Verified members may still see verification prompts, or unverified users may have more access than intended.`,
          recommendation: `Review if this channel should be hidden from verified members.`,
          issueKey: `channel:${channel.id}:verification_exposed`,
          permissionHash: computePermissionHash(hashData),
        });
      }
    }
  }

  // Check if any role named "unverified", "new member", etc. has dangerous permissions
  const unverifiedKeywords = ["unverified", "new member", "newcomer", "pending", "unverify"];
  for (const role of roles) {
    const nameLower = role.name.toLowerCase();
    const isUnverifiedRole = unverifiedKeywords.some((kw) => nameLower.includes(kw));

    if (isUnverifiedRole) {
      const dangerousPerms = role.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p));
      if (dangerousPerms.length > 0) {
        const hashData = `verification:unverified_perms:${role.id}:${dangerousPerms.sort().join(",")}`;
        issues.push({
          severity: "critical",
          id: `CRIT-${String(issueId++).padStart(3, "0")}`,
          title: `Unverified Role Has Dangerous Permissions`,
          affected: `Role: ${role.name} (${role.id})`,
          issue: `This unverified/new member role has: ${dangerousPerms.join(", ")}`,
          risk: `All new joins before verification have these dangerous permissions.`,
          recommendation: `Remove dangerous permissions from unverified role immediately.`,
          issueKey: `role:${role.id}:verification_dangerous`,
          permissionHash: computePermissionHash(hashData),
        });
      }
    }
  }

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

/**
 * Partition issues into active and acknowledged.
 * An issue is considered acknowledged if:
 * 1. It exists in the acknowledged map
 * 2. The permission hash matches (permissions haven't changed)
 *
 * If permissions changed since acknowledgment, the issue stays active.
 */
