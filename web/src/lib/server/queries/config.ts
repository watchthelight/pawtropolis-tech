import { db } from "$lib/server/db";

type ValueType =
  | "channel"
  | "role"
  | "roles"
  | "bool"
  | "ms"
  | "seconds"
  | "minutes"
  | "hours"
  | "chars"
  | "number"
  | "percent"
  | "json"
  | "text"
  | "template";

interface FieldMeta {
  label: string;
  type: ValueType;
}

export interface ConfigField {
  key: string;
  label: string;
  value: unknown;
  type: ValueType;
}

export interface ConfigSection {
  title: string;
  fields: ConfigField[];
}

/**
 * Column metadata: maps DB column names to display labels and value types.
 * Columns not listed here are placed in an "Other" section as plain text.
 */
const FIELD_META: Record<string, { section: string } & FieldMeta> = {
  // Channels & Logging
  review_channel_id: { section: "Channels", label: "Review Channel", type: "channel" },
  gate_channel_id: { section: "Channels", label: "Gate Channel", type: "channel" },
  general_channel_id: { section: "Channels", label: "General Channel", type: "channel" },
  unverified_channel_id: { section: "Channels", label: "Unverified Channel", type: "channel" },
  logging_channel_id: { section: "Channels", label: "Logging Channel", type: "channel" },
  notification_channel_id: { section: "Channels", label: "Notification Channel", type: "channel" },
  modmail_log_channel_id: { section: "Channels", label: "Modmail Log Channel", type: "channel" },
  support_channel_id: { section: "Channels", label: "Support Channel", type: "channel" },
  forum_channel_id: { section: "Channels", label: "Forum Channel", type: "channel" },
  report_forum_id: { section: "Channels", label: "Report Forum", type: "channel" },
  flags_channel_id: { section: "Channels", label: "Flags Channel", type: "channel" },
  info_channel_id: { section: "Channels", label: "Info Channel", type: "channel" },
  rules_channel_id: { section: "Channels", label: "Rules Channel", type: "channel" },
  backfill_notification_channel_id: {
    section: "Channels",
    label: "Backfill Notification Channel",
    type: "channel",
  },
  server_artist_channel_id: {
    section: "Channels",
    label: "Server Artist Channel",
    type: "channel",
  },

  // Roles
  accepted_role_id: { section: "Roles", label: "Accepted Role", type: "role" },
  reviewer_role_id: { section: "Roles", label: "Reviewer Role", type: "role" },
  gatekeeper_role_id: { section: "Roles", label: "Gatekeeper Role", type: "role" },
  leadership_role_id: { section: "Roles", label: "Leadership Role", type: "role" },
  bot_dev_role_id: { section: "Roles", label: "Bot Dev Role", type: "role" },
  notify_role_id: { section: "Roles", label: "Notify Role", type: "role" },
  welcome_ping_role_id: { section: "Roles", label: "Welcome Ping Role", type: "role" },
  artist_role_id: { section: "Roles", label: "Artist Role", type: "role" },
  ambassador_role_id: { section: "Roles", label: "Ambassador Role", type: "role" },
  nsfw_alert_role_id: { section: "Roles", label: "NSFW Alert Role", type: "role" },
  mod_role_ids: { section: "Roles", label: "Mod Roles", type: "roles" },

  // Gate Settings
  gate_answer_max_length: { section: "Gate", label: "Max Answer Length", type: "chars" },
  review_roles_mode: { section: "Gate", label: "Review Roles Mode", type: "text" },
  ping_dev_on_app: { section: "Gate", label: "Ping Dev on Application", type: "bool" },
  silent_first_msg_days: { section: "Gate", label: "Silent First Msg Days", type: "number" },
  reapply_cooldown_hours: { section: "Gate", label: "Reapply Cooldown", type: "hours" },
  min_account_age_hours: { section: "Gate", label: "Min Account Age", type: "hours" },
  min_join_age_hours: { section: "Gate", label: "Min Join Age", type: "hours" },
  listopen_public_output: { section: "Gate", label: "Listopen Public Output", type: "bool" },

  // Avatar Scanning
  avatar_scan_enabled: { section: "Avatar Scanning", label: "Scan Enabled", type: "bool" },
  avatar_scan_nsfw_threshold: {
    section: "Avatar Scanning",
    label: "NSFW Threshold",
    type: "percent",
  },
  avatar_scan_skin_edge_threshold: {
    section: "Avatar Scanning",
    label: "Skin Edge Threshold",
    type: "percent",
  },
  avatar_scan_weight_model: { section: "Avatar Scanning", label: "Model Weight", type: "percent" },
  avatar_scan_weight_edge: { section: "Avatar Scanning", label: "Edge Weight", type: "percent" },
  avatar_scan_hard_threshold: {
    section: "Avatar Scanning",
    label: "Hard Threshold",
    type: "percent",
  },
  avatar_scan_soft_threshold: {
    section: "Avatar Scanning",
    label: "Soft Threshold",
    type: "percent",
  },
  avatar_scan_racy_threshold: {
    section: "Avatar Scanning",
    label: "Racy Threshold",
    type: "percent",
  },

  // Notifications
  notify_mode: { section: "Notifications", label: "Notify Mode", type: "text" },
  notify_cooldown_seconds: { section: "Notifications", label: "Cooldown", type: "seconds" },
  notify_max_per_hour: { section: "Notifications", label: "Max Per Hour", type: "number" },

  // Artist Config
  artist_ticket_roles_json: { section: "Artist", label: "Ticket Roles", type: "json" },
  artist_ignored_users_json: { section: "Artist", label: "Ignored Users", type: "json" },

  // Modmail
  modmail_delete_on_close: { section: "Modmail", label: "Delete on Close", type: "bool" },
  modmail_forward_max_size: { section: "Modmail", label: "Forward Max Size", type: "number" },

  // Fun Modes
  dadmode_enabled: { section: "Fun Modes", label: "Dad Mode", type: "bool" },
  dadmode_odds: { section: "Fun Modes", label: "Dad Mode Odds", type: "percent" },
  skullmode_enabled: { section: "Fun Modes", label: "Skull Mode", type: "bool" },
  skullmode_odds: { section: "Fun Modes", label: "Skull Mode Odds", type: "percent" },

  // Panic Mode
  panic_mode: { section: "Panic Mode", label: "Active", type: "bool" },

  // Advanced
  retry_max_attempts: { section: "Advanced", label: "Retry Max Attempts", type: "number" },
  retry_initial_delay_ms: { section: "Advanced", label: "Retry Initial Delay", type: "ms" },
  retry_max_delay_ms: { section: "Advanced", label: "Retry Max Delay", type: "ms" },
  circuit_breaker_threshold: {
    section: "Advanced",
    label: "Circuit Breaker Threshold",
    type: "number",
  },
  circuit_breaker_reset_ms: { section: "Advanced", label: "Circuit Breaker Reset", type: "ms" },
  flag_rate_limit_ms: { section: "Advanced", label: "Flag Rate Limit", type: "ms" },
  flag_cooldown_ttl_ms: { section: "Advanced", label: "Flag Cooldown TTL", type: "ms" },
  banner_sync_interval_minutes: {
    section: "Advanced",
    label: "Banner Sync Interval",
    type: "minutes",
  },
  banner_sync_enabled: { section: "Advanced", label: "Banner Sync Enabled", type: "bool" },

  // Poke config
  poke_category_ids_json: { section: "Advanced", label: "Poke Categories", type: "json" },
  poke_excluded_channel_ids_json: {
    section: "Advanced",
    label: "Poke Excluded Channels",
    type: "json",
  },

  // Templates
  welcome_template: { section: "Templates", label: "Welcome Template", type: "template" },
  image_search_url_template: { section: "Templates", label: "Image Search URL", type: "template" },
};

// Columns to exclude from display (internal/derived)
const HIDDEN_COLUMNS = new Set([
  "guild_id",
  "id",
  "updated_at_s",
  "panic_enabled_at",
  "panic_enabled_by",
  "welcome", // JSON blob handled separately by the bot
]);

// Desired section order
const SECTION_ORDER = [
  "Channels",
  "Roles",
  "Gate",
  "Avatar Scanning",
  "Notifications",
  "Artist",
  "Modmail",
  "Fun Modes",
  "Panic Mode",
  "Templates",
  "Advanced",
  "Other",
];

/**
 * Get guild config organized into labeled sections.
 * Uses SELECT * so new columns appear automatically in "Other".
 */
export function getConfigSections(guildId: string): ConfigSection[] {
  const row = db().prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as
    | Record<string, unknown>
    | undefined;

  if (!row) return [];

  const grouped = new Map<string, ConfigField[]>();

  for (const [key, value] of Object.entries(row)) {
    if (HIDDEN_COLUMNS.has(key)) continue;

    const meta = FIELD_META[key];
    const section = meta?.section ?? "Other";
    const label = meta?.label ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const type = meta?.type ?? "text";

    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section)!.push({ key, label, value, type });
  }

  // Sort sections by defined order, unknowns at end
  return SECTION_ORDER.filter((s) => grouped.has(s)).map((title) => ({
    title,
    fields: grouped.get(title)!,
  }));
}
