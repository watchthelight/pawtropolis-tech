/**
 * Pawtropolis Tech -- src/features/serverAudit/types.ts
 * WHAT: Shared types, permission constants, and small formatting/snapshot
 *       helpers for the server-audit doc pipeline.
 * WHY: Extracted from serverAuditDocs.ts (#00010) so analyze/docs modules and
 *      the orchestrator share one definition.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { PermissionFlagsBits, ChannelType } from "discord.js";
import { createHash } from "node:crypto";
import type {
  RoleSnapshot,
  ChannelSnapshot,
  IssueSnapshot,
  PermissionOverwriteSnapshot,
} from "../../store/securitySnapshotStore.js";
import type { SnapshotDiff } from "../securityDiff.js";

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
export const DANGEROUS_PERMISSIONS = [
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

export interface RoleData {
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

export interface ChannelOverwrite {
  id: string;
  type: "role" | "member";
  name: string;
  allow: string[];
  deny: string[];
}

export interface ChannelData {
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

export interface ServerData {
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
export function getPermissionNames(permissions: bigint): string[] {
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
export function getChannelTypeName(type: ChannelType): string {
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
export function getVerificationLevelName(level: number): string {
  const levels = ["None", "Low", "Medium", "High", "Very High"];
  return levels[level] || `Unknown (${level})`;
}

// Helper to get explicit content filter name
export function getExplicitContentFilterName(level: number): string {
  const levels = ["Disabled", "Members without roles", "All members"];
  return levels[level] || `Unknown (${level})`;
}

// Helper to get MFA level name
export function getMfaLevelName(level: number): string {
  return level === 0 ? "Not required" : "Required for moderation";
}

/**
 * Compute a short hash of permission-relevant data for change detection.
 * If permissions change, the hash changes, invalidating acknowledgments.
 */
export function computePermissionHash(data: string): string {
  return createHash("md5").update(data).digest("hex").slice(0, 16);
}

/**
 * Convert RoleData to snapshot format for storage.
 */
export function roleToSnapshot(role: RoleData): RoleSnapshot {
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
export function channelToSnapshot(channel: ChannelData): ChannelSnapshot {
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
export function issueToSnapshot(issue: SecurityIssue): IssueSnapshot {
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
