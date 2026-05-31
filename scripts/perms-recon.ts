// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * scripts/perms-recon.ts
 *
 * WHAT: One-shot pre-verification scammer access recon. Uses the bot's
 *       Administrator permissions (REST-only, no gateway login) to enumerate
 *       every channel + role + permission overwrite in a target guild,
 *       compute effective permissions for unverified vs verified users on
 *       every channel, run 8 threat-vector checks, and write a markdown
 *       report.
 *
 * WHY:  Scammers are DMing users before they complete the verification gate.
 *       The bot's gate flow only controls Discord *role* assignment — it
 *       cannot block one server member from DMing another. The scammers must
 *       be DISCOVERING targets through some misconfigured channel, role,
 *       system message, or third-party bot inside the guild. This script
 *       hunts for that discovery vector.
 *
 * USAGE: npx tsx scripts/perms-recon.ts [--guild <id>]
 *
 * OUTPUT: _recon/perms-recon-<guildId>-<timestamp>.md  (gitignored)
 *
 * SAFETY: This script is READ-ONLY. It does NOT modify Discord state, the
 *         DB, or any files outside _recon/. It does NOT push findings to
 *         GitHub (the existing serverAuditDocs.commitAndPushDocs path is
 *         deliberately not used).
 */

import "dotenv/config";
import { REST, Routes, PermissionFlagsBits, ChannelType } from "discord.js";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

// ============================================================================
// Minimal Discord API types (script is self-contained — no discord-api-types)
// ============================================================================

interface Overwrite {
  id: string;
  type: number; // 0 = role, 1 = member
  allow: string;
  deny: string;
}

interface Role {
  id: string;
  name: string;
  permissions: string;
  position: number;
  color: number;
  managed: boolean;
  mentionable: boolean;
  hoist: boolean;
  tags?: { bot_id?: string; integration_id?: string };
}

interface Channel {
  id: string;
  name: string;
  type: number;
  position?: number;
  parent_id?: string | null;
  permission_overwrites?: Overwrite[];
  topic?: string | null;
  nsfw?: boolean;
}

interface Guild {
  id: string;
  name: string;
  owner_id: string;
  system_channel_id?: string | null;
  system_channel_flags: number;
  features: string[];
  verification_level: number;
  default_message_notifications: number;
  explicit_content_filter: number;
  vanity_url_code?: string | null;
  premium_tier: number;
  approximate_member_count?: number;
}

interface GuildMember {
  user: { id: string; username: string; bot?: boolean };
  roles: string[];
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_CHANNEL_FLAGS = {
  SUPPRESS_JOIN_NOTIFICATIONS: 1 << 0,
  SUPPRESS_PREMIUM_SUBSCRIPTIONS: 1 << 1,
  SUPPRESS_GUILD_REMINDER_NOTIFICATIONS: 1 << 2,
  SUPPRESS_JOIN_NOTIFICATION_REPLIES: 1 << 3,
} as const;

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  10: "announcement_thread",
  11: "public_thread",
  12: "private_thread",
  13: "stage",
  15: "forum",
  16: "media",
};

const VERIFICATION_LEVEL_NAMES: Record<number, string> = {
  0: "NONE",
  1: "LOW (verified email)",
  2: "MEDIUM (registered >5 minutes)",
  3: "HIGH (member of guild >10 minutes)",
  4: "VERY_HIGH (verified phone number)",
};

const DEFAULT_NOTIFICATIONS_NAMES: Record<number, string> = {
  0: "ALL_MESSAGES",
  1: "ONLY_MENTIONS",
};

const EXPLICIT_FILTER_NAMES: Record<number, string> = {
  0: "DISABLED",
  1: "MEMBERS_WITHOUT_ROLES",
  2: "ALL_MEMBERS",
};

// ============================================================================
// Permission resolution
// ============================================================================

function effectivePermsForRoleSet(
  channel: Channel,
  roleIds: string[],
  allRoles: Map<string, Role>,
  guildId: string
): bigint {
  // Cumulative base permissions = OR of role bitfields. @everyone always included.
  let perms = 0n;
  const everyoneRole = allRoles.get(guildId);
  if (everyoneRole) perms |= BigInt(everyoneRole.permissions);
  for (const roleId of roleIds) {
    if (roleId === guildId) continue;
    const role = allRoles.get(roleId);
    if (role) perms |= BigInt(role.permissions);
  }

  // Administrator short-circuit → all permissions
  if ((perms & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
    // Return a very wide bitfield. Concrete bits matter for our checks.
    return (1n << 53n) - 1n;
  }

  // Apply @everyone overwrite first (deny → allow)
  const everyoneOverwrite = channel.permission_overwrites?.find(
    (o) => o.id === guildId && o.type === 0
  );
  if (everyoneOverwrite) {
    perms &= ~BigInt(everyoneOverwrite.deny);
    perms |= BigInt(everyoneOverwrite.allow);
  }

  // Apply role overwrites cumulatively (all denies first, then all allows)
  let cumulativeAllow = 0n;
  let cumulativeDeny = 0n;
  const relevantRoleIds = new Set([...roleIds, guildId]);
  for (const overwrite of channel.permission_overwrites ?? []) {
    if (overwrite.type !== 0) continue; // skip member overwrites
    if (overwrite.id === guildId) continue; // already applied above
    if (!relevantRoleIds.has(overwrite.id)) continue;
    cumulativeAllow |= BigInt(overwrite.allow);
    cumulativeDeny |= BigInt(overwrite.deny);
  }
  perms &= ~cumulativeDeny;
  perms |= cumulativeAllow;

  return perms;
}

function hasPerm(perms: bigint, flag: bigint): boolean {
  return (perms & flag) === flag;
}

function decodeSystemChannelFlags(flags: number): string[] {
  const out: string[] = [];
  for (const [name, bit] of Object.entries(SYSTEM_CHANNEL_FLAGS)) {
    if ((flags & bit) !== 0) out.push(name);
  }
  return out;
}

// ============================================================================
// REST helpers
// ============================================================================

async function fetchAllMembers(rest: REST, guildId: string): Promise<GuildMember[]> {
  const all: GuildMember[] = [];
  let after = "0";
  while (true) {
    const page = (await rest.get(Routes.guildMembers(guildId), {
      query: new URLSearchParams({ limit: "1000", after }),
    })) as GuildMember[];
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1]!.user.id;
    // Pace ourselves on the per-guild rate limit
    await new Promise((r) => setTimeout(r, 1100));
  }
  return all;
}

// ============================================================================
// Gate config loader (best-effort, falls back to null if DB unavailable)
// ============================================================================

interface GateConfig {
  accepted_role_id: string | null;
  gate_channel_id: string | null;
  review_channel_id: string | null;
  unverified_channel_id: string | null;
  general_channel_id: string | null;
  rules_channel_id: string | null;
  mod_role_ids: string[];
}

function loadGateConfig(guildId: string): GateConfig | null {
  const dbPath = path.resolve(process.env.DB_PATH ?? "./data/data.db");
  if (!existsSync(dbPath)) {
    console.warn(`[recon] DB not found at ${dbPath}, gate config will be omitted`);
    return null;
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT gate_channel_id, accepted_role_id, review_channel_id,
                unverified_channel_id, general_channel_id, rules_channel_id,
                mod_role_ids
           FROM guild_config WHERE guild_id = ?`
      )
      .get(guildId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      accepted_role_id: (row.accepted_role_id as string | null) ?? null,
      gate_channel_id: (row.gate_channel_id as string | null) ?? null,
      review_channel_id: (row.review_channel_id as string | null) ?? null,
      unverified_channel_id: (row.unverified_channel_id as string | null) ?? null,
      general_channel_id: (row.general_channel_id as string | null) ?? null,
      rules_channel_id: (row.rules_channel_id as string | null) ?? null,
      mod_role_ids:
        typeof row.mod_role_ids === "string"
          ? row.mod_role_ids
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [],
    };
  } finally {
    db.close();
  }
}

// ============================================================================
// Recon
// ============================================================================

interface AttackVector {
  id: number;
  name: string;
  status: "PRESENT" | "NOT_PRESENT" | "UNKNOWN";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
}

interface ReconResult {
  guild: Guild;
  roles: Role[];
  channels: Channel[];
  bots: GuildMember[];
  gateConfig: GateConfig | null;
  unverifiedViewableChannels: Array<{ channel: Channel; expected: boolean; reason: string }>;
  systemChannelAnalysis: {
    channelId: string | null;
    channelName: string | null;
    joinNotificationsSuppressed: boolean;
    viewableByUnverified: boolean;
    risk: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  };
  guildFeaturesAudit: {
    features: string[];
    memberScreeningEnabled: boolean;
    discoverableEnabled: boolean;
    welcomeScreenEnabled: boolean;
  };
  elevatedBots: Array<{ member: GuildMember; perms: bigint; flags: string[] }>;
  attackVectors: AttackVector[];
}

async function runRecon(rest: REST, guildId: string): Promise<ReconResult> {
  console.log(`[recon] fetching guild ${guildId} ...`);
  const [guild, roles, channels] = await Promise.all([
    rest.get(Routes.guild(guildId), {
      query: new URLSearchParams({ with_counts: "true" }),
    }) as Promise<Guild>,
    rest.get(Routes.guildRoles(guildId)) as Promise<Role[]>,
    rest.get(Routes.guildChannels(guildId)) as Promise<Channel[]>,
  ]);
  console.log(
    `[recon] fetched guild=${guild.name} roles=${roles.length} channels=${channels.length} members=${guild.approximate_member_count ?? "?"}`
  );

  console.log("[recon] fetching members (paginated, can take ~10s for large guilds) ...");
  let members: GuildMember[] = [];
  try {
    members = await fetchAllMembers(rest, guildId);
  } catch (err) {
    console.warn("[recon] failed to fetch members (likely missing GUILD_MEMBERS intent or perms):", err);
  }
  const bots = members.filter((m) => m.user.bot === true);
  console.log(`[recon] members=${members.length} bots=${bots.length}`);

  const gateConfig = loadGateConfig(guildId);
  if (gateConfig) {
    console.log(
      `[recon] gate config: accepted_role=${gateConfig.accepted_role_id} gate_channel=${gateConfig.gate_channel_id}`
    );
  }

  const roleMap = new Map<string, Role>(roles.map((r) => [r.id, r]));
  const unverifiedRoleSet = [guildId];
  const verifiedRoleSet = gateConfig?.accepted_role_id
    ? [guildId, gateConfig.accepted_role_id]
    : [guildId];

  const expectedVisibleIds = new Set<string>(
    [
      gateConfig?.gate_channel_id,
      gateConfig?.rules_channel_id,
      gateConfig?.unverified_channel_id,
    ].filter((x): x is string => Boolean(x))
  );

  // Walk every non-category channel and determine if @everyone-only sees it
  const unverifiedViewableChannels: ReconResult["unverifiedViewableChannels"] = [];
  for (const channel of channels) {
    if (channel.type === ChannelType.GuildCategory) continue;
    const perms = effectivePermsForRoleSet(channel, unverifiedRoleSet, roleMap, guildId);
    if (hasPerm(perms, PermissionFlagsBits.ViewChannel)) {
      const expected = expectedVisibleIds.has(channel.id);
      unverifiedViewableChannels.push({
        channel,
        expected,
        reason: expected
          ? "expected (gate/rules/unverified channel)"
          : "UNEXPECTED — unverified users can see this channel",
      });
    }
  }

  // System channel analysis
  const sysChannelId = guild.system_channel_id ?? null;
  const sysChannel = sysChannelId ? channels.find((c) => c.id === sysChannelId) ?? null : null;
  const joinNotifSuppressed =
    (guild.system_channel_flags & SYSTEM_CHANNEL_FLAGS.SUPPRESS_JOIN_NOTIFICATIONS) !== 0;
  let sysViewable = false;
  if (sysChannel) {
    const sysPerms = effectivePermsForRoleSet(sysChannel, unverifiedRoleSet, roleMap, guildId);
    sysViewable = hasPerm(sysPerms, PermissionFlagsBits.ViewChannel);
  }
  let sysRisk: ReconResult["systemChannelAnalysis"]["risk"] = "NONE";
  if (sysChannelId && !joinNotifSuppressed && sysViewable) sysRisk = "CRITICAL";
  else if (sysChannelId && !joinNotifSuppressed) sysRisk = "MEDIUM";
  else if (sysViewable) sysRisk = "LOW";

  const systemChannelAnalysis: ReconResult["systemChannelAnalysis"] = {
    channelId: sysChannelId,
    channelName: sysChannel?.name ?? null,
    joinNotificationsSuppressed: joinNotifSuppressed,
    viewableByUnverified: sysViewable,
    risk: sysRisk,
  };

  // Guild features audit
  const guildFeaturesAudit: ReconResult["guildFeaturesAudit"] = {
    features: guild.features,
    memberScreeningEnabled: guild.features.includes("MEMBER_VERIFICATION_GATE_ENABLED"),
    discoverableEnabled: guild.features.includes("DISCOVERABLE"),
    welcomeScreenEnabled: guild.features.includes("WELCOME_SCREEN_ENABLED"),
  };

  // Elevated bot enumeration
  const elevatedBots: ReconResult["elevatedBots"] = [];
  for (const bot of bots) {
    let totalPerms = 0n;
    const everyoneRole = roleMap.get(guildId);
    if (everyoneRole) totalPerms |= BigInt(everyoneRole.permissions);
    for (const roleId of bot.roles) {
      const role = roleMap.get(roleId);
      if (role) totalPerms |= BigInt(role.permissions);
    }
    const flags: string[] = [];
    if (hasPerm(totalPerms, PermissionFlagsBits.Administrator)) flags.push("**ADMINISTRATOR**");
    if (hasPerm(totalPerms, PermissionFlagsBits.ManageGuild)) flags.push("ManageGuild");
    if (hasPerm(totalPerms, PermissionFlagsBits.ManageChannels)) flags.push("ManageChannels");
    if (hasPerm(totalPerms, PermissionFlagsBits.ManageRoles)) flags.push("ManageRoles");
    if (hasPerm(totalPerms, PermissionFlagsBits.KickMembers)) flags.push("Kick");
    if (hasPerm(totalPerms, PermissionFlagsBits.BanMembers)) flags.push("Ban");
    if (hasPerm(totalPerms, PermissionFlagsBits.MentionEveryone)) flags.push("MentionEveryone");
    if (flags.length > 0) {
      elevatedBots.push({ member: bot, perms: totalPerms, flags });
    }
  }

  // Forum channel analysis
  const forumChannels = channels.filter((c) => c.type === ChannelType.GuildForum);
  const visibleForums = forumChannels.filter((c) =>
    hasPerm(
      effectivePermsForRoleSet(c, unverifiedRoleSet, roleMap, guildId),
      PermissionFlagsBits.ViewChannel
    )
  );

  // ─── Attack vectors ──────────────────────────────────────────
  const suspiciousVisible = unverifiedViewableChannels.filter((c) => !c.expected);

  const attackVectors: AttackVector[] = [
    {
      id: 1,
      name: "System channel join messages visible to unverified",
      status: sysRisk === "CRITICAL" ? "PRESENT" : sysRisk === "NONE" ? "NOT_PRESENT" : "UNKNOWN",
      severity: "CRITICAL",
      evidence: sysChannelId
        ? `system_channel=${sysChannel?.name ?? sysChannelId}, joinNotifSuppressed=${joinNotifSuppressed}, viewableByUnverified=${sysViewable}`
        : "no system channel configured",
    },
    {
      id: 2,
      name: "Member-list disclosure on @everyone-viewable channels",
      status: suspiciousVisible.length > 0 ? "PRESENT" : "NOT_PRESENT",
      severity: "CRITICAL",
      evidence:
        suspiciousVisible.length > 0
          ? `${suspiciousVisible.length} channels visible to unverified that aren't gate/rules/unverified: ` +
            suspiciousVisible.slice(0, 5).map((c) => c.channel.name).join(", ") +
            (suspiciousVisible.length > 5 ? `, ... (+${suspiciousVisible.length - 5} more)` : "")
          : "all unverified-visible channels are expected (gate/rules/unverified)",
    },
    {
      id: 3,
      name: "Discord built-in member screening (rules screening)",
      status: guildFeaturesAudit.memberScreeningEnabled ? "NOT_PRESENT" : "PRESENT",
      severity: "HIGH",
      evidence: guildFeaturesAudit.memberScreeningEnabled
        ? "MEMBER_VERIFICATION_GATE_ENABLED is on (good — pending users are invisible to all members until they accept rules)"
        : "MEMBER_VERIFICATION_GATE_ENABLED is OFF — joiners are immediately added to the member list and visible to all members",
    },
    {
      id: 4,
      name: "Server Discovery enabled",
      status: guildFeaturesAudit.discoverableEnabled ? "PRESENT" : "NOT_PRESENT",
      severity: "MEDIUM",
      evidence: guildFeaturesAudit.discoverableEnabled
        ? "DISCOVERABLE feature is on — server is publicly listed; receives higher scammer enrollment"
        : "Server is not in Discord Discovery",
    },
    {
      id: 5,
      name: "Welcome screen channels",
      status: guildFeaturesAudit.welcomeScreenEnabled ? "UNKNOWN" : "NOT_PRESENT",
      severity: "MEDIUM",
      evidence: guildFeaturesAudit.welcomeScreenEnabled
        ? "WELCOME_SCREEN_ENABLED — manually verify the channels listed in the welcome screen are gate-only"
        : "Welcome screen is not enabled",
    },
    {
      id: 6,
      name: "Default cross-member DM permission (Discord-wide)",
      status: "PRESENT",
      severity: "HIGH",
      evidence:
        "Discord allows DMs between any two users in the same guild by default. This is a per-recipient User Setting (Privacy & Safety → Allow direct messages from server members) that CANNOT be set server-wide via API. Mitigation: verification level HIGHEST (phone required) and instructing users to disable the per-user setting.",
    },
    {
      id: 7,
      name: "Bot users with elevated permissions",
      status: elevatedBots.length > 0 ? "PRESENT" : "NOT_PRESENT",
      severity: "MEDIUM",
      evidence:
        elevatedBots.length > 0
          ? `${elevatedBots.length} bots with elevated perms: ` +
            elevatedBots.slice(0, 5).map((b) => b.member.user.username).join(", ")
          : "no bots with Admin / ManageGuild / ManageChannels / ManageRoles",
    },
    {
      id: 8,
      name: "Forum channels visible to unverified",
      status:
        visibleForums.length > 0 && visibleForums.some((f) => !expectedVisibleIds.has(f.id))
          ? "PRESENT"
          : "NOT_PRESENT",
      severity: "HIGH",
      evidence:
        visibleForums.length > 0
          ? `${visibleForums.length} forum channels visible to unverified: ` +
            visibleForums.map((f) => f.name).join(", ")
          : "no forum channels visible to unverified",
    },
  ];

  return {
    guild,
    roles,
    channels,
    bots,
    gateConfig,
    unverifiedViewableChannels,
    systemChannelAnalysis,
    guildFeaturesAudit,
    elevatedBots,
    attackVectors,
  };
}

// ============================================================================
// Markdown rendering
// ============================================================================

function rankAttackVectors(vectors: AttackVector[]): AttackVector[] {
  const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const statusOrder: Record<string, number> = { PRESENT: 0, UNKNOWN: 1, NOT_PRESENT: 2 };
  return [...vectors].sort((a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status]! - statusOrder[b.status]!;
    }
    return sevOrder[a.severity]! - sevOrder[b.severity]!;
  });
}

function renderMarkdown(result: ReconResult): string {
  const lines: string[] = [];
  const guildId = result.guild.id;
  const roleMap = new Map(result.roles.map((r) => [r.id, r]));
  const verifiedRoleSet = result.gateConfig?.accepted_role_id
    ? [guildId, result.gateConfig.accepted_role_id]
    : [guildId];
  const ranked = rankAttackVectors(result.attackVectors);
  // Derived sets used by sections 6, 8, 11
  const expectedVisibleIds = new Set<string>(
    [
      result.gateConfig?.gate_channel_id,
      result.gateConfig?.rules_channel_id,
      result.gateConfig?.unverified_channel_id,
    ].filter((x): x is string => Boolean(x))
  );
  const visibleForums = result.channels.filter(
    (c) =>
      c.type === ChannelType.GuildForum &&
      hasPerm(
        effectivePermsForRoleSet(c, [guildId], roleMap, guildId),
        PermissionFlagsBits.ViewChannel
      )
  );

  lines.push(`# Pre-verification scammer access recon`);
  lines.push(`**Guild:** ${result.guild.name} (\`${guildId}\`)`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Tool:** scripts/perms-recon.ts (read-only, REST-only, no Discord state changes)`);
  lines.push("");

  // 1. Executive summary
  lines.push(`## 1. Executive summary`);
  lines.push("");
  for (const v of ranked.slice(0, 5)) {
    const icon = v.status === "PRESENT" ? "🔴" : v.status === "UNKNOWN" ? "🟡" : "✅";
    lines.push(`- ${icon} **[${v.severity}] ${v.status}** — V${v.id}: ${v.name}`);
  }
  lines.push("");

  // 2. Guild metadata
  lines.push(`## 2. Guild metadata`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Name | ${result.guild.name} |`);
  lines.push(`| ID | \`${guildId}\` |`);
  lines.push(`| Owner ID | \`${result.guild.owner_id}\` |`);
  lines.push(`| Member count (approx) | ${result.guild.approximate_member_count ?? "?"} |`);
  lines.push(
    `| Verification level | ${VERIFICATION_LEVEL_NAMES[result.guild.verification_level] ?? result.guild.verification_level} |`
  );
  lines.push(
    `| Default notifications | ${DEFAULT_NOTIFICATIONS_NAMES[result.guild.default_message_notifications] ?? result.guild.default_message_notifications} |`
  );
  lines.push(
    `| Explicit content filter | ${EXPLICIT_FILTER_NAMES[result.guild.explicit_content_filter] ?? result.guild.explicit_content_filter} |`
  );
  lines.push(`| Premium tier | ${result.guild.premium_tier} |`);
  lines.push(`| Vanity URL | ${result.guild.vanity_url_code ?? "(none)"} |`);
  lines.push(
    `| System channel ID | ${result.guild.system_channel_id ? `\`${result.guild.system_channel_id}\`` : "(none)"} |`
  );
  const sysFlagsDecoded = decodeSystemChannelFlags(result.guild.system_channel_flags);
  lines.push(
    `| System channel flags | ${result.guild.system_channel_flags} (${sysFlagsDecoded.join(", ") || "no flags set"}) |`
  );
  lines.push("");

  // 3. Gate config
  lines.push(`## 3. Gate configuration`);
  lines.push("");
  if (result.gateConfig) {
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(
      `| Accepted role ID | ${result.gateConfig.accepted_role_id ? `\`${result.gateConfig.accepted_role_id}\`` : "(none)"} |`
    );
    lines.push(
      `| Gate channel ID | ${result.gateConfig.gate_channel_id ? `\`${result.gateConfig.gate_channel_id}\`` : "(none)"} |`
    );
    lines.push(
      `| Review channel ID | ${result.gateConfig.review_channel_id ? `\`${result.gateConfig.review_channel_id}\`` : "(none)"} |`
    );
    lines.push(
      `| Unverified channel ID | ${result.gateConfig.unverified_channel_id ? `\`${result.gateConfig.unverified_channel_id}\`` : "(none)"} |`
    );
    lines.push(
      `| General channel ID | ${result.gateConfig.general_channel_id ? `\`${result.gateConfig.general_channel_id}\`` : "(none)"} |`
    );
    lines.push(
      `| Rules channel ID | ${result.gateConfig.rules_channel_id ? `\`${result.gateConfig.rules_channel_id}\`` : "(none)"} |`
    );
    lines.push(`| Mod role IDs (count) | ${result.gateConfig.mod_role_ids.length} |`);
  } else {
    lines.push(`(gate config not available — DB not loaded)`);
  }
  lines.push("");

  // 4. Roles inventory
  lines.push(`## 4. Roles inventory (${result.roles.length} roles)`);
  lines.push("");
  lines.push(
    `| Pos | ID | Name | Admin | ManageGuild | ManageRoles | Kick | Ban | MentionEveryone | Managed |`
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
  const sortedRoles = [...result.roles].sort((a, b) => b.position - a.position);
  for (const r of sortedRoles) {
    const p = BigInt(r.permissions);
    const c = (flag: bigint) => (hasPerm(p, flag) ? "✅" : "");
    lines.push(
      `| ${r.position} | \`${r.id}\` | ${r.name} | ${c(PermissionFlagsBits.Administrator)} | ${c(PermissionFlagsBits.ManageGuild)} | ${c(PermissionFlagsBits.ManageRoles)} | ${c(PermissionFlagsBits.KickMembers)} | ${c(PermissionFlagsBits.BanMembers)} | ${c(PermissionFlagsBits.MentionEveryone)} | ${r.managed ? "✅" : ""} |`
    );
  }
  lines.push("");

  // 5. Channels inventory
  lines.push(`## 5. Channels inventory (${result.channels.length} channels)`);
  lines.push("");
  lines.push(
    `Legend: 🔴 = unverified user has the perm (potential leak), ✅ = verified user has the perm, ⚫ = not granted.`
  );
  lines.push("");
  const childsByCategory = new Map<string | null, Channel[]>();
  for (const c of result.channels) {
    if (c.type === ChannelType.GuildCategory) continue;
    const parentId = c.parent_id ?? null;
    if (!childsByCategory.has(parentId)) childsByCategory.set(parentId, []);
    childsByCategory.get(parentId)!.push(c);
  }
  const categories = result.channels
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const cat of categories) {
    lines.push(`### Category: ${cat.name} (\`${cat.id}\`)`);
    const childs = (childsByCategory.get(cat.id) ?? []).sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );
    if (childs.length === 0) {
      lines.push(`(no channels)`);
      lines.push("");
      continue;
    }
    lines.push(
      `| Channel | Type | Unv View | Unv Read | Unv Send | Ver View | Ver Send |`
    );
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const c of childs) {
      const u = effectivePermsForRoleSet(c, [guildId], roleMap, guildId);
      const v = effectivePermsForRoleSet(c, verifiedRoleSet, roleMap, guildId);
      const cell = (perms: bigint, flag: bigint, leakIcon = "🔴") =>
        hasPerm(perms, flag) ? leakIcon : "⚫";
      lines.push(
        `| ${c.name} | ${CHANNEL_TYPE_NAMES[c.type] ?? c.type} | ${cell(u, PermissionFlagsBits.ViewChannel)} | ${cell(u, PermissionFlagsBits.ReadMessageHistory)} | ${cell(u, PermissionFlagsBits.SendMessages)} | ${cell(v, PermissionFlagsBits.ViewChannel, "✅")} | ${cell(v, PermissionFlagsBits.SendMessages, "✅")} |`
      );
    }
    lines.push("");
  }

  const orphans = childsByCategory.get(null) ?? [];
  if (orphans.length > 0) {
    lines.push(`### (uncategorized)`);
    lines.push(`| Channel | Type | Unv View | Ver View |`);
    lines.push(`|---|---|---|---|`);
    for (const c of orphans.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      const u = effectivePermsForRoleSet(c, [guildId], roleMap, guildId);
      const v = effectivePermsForRoleSet(c, verifiedRoleSet, roleMap, guildId);
      lines.push(
        `| ${c.name} | ${CHANNEL_TYPE_NAMES[c.type] ?? c.type} | ${hasPerm(u, PermissionFlagsBits.ViewChannel) ? "🔴" : "⚫"} | ${hasPerm(v, PermissionFlagsBits.ViewChannel) ? "✅" : "⚫"} |`
      );
    }
    lines.push("");
  }

  // 6. Channels visible to unverified
  lines.push(`## 6. Channels visible to unverified users`);
  lines.push("");
  lines.push(`Total: **${result.unverifiedViewableChannels.length}** channels.`);
  lines.push("");
  if (result.unverifiedViewableChannels.length > 0) {
    lines.push(`| Channel | ID | Type | Status | Reason |`);
    lines.push(`|---|---|---|---|---|`);
    for (const v of result.unverifiedViewableChannels) {
      const tag = v.expected ? "✅ EXPECTED" : "🔴 SUSPICIOUS";
      lines.push(
        `| ${v.channel.name} | \`${v.channel.id}\` | ${CHANNEL_TYPE_NAMES[v.channel.type] ?? v.channel.type} | ${tag} | ${v.reason} |`
      );
    }
  }
  lines.push("");

  // 7. Bot inventory
  lines.push(`## 7. Bot inventory (${result.bots.length} bots)`);
  lines.push("");
  if (result.bots.length === 0) {
    lines.push(`(no bot members fetched — may indicate missing GUILD_MEMBERS intent or fetch failure)`);
  } else {
    lines.push(`| Bot | ID | Roles | Cumulative key perms |`);
    lines.push(`|---|---|---|---|`);
    for (const bot of result.bots) {
      let totalPerms = 0n;
      const er = roleMap.get(guildId);
      if (er) totalPerms |= BigInt(er.permissions);
      for (const roleId of bot.roles) {
        const role = roleMap.get(roleId);
        if (role) totalPerms |= BigInt(role.permissions);
      }
      const flags: string[] = [];
      if (hasPerm(totalPerms, PermissionFlagsBits.Administrator)) flags.push("**ADMIN**");
      if (hasPerm(totalPerms, PermissionFlagsBits.ManageGuild)) flags.push("ManageGuild");
      if (hasPerm(totalPerms, PermissionFlagsBits.ManageChannels)) flags.push("ManageChannels");
      if (hasPerm(totalPerms, PermissionFlagsBits.ManageRoles)) flags.push("ManageRoles");
      if (hasPerm(totalPerms, PermissionFlagsBits.KickMembers)) flags.push("Kick");
      if (hasPerm(totalPerms, PermissionFlagsBits.BanMembers)) flags.push("Ban");
      if (hasPerm(totalPerms, PermissionFlagsBits.MentionEveryone)) flags.push("MentionEveryone");
      lines.push(
        `| ${bot.user.username} | \`${bot.user.id}\` | ${bot.roles.length} | ${flags.join(", ") || "(none)"} |`
      );
    }
  }
  lines.push("");

  // 8. System message channel analysis
  lines.push(`## 8. System message channel analysis`);
  lines.push("");
  const sca = result.systemChannelAnalysis;
  lines.push(
    `- **System channel:** ${sca.channelName ? `\`${sca.channelName}\` (\`${sca.channelId}\`)` : "(none)"}`
  );
  lines.push(`- **Join notifications suppressed:** ${sca.joinNotificationsSuppressed ? "✅ YES" : "🔴 NO"}`);
  lines.push(`- **Viewable by unverified users:** ${sca.viewableByUnverified ? "🔴 YES" : "✅ NO"}`);
  lines.push(`- **Risk:** **${sca.risk}**`);
  lines.push("");
  if (sca.risk === "CRITICAL") {
    lines.push(
      `> ⚠️ **THIS IS THE MOST LIKELY SCAMMER VECTOR.** When a user joins, Discord posts a "X joined the server" message in this channel. Scammers (also unverified) see this in real time and DM the new user within seconds. **Fix immediately:** Server Settings → Overview → System Messages Channel → either move it to a verified-only channel, OR uncheck "Send a random welcome message when someone joins this server".`
    );
  } else if (sca.risk === "MEDIUM") {
    lines.push(`> ℹ️ Join notifications are not suppressed but the channel isn't viewable by unverified users. Lower risk.`);
  } else if (sca.risk === "NONE") {
    lines.push(`> ✅ This vector is closed.`);
  }
  lines.push("");

  // 9. Guild features audit
  lines.push(`## 9. Guild features audit`);
  lines.push("");
  lines.push(`**Features array:** \`${result.guild.features.join(", ") || "(none)"}\``);
  lines.push("");
  lines.push(`| Feature | Status | Note |`);
  lines.push(`|---|---|---|`);
  lines.push(
    `| Member screening (rules screening) | ${result.guildFeaturesAudit.memberScreeningEnabled ? "✅ ON" : "🔴 OFF"} | ${result.guildFeaturesAudit.memberScreeningEnabled ? "joiners are pending — invisible to other members until they accept rules" : "**RECOMMEND ENABLING.** Without this, joiners are immediately visible in the member list to all users including scammers."} |`
  );
  lines.push(
    `| Server Discovery | ${result.guildFeaturesAudit.discoverableEnabled ? "🔴 ON" : "✅ OFF"} | ${result.guildFeaturesAudit.discoverableEnabled ? "Server is publicly discoverable; receives higher scammer enrollment" : "Not publicly discoverable"} |`
  );
  lines.push(
    `| Welcome screen | ${result.guildFeaturesAudit.welcomeScreenEnabled ? "ℹ️ ON" : "✅ OFF"} | ${result.guildFeaturesAudit.welcomeScreenEnabled ? "Manually verify the channels listed in the welcome screen are gate-only" : ""} |`
  );
  lines.push("");

  // 10. Ranked attack vectors
  lines.push(`## 10. Ranked attack vectors`);
  lines.push("");
  for (const v of ranked) {
    const icon = v.status === "PRESENT" ? "🔴" : v.status === "UNKNOWN" ? "🟡" : "✅";
    lines.push(`### ${icon} V${v.id}: ${v.name}`);
    lines.push(`- **Status:** ${v.status}`);
    lines.push(`- **Severity:** ${v.severity}`);
    lines.push(`- **Evidence:** ${v.evidence}`);
    lines.push("");
  }

  // 11. Remediation checklist
  lines.push(`## 11. Remediation checklist`);
  lines.push("");
  lines.push(`In priority order:`);
  lines.push("");
  let step = 1;
  if (sca.risk === "CRITICAL") {
    lines.push(
      `${step++}. **[CRITICAL] Suppress join notifications in the system channel.** Server Settings → Overview → uncheck "Send a random welcome message when someone joins this server" — OR move System Messages Channel to a verified-only channel. This is the single most likely vector for instant-DM-after-join scams.`
    );
  }
  if (!result.guildFeaturesAudit.memberScreeningEnabled) {
    lines.push(
      `${step++}. **[HIGH] Enable Discord's built-in rules screening.** Server Settings → Safety Setup → Member screening. Configure a rules screen that joiners must accept before being added to the guild member list. While in pending state, users are INVISIBLE to other members — scammers can't discover them at all. This is the strongest mitigation for the entire scammer-DM problem.`
    );
  }
  const suspiciousVisible = result.unverifiedViewableChannels.filter((c) => !c.expected);
  if (suspiciousVisible.length > 0) {
    lines.push(
      `${step++}. **[CRITICAL] Restrict @everyone ViewChannel on these ${suspiciousVisible.length} channels:** ${suspiciousVisible.map((c) => `\`${c.channel.name}\` (\`${c.channel.id}\`)`).join(", ")}. For each: Channel → Edit → Permissions → @everyone → set View Channel to ❌. Verified users (with the accepted role) will still see them via their role overwrite.`
    );
  }
  lines.push(
    `${step++}. **[HIGH] Document the user-side DM mitigation.** Discord cannot block DMs between guild members server-wide. The only mitigation is per-user: each user sets User Settings → Privacy & Safety → "Allow direct messages from server members" to OFF. Consider adding this to the gate flow's confirmation message so new joiners see it immediately after verification.`
  );
  lines.push(
    `${step++}. **[MEDIUM] Set Discord verification level to HIGH or HIGHEST.** Server Settings → Safety Setup → Verification Level. HIGH requires the user to be a member of the guild for >10 minutes before posting. HIGHEST adds a phone-number requirement, which kills disposable scammer accounts.`
  );
  if (visibleForums.length > 0 && visibleForums.some((f) => !expectedVisibleIds.has(f.id))) {
    const suspectForums = visibleForums.filter((f) => !expectedVisibleIds.has(f.id));
    lines.push(
      `${step++}. **[HIGH] Audit forum channels visible to unverified users.** Forums display thread author names and member counts that scammers can scrape: ${suspectForums.map((f) => `\`${f.name}\``).join(", ")}.`
    );
  }
  if (result.guildFeaturesAudit.discoverableEnabled) {
    lines.push(
      `${step++}. **[MEDIUM] Review Server Discovery settings.** If you don't actively want to be in discovery, disable it in Server Settings → Discovery. Discoverable servers receive higher scammer enrollment rates.`
    );
  }
  if (result.elevatedBots.length > 0) {
    lines.push(
      `${step++}. **[MEDIUM] Audit bot permissions.** ${result.elevatedBots.length} bots have ManageGuild/ManageChannels/ManageRoles or Administrator. For each: confirm the bot is one you trust AND that its slash commands aren't accessible to unverified users. Bots: ${result.elevatedBots.map((b) => b.member.user.username).join(", ")}.`
    );
  }
  lines.push("");
  lines.push(`---`);
  lines.push(
    `*Generated by scripts/perms-recon.ts. This report is gitignored and contains user/channel IDs — do not share publicly.*`
  );

  return lines.join("\n");
}

// ============================================================================
// CLI entry point
// ============================================================================

async function main() {
  const argv = process.argv.slice(2);
  let guildId = process.env.GUILD_ID ?? "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--guild" && argv[i + 1]) {
      guildId = argv[i + 1]!;
      i++;
    }
  }
  if (!guildId) {
    console.error("[recon] no guild id provided. Set GUILD_ID env var or use --guild <id>");
    process.exit(1);
  }
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("[recon] DISCORD_TOKEN env var is required");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const result = await runRecon(rest, guildId);

  const outDir = path.resolve("./_recon");
  await fs.mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const outFile = path.join(outDir, `perms-recon-${guildId}-${ts}.md`);
  await fs.writeFile(outFile, renderMarkdown(result), "utf8");

  console.log("");
  console.log("=========================================");
  console.log("EXECUTIVE SUMMARY");
  console.log("=========================================");
  for (const v of rankAttackVectors(result.attackVectors)) {
    console.log(`[${v.status}] [${v.severity}] V${v.id}: ${v.name}`);
    console.log(`    ${v.evidence}`);
  }
  console.log("");
  console.log(`Report: ${outFile}`);
  process.exit(0);
}

const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMainModule) {
  main().catch((err) => {
    console.error("[recon] fatal", err);
    process.exit(1);
  });
}
