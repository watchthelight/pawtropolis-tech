// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/types.ts
 * WHAT: Shared types for the GitHub-renderable Discord badge system.
 * WHY: GitHub Markdown cannot render <@&id>, <#id>, or <@id>. We resolve
 *      Discord entities to ResolvedBadge values, then render SVG pills
 *      that GitHub can embed via <img>.
 */

export type BadgeKind = "role" | "channel" | "user" | "custom";

export type BadgeStyle =
  | "discord-role"
  | "discord-channel"
  | "discord-user"
  | "discord-custom"
  | "compact"
  | "shield";

export type RoleGradient = {
  primary: string;
  secondary: string;
  tertiary?: string;
};

export type BadgeDefinition = {
  id: string;
  guildId: string;
  kind: BadgeKind;
  discordId?: string;
  label?: string;
  suffix?: string;
  style: BadgeStyle;
  linkUrl?: string;
  enabled: boolean;
  gradient?: RoleGradient;
  holographic?: boolean;
};

export type ResolvedBadge = {
  id: string;
  kind: BadgeKind;
  guildId: string;
  discordId?: string;
  displayName: string;
  prefix: "@" | "#" | "";
  suffix?: string;
  colorHex: string;
  backgroundHex: string;
  foregroundHex: string;
  linkUrl?: string;
  stale: boolean;
  resolvedAt: string;
  gradient?: RoleGradient;
  holographic?: boolean;
};

export type BadgeManifestEntry = ResolvedBadge & {
  style: BadgeStyle;
  url: string;
  generatedAt: string;
};

export type BadgeManifest = {
  schemaVersion: 1;
  baseUrl: string;
  generatedAt: string;
  entries: Record<string, BadgeManifestEntry>;
};
