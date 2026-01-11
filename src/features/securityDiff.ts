/**
 * Pawtropolis Tech — src/features/securityDiff.ts
 * WHAT: Compute diffs between security audit snapshots
 * WHY: Detect permission changes, new issues, and track what's changed since last audit
 * FLOWS:
 *  - computeSnapshotDiff(oldSnapshot, newSnapshot) → SnapshotDiff
 *  - generateDiffMarkdown(diff) → string (DIFF.md content)
 *  - getDangerousChanges(diff) → DangerousChange[] (for alerts)
 * DOCS:
 *  - Discord Permissions: https://discord.com/developers/docs/topics/permissions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { PermissionsBitField } from "discord.js";
import type {
  SecuritySnapshot,
  RoleSnapshot,
  ChannelSnapshot,
  IssueSnapshot,
  PermissionOverwriteSnapshot,
} from "../store/securitySnapshotStore.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// Types
// ============================================================================

export interface SnapshotDiff {
  /** Timestamp of old snapshot */
  oldTimestamp: number;
  /** Timestamp of new snapshot */
  newTimestamp: number;

  /** Roles that were added since last snapshot */
  rolesAdded: RoleSnapshot[];
  /** Roles that were removed since last snapshot */
  rolesRemoved: RoleSnapshot[];
  /** Roles with permission changes */
  rolesChanged: RoleChange[];

  /** Channels that were added */
  channelsAdded: ChannelSnapshot[];
  /** Channels that were removed */
  channelsRemoved: ChannelSnapshot[];
  /** Channels with permission overwrite changes */
  channelsChanged: ChannelChange[];

  /** New security issues detected */
  issuesNew: IssueSnapshot[];
  /** Security issues that were resolved */
  issuesResolved: IssueSnapshot[];

  /** Summary counts */
  summary: DiffSummary;
}

export interface RoleChange {
  roleId: string;
  roleName: string;
  oldPosition: number;
  newPosition: number;
  permissionsAdded: string[];
  permissionsRemoved: string[];
}

export interface ChannelChange {
  channelId: string;
  channelName: string;
  overwritesAdded: OverwriteChange[];
  overwritesRemoved: OverwriteChange[];
  overwritesModified: OverwriteModification[];
}

export interface OverwriteChange {
  targetId: string;
  targetType: "role" | "member";
  targetName?: string;
  allow: string[];
  deny: string[];
}

export interface OverwriteModification {
  targetId: string;
  targetType: "role" | "member";
  targetName?: string;
  allowAdded: string[];
  allowRemoved: string[];
  denyAdded: string[];
  denyRemoved: string[];
}

export interface DiffSummary {
  rolesModified: number;
  channelsModified: number;
  issuesNew: number;
  issuesResolved: number;
  dangerousChanges: number;
}

export interface DangerousChange {
  type: "role_permission" | "channel_overwrite" | "everyone_exposed";
  severity: "critical" | "high" | "medium";
  description: string;
  targetId: string;
  targetName: string;
  permissions: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Permissions that are considered dangerous when added */
const DANGEROUS_PERMISSIONS = [
  "Administrator",
  "BanMembers",
  "KickMembers",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageWebhooks",
  "MentionEveryone",
  "ManageMessages",
  "ModerateMembers", // Timeout
];

/** Critical permissions that warrant immediate alerts */
const CRITICAL_PERMISSIONS = ["Administrator", "ManageGuild", "ManageRoles"];

/** Permissions to check for @everyone exposure */
const EXPOSURE_PERMISSIONS = ["ViewChannel", "SendMessages", "Connect"];

// ============================================================================
// Main Diff Functions
// ============================================================================

/**
 * Compute a detailed diff between two snapshots.
 */
export function computeSnapshotDiff(
  oldSnapshot: SecuritySnapshot,
  newSnapshot: SecuritySnapshot
): SnapshotDiff {
  logger.debug(
    { oldId: oldSnapshot.id, newId: newSnapshot.id },
    "[securityDiff] Computing snapshot diff"
  );

  // Build lookup maps for old state
  const oldRolesMap = new Map(oldSnapshot.rolesSnapshot.map((r) => [r.id, r]));
  const newRolesMap = new Map(newSnapshot.rolesSnapshot.map((r) => [r.id, r]));

  const oldChannelsMap = new Map(oldSnapshot.channelsSnapshot.map((c) => [c.id, c]));
  const newChannelsMap = new Map(newSnapshot.channelsSnapshot.map((c) => [c.id, c]));

  const oldIssuesMap = new Map(oldSnapshot.issuesSnapshot.map((i) => [i.key, i]));
  const newIssuesMap = new Map(newSnapshot.issuesSnapshot.map((i) => [i.key, i]));

  // Compute role changes
  const rolesAdded: RoleSnapshot[] = [];
  const rolesRemoved: RoleSnapshot[] = [];
  const rolesChanged: RoleChange[] = [];

  for (const [id, newRole] of newRolesMap) {
    const oldRole = oldRolesMap.get(id);
    if (!oldRole) {
      rolesAdded.push(newRole);
    } else if (oldRole.permissions !== newRole.permissions || oldRole.position !== newRole.position) {
      const change = computeRoleChange(oldRole, newRole);
      if (change.permissionsAdded.length > 0 || change.permissionsRemoved.length > 0) {
        rolesChanged.push(change);
      }
    }
  }

  for (const [id, oldRole] of oldRolesMap) {
    if (!newRolesMap.has(id)) {
      rolesRemoved.push(oldRole);
    }
  }

  // Compute channel changes
  const channelsAdded: ChannelSnapshot[] = [];
  const channelsRemoved: ChannelSnapshot[] = [];
  const channelsChanged: ChannelChange[] = [];

  for (const [id, newChannel] of newChannelsMap) {
    const oldChannel = oldChannelsMap.get(id);
    if (!oldChannel) {
      channelsAdded.push(newChannel);
    } else {
      const change = computeChannelChange(oldChannel, newChannel);
      if (
        change.overwritesAdded.length > 0 ||
        change.overwritesRemoved.length > 0 ||
        change.overwritesModified.length > 0
      ) {
        channelsChanged.push(change);
      }
    }
  }

  for (const [id, oldChannel] of oldChannelsMap) {
    if (!newChannelsMap.has(id)) {
      channelsRemoved.push(oldChannel);
    }
  }

  // Compute issue changes
  const issuesNew: IssueSnapshot[] = [];
  const issuesResolved: IssueSnapshot[] = [];

  for (const [key, newIssue] of newIssuesMap) {
    if (!oldIssuesMap.has(key)) {
      issuesNew.push(newIssue);
    }
  }

  for (const [key, oldIssue] of oldIssuesMap) {
    if (!newIssuesMap.has(key)) {
      issuesResolved.push(oldIssue);
    }
  }

  // Build summary
  const diff: SnapshotDiff = {
    oldTimestamp: oldSnapshot.createdAt,
    newTimestamp: newSnapshot.createdAt,
    rolesAdded,
    rolesRemoved,
    rolesChanged,
    channelsAdded,
    channelsRemoved,
    channelsChanged,
    issuesNew,
    issuesResolved,
    summary: {
      rolesModified: rolesAdded.length + rolesRemoved.length + rolesChanged.length,
      channelsModified: channelsAdded.length + channelsRemoved.length + channelsChanged.length,
      issuesNew: issuesNew.length,
      issuesResolved: issuesResolved.length,
      dangerousChanges: 0, // Computed below
    },
  };

  // Count dangerous changes
  diff.summary.dangerousChanges = getDangerousChanges(diff).length;

  return diff;
}

/**
 * Compute detailed role permission changes.
 */
function computeRoleChange(oldRole: RoleSnapshot, newRole: RoleSnapshot): RoleChange {
  const oldPerms = new PermissionsBitField(BigInt(oldRole.permissions));
  const newPerms = new PermissionsBitField(BigInt(newRole.permissions));

  const permissionsAdded: string[] = [];
  const permissionsRemoved: string[] = [];

  // Check each permission flag
  for (const perm of Object.keys(PermissionsBitField.Flags) as Array<
    keyof typeof PermissionsBitField.Flags
  >) {
    const hadPerm = oldPerms.has(perm);
    const hasPerm = newPerms.has(perm);

    if (!hadPerm && hasPerm) {
      permissionsAdded.push(perm);
    } else if (hadPerm && !hasPerm) {
      permissionsRemoved.push(perm);
    }
  }

  return {
    roleId: newRole.id,
    roleName: newRole.name,
    oldPosition: oldRole.position,
    newPosition: newRole.position,
    permissionsAdded,
    permissionsRemoved,
  };
}

/**
 * Compute detailed channel permission overwrite changes.
 */
function computeChannelChange(oldChannel: ChannelSnapshot, newChannel: ChannelSnapshot): ChannelChange {
  const oldOverwritesMap = new Map(oldChannel.overwrites.map((o) => [o.id, o]));
  const newOverwritesMap = new Map(newChannel.overwrites.map((o) => [o.id, o]));

  const overwritesAdded: OverwriteChange[] = [];
  const overwritesRemoved: OverwriteChange[] = [];
  const overwritesModified: OverwriteModification[] = [];

  for (const [id, newOw] of newOverwritesMap) {
    const oldOw = oldOverwritesMap.get(id);
    if (!oldOw) {
      overwritesAdded.push({
        targetId: id,
        targetType: newOw.type,
        allow: bitfieldToPermissionNames(newOw.allow),
        deny: bitfieldToPermissionNames(newOw.deny),
      });
    } else if (oldOw.allow !== newOw.allow || oldOw.deny !== newOw.deny) {
      const mod = computeOverwriteModification(oldOw, newOw);
      if (
        mod.allowAdded.length > 0 ||
        mod.allowRemoved.length > 0 ||
        mod.denyAdded.length > 0 ||
        mod.denyRemoved.length > 0
      ) {
        overwritesModified.push(mod);
      }
    }
  }

  for (const [id, oldOw] of oldOverwritesMap) {
    if (!newOverwritesMap.has(id)) {
      overwritesRemoved.push({
        targetId: id,
        targetType: oldOw.type,
        allow: bitfieldToPermissionNames(oldOw.allow),
        deny: bitfieldToPermissionNames(oldOw.deny),
      });
    }
  }

  return {
    channelId: newChannel.id,
    channelName: newChannel.name,
    overwritesAdded,
    overwritesRemoved,
    overwritesModified,
  };
}

/**
 * Compute specific permission changes in an overwrite.
 */
function computeOverwriteModification(
  oldOw: PermissionOverwriteSnapshot,
  newOw: PermissionOverwriteSnapshot
): OverwriteModification {
  const oldAllow = new PermissionsBitField(BigInt(oldOw.allow));
  const newAllow = new PermissionsBitField(BigInt(newOw.allow));
  const oldDeny = new PermissionsBitField(BigInt(oldOw.deny));
  const newDeny = new PermissionsBitField(BigInt(newOw.deny));

  const allowAdded: string[] = [];
  const allowRemoved: string[] = [];
  const denyAdded: string[] = [];
  const denyRemoved: string[] = [];

  for (const perm of Object.keys(PermissionsBitField.Flags) as Array<
    keyof typeof PermissionsBitField.Flags
  >) {
    // Allow changes
    if (!oldAllow.has(perm) && newAllow.has(perm)) allowAdded.push(perm);
    if (oldAllow.has(perm) && !newAllow.has(perm)) allowRemoved.push(perm);

    // Deny changes
    if (!oldDeny.has(perm) && newDeny.has(perm)) denyAdded.push(perm);
    if (oldDeny.has(perm) && !newDeny.has(perm)) denyRemoved.push(perm);
  }

  return {
    targetId: newOw.id,
    targetType: newOw.type,
    allowAdded,
    allowRemoved,
    denyAdded,
    denyRemoved,
  };
}

/**
 * Convert a permission bitfield string to an array of permission names.
 */
function bitfieldToPermissionNames(bitfield: string): string[] {
  const perms = new PermissionsBitField(BigInt(bitfield));
  return perms.toArray();
}

// ============================================================================
// Dangerous Change Detection
// ============================================================================

/**
 * Extract changes that are potentially dangerous and should trigger alerts.
 */
export function getDangerousChanges(diff: SnapshotDiff): DangerousChange[] {
  const dangerous: DangerousChange[] = [];

  // Check role permission additions
  for (const change of diff.rolesChanged) {
    const dangerousAdded = change.permissionsAdded.filter((p) => DANGEROUS_PERMISSIONS.includes(p));
    if (dangerousAdded.length > 0) {
      const isCritical = dangerousAdded.some((p) => CRITICAL_PERMISSIONS.includes(p));
      dangerous.push({
        type: "role_permission",
        severity: isCritical ? "critical" : "high",
        description: `Role "${change.roleName}" gained dangerous permissions`,
        targetId: change.roleId,
        targetName: change.roleName,
        permissions: dangerousAdded,
      });
    }
  }

  // Check new roles with dangerous permissions
  for (const role of diff.rolesAdded) {
    const perms = new PermissionsBitField(BigInt(role.permissions));
    const dangerousPerms = DANGEROUS_PERMISSIONS.filter((p) =>
      perms.has(p as keyof typeof PermissionsBitField.Flags)
    );
    if (dangerousPerms.length > 0) {
      const isCritical = dangerousPerms.some((p) => CRITICAL_PERMISSIONS.includes(p));
      dangerous.push({
        type: "role_permission",
        severity: isCritical ? "critical" : "high",
        description: `New role "${role.name}" has dangerous permissions`,
        targetId: role.id,
        targetName: role.name,
        permissions: dangerousPerms,
      });
    }
  }

  // Check channel overwrite changes for @everyone exposure
  for (const change of diff.channelsChanged) {
    for (const mod of change.overwritesModified) {
      // Check if ViewChannel was allowed (exposed) for @everyone
      if (mod.allowAdded.some((p) => EXPOSURE_PERMISSIONS.includes(p))) {
        dangerous.push({
          type: "channel_overwrite",
          severity: "medium",
          description: `Channel "${change.channelName}" gained new allow permissions`,
          targetId: change.channelId,
          targetName: change.channelName,
          permissions: mod.allowAdded.filter((p) => EXPOSURE_PERMISSIONS.includes(p)),
        });
      }
    }

    // Check new overwrites that allow dangerous permissions
    for (const added of change.overwritesAdded) {
      const dangerousAllowed = added.allow.filter((p) => DANGEROUS_PERMISSIONS.includes(p));
      if (dangerousAllowed.length > 0) {
        dangerous.push({
          type: "channel_overwrite",
          severity: "high",
          description: `New overwrite in "${change.channelName}" allows dangerous permissions`,
          targetId: change.channelId,
          targetName: change.channelName,
          permissions: dangerousAllowed,
        });
      }
    }
  }

  return dangerous;
}

// ============================================================================
// Markdown Generation
// ============================================================================

/**
 * Generate a markdown document summarizing the diff.
 */
export function generateDiffMarkdown(diff: SnapshotDiff, guildName: string): string {
  const oldDate = new Date(diff.oldTimestamp * 1000).toISOString().split("T")[0];
  const newDate = new Date(diff.newTimestamp * 1000).toISOString().split("T")[0];

  let md = `# Permission Changes Since Last Audit\n\n`;
  md += `**Guild:** ${guildName}\n`;
  md += `**Previous Audit:** ${oldDate}\n`;
  md += `**Current Audit:** ${newDate}\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| Change Type | Count |\n`;
  md += `|-------------|-------|\n`;
  md += `| Roles Added | ${diff.rolesAdded.length} |\n`;
  md += `| Roles Removed | ${diff.rolesRemoved.length} |\n`;
  md += `| Roles Modified | ${diff.rolesChanged.length} |\n`;
  md += `| Channels Added | ${diff.channelsAdded.length} |\n`;
  md += `| Channels Removed | ${diff.channelsRemoved.length} |\n`;
  md += `| Channels Modified | ${diff.channelsChanged.length} |\n`;
  md += `| New Issues | ${diff.issuesNew.length} |\n`;
  md += `| Resolved Issues | ${diff.issuesResolved.length} |\n`;
  md += `| Dangerous Changes | ${diff.summary.dangerousChanges} |\n\n`;

  // Dangerous changes (if any)
  const dangerous = getDangerousChanges(diff);
  if (dangerous.length > 0) {
    md += `## Dangerous Changes\n\n`;
    for (const change of dangerous) {
      const severityEmoji =
        change.severity === "critical" ? "🔴" : change.severity === "high" ? "🟠" : "🟡";
      md += `### ${severityEmoji} ${change.severity.toUpperCase()}: ${change.description}\n`;
      md += `- **Target:** ${change.targetName} (\`${change.targetId}\`)\n`;
      md += `- **Permissions:** ${change.permissions.join(", ")}\n\n`;
    }
  }

  // Role changes
  if (diff.rolesAdded.length > 0 || diff.rolesRemoved.length > 0 || diff.rolesChanged.length > 0) {
    md += `## Role Changes\n\n`;

    for (const role of diff.rolesAdded) {
      md += `### [ADDED] ${role.name}\n`;
      md += `- Position: ${role.position}\n`;
      md += `- Permissions: ${bitfieldToPermissionNames(role.permissions).join(", ") || "None"}\n\n`;
    }

    for (const role of diff.rolesRemoved) {
      md += `### [REMOVED] ${role.name}\n`;
      md += `- Was at position: ${role.position}\n\n`;
    }

    for (const change of diff.rolesChanged) {
      md += `### [CHANGED] ${change.roleName}\n`;
      if (change.oldPosition !== change.newPosition) {
        md += `- Position: ${change.oldPosition} → ${change.newPosition}\n`;
      }
      if (change.permissionsAdded.length > 0) {
        md += `- **Permissions Added:** ${change.permissionsAdded.join(", ")}\n`;
      }
      if (change.permissionsRemoved.length > 0) {
        md += `- **Permissions Removed:** ${change.permissionsRemoved.join(", ")}\n`;
      }
      md += `\n`;
    }
  }

  // Channel changes
  if (
    diff.channelsAdded.length > 0 ||
    diff.channelsRemoved.length > 0 ||
    diff.channelsChanged.length > 0
  ) {
    md += `## Channel Changes\n\n`;

    for (const ch of diff.channelsAdded) {
      md += `### [ADDED] ${ch.name}\n`;
      md += `- Type: ${ch.type}\n`;
      if (ch.overwrites.length > 0) {
        md += `- Overwrites: ${ch.overwrites.length}\n`;
      }
      md += `\n`;
    }

    for (const ch of diff.channelsRemoved) {
      md += `### [REMOVED] ${ch.name}\n\n`;
    }

    for (const change of diff.channelsChanged) {
      md += `### [CHANGED] ${change.channelName}\n`;

      for (const added of change.overwritesAdded) {
        md += `- **Overwrite Added** for \`${added.targetId}\`\n`;
        if (added.allow.length > 0) md += `  - Allow: ${added.allow.join(", ")}\n`;
        if (added.deny.length > 0) md += `  - Deny: ${added.deny.join(", ")}\n`;
      }

      for (const removed of change.overwritesRemoved) {
        md += `- **Overwrite Removed** for \`${removed.targetId}\`\n`;
      }

      for (const mod of change.overwritesModified) {
        md += `- **Overwrite Modified** for \`${mod.targetId}\`\n`;
        if (mod.allowAdded.length > 0) md += `  - Allow Added: ${mod.allowAdded.join(", ")}\n`;
        if (mod.allowRemoved.length > 0)
          md += `  - Allow Removed: ${mod.allowRemoved.join(", ")}\n`;
        if (mod.denyAdded.length > 0) md += `  - Deny Added: ${mod.denyAdded.join(", ")}\n`;
        if (mod.denyRemoved.length > 0) md += `  - Deny Removed: ${mod.denyRemoved.join(", ")}\n`;
      }
      md += `\n`;
    }
  }

  // Issue changes
  if (diff.issuesNew.length > 0 || diff.issuesResolved.length > 0) {
    md += `## Issue Changes\n\n`;

    for (const issue of diff.issuesNew) {
      md += `### [NEW] ${issue.severity.toUpperCase()}: ${issue.title}\n`;
      md += `- Target: ${issue.targetName}\n`;
      md += `- ${issue.description}\n\n`;
    }

    for (const issue of diff.issuesResolved) {
      md += `### [RESOLVED] ${issue.severity.toUpperCase()}: ${issue.title}\n`;
      md += `- Target: ${issue.targetName}\n\n`;
    }
  }

  md += `---\n\n`;
  md += `*Generated by Pawtropolis Tech security audit system*\n`;

  return md;
}

/**
 * Check if a diff has any meaningful changes worth reporting.
 */
export function hasMeaningfulChanges(diff: SnapshotDiff): boolean {
  return (
    diff.summary.rolesModified > 0 ||
    diff.summary.channelsModified > 0 ||
    diff.summary.issuesNew > 0 ||
    diff.summary.issuesResolved > 0
  );
}
