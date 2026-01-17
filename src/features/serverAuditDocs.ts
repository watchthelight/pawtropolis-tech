/**
 * Pawtropolis Tech — src/features/serverAuditDocs.ts
 * WHAT: Generate comprehensive server audit documentation
 * WHY: Creates internal-info docs for roles, channels, permissions, and security issues
 * USAGE: Called by /audit docs command or scripts/audit-server-full.ts
 */

import {
  type Guild,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  getAcknowledgedIssues,
  clearStaleAcknowledgments,
  type AcknowledgedIssue,
} from "../store/acknowledgedSecurityStore.js";
import {
  saveSnapshot,
  getLatestSnapshot,
  recordIssueHistory,
  pruneOldSnapshots,
  type RoleSnapshot,
  type ChannelSnapshot,
  type IssueSnapshot,
  type PermissionOverwriteSnapshot,
} from "../store/securitySnapshotStore.js";
import {
  computeSnapshotDiff,
  generateDiffMarkdown,
  hasMeaningfulChanges,
  getDangerousChanges,
  type SnapshotDiff,
} from "./securityDiff.js";

// All permission flags we care about for the matrix
const PERMISSION_FLAGS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "KickMembers",
  "BanMembers",
  "ManageMessages",
  "ManageWebhooks",
  "ManageNicknames",
  "ManageEmojisAndStickers",
  "MentionEveryone",
  "ModerateMembers",
  "ViewAuditLog",
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "EmbedLinks",
  "AttachFiles",
  "AddReactions",
  "UseExternalEmojis",
  "UseExternalStickers",
  "ReadMessageHistory",
  "Connect",
  "Speak",
  "Stream",
  "MuteMembers",
  "DeafenMembers",
  "MoveMembers",
  "UseVAD",
  "PrioritySpeaker",
] as const;

// Dangerous permission combinations for security analysis
const DANGEROUS_PERMISSIONS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "BanMembers",
  "KickMembers",
  "ManageChannels",
  "ManageWebhooks",
  "MentionEveryone",
  "ManageMessages",
  "ModerateMembers",
];

interface RoleData {
  id: string;
  name: string;
  position: number;
  color: string;
  memberCount: number;
  permissions: string[];
  mentionable: boolean;
  hoisted: boolean;
  managed: boolean;
  tags?: {
    botId?: string;
    integrationId?: string;
    premiumSubscriberRole?: boolean;
  };
}

interface ChannelOverwrite {
  id: string;
  type: "role" | "member";
  name: string;
  allow: string[];
  deny: string[];
}

interface ChannelData {
  id: string;
  name: string;
  type: string;
  position: number;
  parentId: string | null;
  parentName: string | null;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number | null;
  overwrites: ChannelOverwrite[];
}

export interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  id: string;
  title: string;
  affected: string;
  issue: string;
  risk: string;
  recommendation: string;
  // Stable identifier for acknowledgment (e.g., "role:123456789:admin")
  issueKey: string;
  // Hash of relevant permissions for change detection
  permissionHash: string;
}

interface ServerData {
  name: string;
  id: string;
  ownerId: string;
  ownerTag: string;
  memberCount: number;
  createdAt: string;
  boostTier: number;
  boostCount: number;
  verificationLevel: string;
  explicitContentFilter: string;
  mfaLevel: string;
  features: string[];
  rulesChannelId: string | null;
  systemChannelId: string | null;
  description: string | null;
  vanityURLCode: string | null;
}

export interface AuditResult {
  roleCount: number;
  channelCount: number;
  issueCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  acknowledgedCount: number;
  outputDir: string;
  commitUrl?: string;
  /** Diff from previous snapshot (if available) */
  diff?: SnapshotDiff;
  /** Number of dangerous permission changes detected */
  dangerousChangeCount?: number;
  /** Snapshot ID for reference */
  snapshotId?: number;
  /** Active (unacknowledged) issues for display purposes */
  activeIssues?: SecurityIssue[];
}

export interface GitPushResult {
  success: boolean;
  commitHash?: string;
  commitUrl?: string;
  docsUrl?: string;
  error?: string;
}

// Helper to get permission names from a permission bitfield
function getPermissionNames(permissions: bigint): string[] {
  const result: string[] = [];
  for (const flag of PERMISSION_FLAGS) {
    const perm = PermissionFlagsBits[flag as keyof typeof PermissionFlagsBits];
    if (perm && (permissions & perm) === perm) {
      result.push(flag);
    }
  }
  return result;
}

// Helper to convert channel type enum to readable string
function getChannelTypeName(type: ChannelType): string {
  const typeMap: Record<number, string> = {
    [ChannelType.GuildText]: "Text",
    [ChannelType.GuildVoice]: "Voice",
    [ChannelType.GuildCategory]: "Category",
    [ChannelType.GuildAnnouncement]: "Announcement",
    [ChannelType.AnnouncementThread]: "Announcement Thread",
    [ChannelType.PublicThread]: "Public Thread",
    [ChannelType.PrivateThread]: "Private Thread",
    [ChannelType.GuildStageVoice]: "Stage",
    [ChannelType.GuildForum]: "Forum",
    [ChannelType.GuildMedia]: "Media",
  };
  return typeMap[type] || `Unknown (${type})`;
}

// Helper to get verification level name
function getVerificationLevelName(level: number): string {
  const levels = ["None", "Low", "Medium", "High", "Very High"];
  return levels[level] || `Unknown (${level})`;
}

// Helper to get explicit content filter name
function getExplicitContentFilterName(level: number): string {
  const levels = ["Disabled", "Members without roles", "All members"];
  return levels[level] || `Unknown (${level})`;
}

// Helper to get MFA level name
function getMfaLevelName(level: number): string {
  return level === 0 ? "Not required" : "Required for moderation";
}

/**
 * Compute a short hash of permission-relevant data for change detection.
 * If permissions change, the hash changes, invalidating acknowledgments.
 */
function computePermissionHash(data: string): string {
  return createHash("md5").update(data).digest("hex").slice(0, 16);
}

/**
 * Convert RoleData to snapshot format for storage.
 */
function roleToSnapshot(role: RoleData): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    color: parseInt(role.color.replace("#", "").replace("default", "0"), 16),
    managed: role.managed,
    permissions: role.permissions.join(","), // Store as comma-separated for bitfield reconstruction
    memberCount: role.memberCount,
  };
}

/**
 * Convert ChannelData to snapshot format for storage.
 */
function channelToSnapshot(channel: ChannelData): ChannelSnapshot {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position,
    overwrites: channel.overwrites.map((ow): PermissionOverwriteSnapshot => ({
      id: ow.id,
      type: ow.type,
      allow: ow.allow.join(","),
      deny: ow.deny.join(","),
    })),
  };
}

/**
 * Convert SecurityIssue to snapshot format for storage.
 */
function issueToSnapshot(issue: SecurityIssue): IssueSnapshot {
  return {
    key: issue.issueKey,
    severity: issue.severity,
    title: issue.title,
    description: issue.issue,
    targetId: issue.affected.match(/\((\d+)\)/)?.[1] ?? "",
    targetName: issue.affected.replace(/\s*\(\d+\)$/, "").replace(/^(Role|Channel):\s*/, ""),
    permissionHash: issue.permissionHash,
  };
}

// Fetch all role data
async function fetchRoles(guild: Guild): Promise<RoleData[]> {
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
async function fetchChannels(guild: Guild, roles: RoleData[]): Promise<ChannelData[]> {
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
async function fetchServerInfo(guild: Guild): Promise<ServerData> {
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
function analyzeSecurityIssues(roles: RoleData[], channels: ChannelData[]): SecurityIssue[] {
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
    const higherRole = sortedRoles[i];
    if (higherRole.name === "@everyone" || higherRole.managed) continue;

    const higherDangerousPerms = higherRole.permissions.filter((p) =>
      DANGEROUS_PERMISSIONS.includes(p)
    );

    for (let j = i + 1; j < sortedRoles.length; j++) {
      const lowerRole = sortedRoles[j];
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
      if (rolesAbove.length > 0 && role.memberCount > 0) {
        const hashData = `hierarchy:manage_scope:${role.id}:${role.position}`;
        issues.push({
          severity: "medium",
          id: `MED-${String(issueId++).padStart(3, "0")}`,
          title: `ManageRoles Scope Warning`,
          affected: `Role: ${role.name} (position ${role.position})`,
          issue: `Role can assign/remove ${role.position} roles below it. ${rolesAbove.length} roles are protected above.`,
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
        const parentAllowed = parentOverwrite?.allow || [];

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

      // Check if any staff/mod roles can see this channel
      const staffKeywords = ["mod", "admin", "staff", "helper", "support"];
      const staffWithAccess = channel.overwrites.filter((o) => {
        const isStaff = staffKeywords.some((kw) => o.name.toLowerCase().includes(kw));
        return isStaff && o.allow.includes("ViewChannel");
      });

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
interface PartitionedIssues {
  active: SecurityIssue[];
  acknowledged: Array<{ issue: SecurityIssue; ack: AcknowledgedIssue }>;
}

function partitionIssues(
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

// Generate ROLES.md
function generateRolesDoc(roles: RoleData[], serverInfo: ServerData): string {
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

  return doc;
}

// Generate CHANNELS.md
function generateChannelsDoc(channels: ChannelData[], serverInfo: ServerData): string {
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

  return doc;
}

// Generate CONFLICTS.md
function generateConflictsDoc(
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

  return doc;
}

// Generate HIERARCHY.md - Visual role hierarchy with permission analysis
function generateHierarchyDoc(roles: RoleData[], serverInfo: ServerData): string {
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
    const higherRole = sortedRoles[i];
    if (higherRole.name === "@everyone" || higherRole.managed) continue;

    const higherDangerous = higherRole.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p));

    for (let j = i + 1; j < sortedRoles.length; j++) {
      const lowerRole = sortedRoles[j];
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

  return doc;
}

// Generate SERVER-INFO.md
function generateServerInfoDoc(serverInfo: ServerData, roles: RoleData[], channels: ChannelData[]): string {
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
`;
}

/**
 * Generate server audit documentation
 * @param guild - The Discord guild to audit
 * @param outputDir - Output directory (default: docs/internal-info)
 * @returns Audit result summary
 */
export async function generateAuditDocs(guild: Guild, outputDir?: string): Promise<AuditResult> {
  const OUTPUT_DIR = outputDir || join(process.cwd(), "docs/internal-info");

  // Fetch all data
  const roles = await fetchRoles(guild);
  const channels = await fetchChannels(guild, roles);
  const serverInfo = await fetchServerInfo(guild);
  const issues = analyzeSecurityIssues(roles, channels);

  // Populate cache so /audit acknowledge can find these exact issues with matching IDs
  // This ensures IDs like MED-010 stay consistent between the audit display and acknowledge
  securityAnalysisCache.set(guild.id, {
    issues,
    expiresAt: Date.now() + SECURITY_CACHE_TTL_MS,
  });

  // Fetch acknowledged issues and partition
  const acknowledged = getAcknowledgedIssues(guild.id);
  const partitioned = partitionIssues(issues, acknowledged);

  // Clean up stale acknowledgments (for deleted roles/channels)
  const validKeys = new Set(issues.map((i) => i.issueKey));
  clearStaleAcknowledgments(guild.id, validKeys);

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate and write docs
  writeFileSync(join(OUTPUT_DIR, "ROLES.md"), generateRolesDoc(roles, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "CHANNELS.md"), generateChannelsDoc(channels, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "CONFLICTS.md"), generateConflictsDoc(partitioned, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "SERVER-INFO.md"), generateServerInfoDoc(serverInfo, roles, channels));
  writeFileSync(join(OUTPUT_DIR, "HIERARCHY.md"), generateHierarchyDoc(roles, serverInfo));

  // Count active issues only (not acknowledged ones)
  const active = partitioned.active;
  const critical = active.filter((i) => i.severity === "critical").length;
  const high = active.filter((i) => i.severity === "high").length;
  const medium = active.filter((i) => i.severity === "medium").length;
  const low = active.filter((i) => i.severity === "low").length;

  // --- Snapshot and Diff Tracking ---

  // Convert data to snapshot format
  const rolesSnapshot = roles.map(roleToSnapshot);
  const channelsSnapshot = channels.map(channelToSnapshot);
  const issuesSnapshot = issues.map(issueToSnapshot);

  // Get previous snapshot for diff computation
  const previousSnapshot = getLatestSnapshot(guild.id);

  // Save new snapshot
  let snapshotId: number | undefined;
  let diff: SnapshotDiff | undefined;
  let dangerousChangeCount = 0;

  try {
    snapshotId = saveSnapshot({
      guildId: guild.id,
      roleCount: roles.length,
      channelCount: channels.length,
      issueCount: active.length,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      rolesSnapshot,
      channelsSnapshot,
      issuesSnapshot,
    });

    // Compute diff if we have a previous snapshot
    if (previousSnapshot) {
      const newSnapshot = getLatestSnapshot(guild.id);
      if (newSnapshot) {
        diff = computeSnapshotDiff(previousSnapshot, newSnapshot);
        dangerousChangeCount = getDangerousChanges(diff).length;

        // Generate DIFF.md if there are meaningful changes
        if (hasMeaningfulChanges(diff)) {
          const diffMarkdown = generateDiffMarkdown(diff, serverInfo.name);
          writeFileSync(join(OUTPUT_DIR, "DIFF.md"), diffMarkdown);
        }
      }
    }

    // Record issue history for trend tracking
    // Count issues by category
    const roleIssues = issues.filter((i) => i.issueKey.startsWith("role:")).length;
    const channelIssues = issues.filter((i) => i.issueKey.startsWith("channel:")).length;
    const hierarchyIssues = issues.filter((i) => i.issueKey.includes("hierarchy")).length;
    const verificationIssues = issues.filter((i) => i.issueKey.includes("verification")).length;

    recordIssueHistory({
      guildId: guild.id,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      acknowledgedCount: partitioned.acknowledged.length,
      roleIssues,
      channelIssues,
      hierarchyIssues,
      verificationIssues,
    });

    // Prune old snapshots to prevent unbounded growth (keep last 30)
    pruneOldSnapshots(guild.id, 30);
  } catch {
    // Snapshot storage is non-critical, don't fail the audit
  }

  return {
    roleCount: roles.length,
    channelCount: channels.length,
    issueCount: active.length,
    criticalCount: critical,
    highCount: high,
    mediumCount: medium,
    lowCount: low,
    acknowledgedCount: partitioned.acknowledged.length,
    outputDir: OUTPUT_DIR,
    diff,
    dangerousChangeCount,
    snapshotId,
    activeIssues: active,
  };
}

/**
 * Cache for security analysis results (5 minute TTL).
 * Allows acknowledge commands to find the same issues displayed by /audit security.
 * Extended from 60s to 5 minutes to give users time to review and acknowledge issues.
 */
const securityAnalysisCache = new Map<string, { issues: SecurityIssue[]; expiresAt: number }>();
const SECURITY_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Run a fresh security analysis and return issues (for acknowledge command).
 * Does NOT write files or update docs.
 * Results are cached for 60 seconds to allow multiple acknowledges.
 */
export async function analyzeSecurityOnly(guild: Guild): Promise<SecurityIssue[]> {
  const cached = securityAnalysisCache.get(guild.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.issues;
  }

  const roles = await fetchRoles(guild);
  const channels = await fetchChannels(guild, roles);
  const issues = analyzeSecurityIssues(roles, channels);

  securityAnalysisCache.set(guild.id, {
    issues,
    expiresAt: Date.now() + SECURITY_CACHE_TTL_MS,
  });

  return issues;
}

/**
 * Progress callback for verbose status updates during git operations
 */
export type GitProgressCallback = (step: string, detail?: string) => Promise<void>;

/**
 * Commit and push audit docs to GitHub
 * Requires GITHUB_BOT_TOKEN, GITHUB_BOT_USERNAME, GITHUB_BOT_EMAIL, GITHUB_REPO env vars
 *
 * Auto-syncs with remote before pushing to avoid conflicts (pulls + rebases if needed)
 */
export async function commitAndPushDocs(
  result: AuditResult,
  onProgress?: GitProgressCallback
): Promise<GitPushResult> {
  const token = process.env.GITHUB_BOT_TOKEN;
  const username = process.env.GITHUB_BOT_USERNAME;
  const email = process.env.GITHUB_BOT_EMAIL;
  const repo = process.env.GITHUB_REPO;

  const progress = onProgress ?? (async () => {});

  if (!token || !username || !email || !repo) {
    return {
      success: false,
      error: "Missing GitHub configuration (GITHUB_BOT_TOKEN, GITHUB_BOT_USERNAME, GITHUB_BOT_EMAIL, GITHUB_REPO)",
    };
  }

  const cwd = process.cwd();
  const remoteUrl = `https://${username}:${token}@github.com/${repo}.git`;

  try {
    // Step 1: Check if there are changes to commit
    await progress("Checking for changes", "git status");
    const status = execSync("git status --porcelain docs/internal-info/", { cwd, encoding: "utf-8" });
    if (!status.trim()) {
      return {
        success: true,
        error: "No changes to commit",
      };
    }

    // Step 2: Configure git for this commit
    await progress("Configuring git", `user: ${username}`);
    execSync(`git config user.name "${username}"`, { cwd });
    execSync(`git config user.email "${email}"`, { cwd });

    // Step 3: Fetch latest from remote (to detect conflicts)
    await progress("Fetching remote", "git fetch origin main");
    try {
      execSync(`git fetch ${remoteUrl} main`, { cwd, encoding: "utf-8", stdio: "pipe" });
    } catch {
      // Fetch failed - might be network issue, continue anyway
    }

    // Step 4: Stash our changes temporarily
    await progress("Stashing changes", "git stash");
    execSync("git stash push -m 'audit-temp' -- docs/internal-info/", { cwd, stdio: "pipe" });

    // Step 5: Pull and rebase to sync with remote
    await progress("Syncing with remote", "git pull --rebase");
    try {
      execSync(`git pull ${remoteUrl} main --rebase`, { cwd, encoding: "utf-8", stdio: "pipe" });
    } catch (pullErr) {
      // Pull failed - try to recover by resetting to remote
      await progress("Recovering from conflict", "git reset --hard origin/main");
      try {
        execSync("git fetch origin main && git reset --hard origin/main", { cwd, stdio: "pipe" });
      } catch {
        // If reset also fails, pop stash and continue - we'll report the error
      }
    }

    // Step 6: Pop our stashed changes
    await progress("Restoring changes", "git stash pop");
    try {
      execSync("git stash pop", { cwd, stdio: "pipe" });
    } catch {
      // Stash pop failed - changes might conflict, try to get them back
      try {
        execSync("git checkout stash -- docs/internal-info/", { cwd, stdio: "pipe" });
        execSync("git stash drop", { cwd, stdio: "pipe" });
      } catch {
        // Give up on stash recovery, the files should still be there from generateAuditDocs
      }
    }

    // Step 7: Stage the docs
    await progress("Staging files", "git add docs/internal-info/");
    execSync("git add docs/internal-info/", { cwd });

    // Step 8: Create commit
    const timestamp = new Date().toISOString().split("T")[0];
    const commitMsg = `docs: update internal-info audit (${timestamp})

Roles: ${result.roleCount}
Channels: ${result.channelCount}
Issues: ${result.issueCount} (${result.criticalCount} critical, ${result.highCount} high, ${result.mediumCount} medium, ${result.lowCount} low)

[automated by /audit security]`;

    await progress("Creating commit", "git commit");
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd });

    // Step 9: Get the commit hash
    const commitHash = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();

    // Step 10: Push to remote
    await progress("Pushing to GitHub", `${repo}`);
    execSync(`git push ${remoteUrl} HEAD:main`, { cwd, encoding: "utf-8", stdio: "pipe" });

    // Reset remote to not expose token
    execSync(`git remote set-url origin https://github.com/${repo}.git`, { cwd });

    const commitUrl = `https://github.com/${repo}/commit/${commitHash}`;
    const docsUrl = `https://github.com/${repo}/blob/main/docs/internal-info/CONFLICTS.md`;

    await progress("Complete", commitHash.slice(0, 7));

    return {
      success: true,
      commitHash,
      commitUrl,
      docsUrl,
    };
  } catch (err) {
    // Reset git config to original user if push failed
    try {
      execSync('git config user.name "watchthelight"', { cwd });
      execSync('git config user.email "admin@watchthelight.org"', { cwd });
    } catch {
      // Ignore reset errors
    }

    // Try to clean up any leftover stash
    try {
      execSync("git stash drop", { cwd, stdio: "pipe" });
    } catch {
      // Ignore - no stash to drop
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error during git push",
    };
  }
}
