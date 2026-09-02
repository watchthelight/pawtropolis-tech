/**
 * Config validation rules — web-side copy.
 * SYNC: Canonical source is src/lib/configValidation.ts.
 *       Keep these files in sync when making changes.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type ValueType =
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

export type DashboardTier =
  | "owner"
  | "cm"
  | "cdl"
  | "sa"
  | "admin"
  | "sm"
  | "mod"
  | "jm"
  | "gk"
  | "viewer"
  | "none";

export interface FieldRule {
  type: ValueType;
  section: string;
  label: string;
  minTier: DashboardTier;
  min?: number;
  max?: number;
  integer?: boolean;
  choices?: string[];
  nullable?: boolean;
}

// ── Tier Check ───────────────────────────────────────────────────────────

const TIER_ORDER: DashboardTier[] = [
  "owner",
  "cm",
  "cdl",
  "sa",
  "admin",
  "sm",
  "mod",
  "jm",
  "gk",
  "viewer",
  "none",
];

export function hasMinTier(userTier: string, minTier: string): boolean {
  const ui = TIER_ORDER.indexOf(userTier as DashboardTier);
  const mi = TIER_ORDER.indexOf(minTier as DashboardTier);
  return ui !== -1 && mi !== -1 && ui <= mi;
}

// ── Snowflake Pattern ────────────────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{17,20}$/;

// ── Field Rules ──────────────────────────────────────────────────────────

export const CONFIG_FIELD_RULES: Record<string, FieldRule> = {
  // Channels (admin+)
  review_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Review Channel",
    minTier: "admin",
    nullable: true,
  },
  gate_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Gate Channel",
    minTier: "admin",
    nullable: true,
  },
  general_channel_id: {
    type: "channel",
    section: "Channels",
    label: "General Channel",
    minTier: "admin",
    nullable: true,
  },
  unverified_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Unverified Channel",
    minTier: "admin",
    nullable: true,
  },
  logging_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Logging Channel",
    minTier: "admin",
    nullable: true,
  },
  notification_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Notification Channel",
    minTier: "admin",
    nullable: true,
  },
  modmail_log_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Modmail Log Channel",
    minTier: "admin",
    nullable: true,
  },
  support_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Support Channel",
    minTier: "admin",
    nullable: true,
  },
  forum_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Forum Channel",
    minTier: "admin",
    nullable: true,
  },
  report_forum_id: {
    type: "channel",
    section: "Channels",
    label: "Report Forum",
    minTier: "admin",
    nullable: true,
  },
  flags_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Flags Channel",
    minTier: "admin",
    nullable: true,
  },
  info_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Info Channel",
    minTier: "admin",
    nullable: true,
  },
  rules_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Rules Channel",
    minTier: "admin",
    nullable: true,
  },
  backfill_notification_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Backfill Notification Channel",
    minTier: "admin",
    nullable: true,
  },
  server_artist_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Server Artist Channel",
    minTier: "admin",
    nullable: true,
  },
  qotd_review_channel_id: {
    type: "channel",
    section: "Channels",
    label: "QOTD Review Channel",
    minTier: "admin",
    nullable: true,
  },

  // Roles (admin+)
  accepted_role_id: {
    type: "role",
    section: "Roles",
    label: "Accepted Role",
    minTier: "admin",
    nullable: true,
  },
  reviewer_role_id: {
    type: "role",
    section: "Roles",
    label: "Reviewer Role",
    minTier: "admin",
    nullable: true,
  },
  gatekeeper_role_id: {
    type: "role",
    section: "Roles",
    label: "Gatekeeper Role",
    minTier: "admin",
    nullable: true,
  },
  leadership_role_id: {
    type: "role",
    section: "Roles",
    label: "Leadership Role",
    minTier: "admin",
    nullable: true,
  },
  bot_dev_role_id: {
    type: "role",
    section: "Roles",
    label: "Bot Dev Role",
    minTier: "admin",
    nullable: true,
  },
  notify_role_id: {
    type: "role",
    section: "Roles",
    label: "Notify Role",
    minTier: "admin",
    nullable: true,
  },
  welcome_ping_role_id: {
    type: "role",
    section: "Roles",
    label: "Welcome Ping Role",
    minTier: "admin",
    nullable: true,
  },
  artist_role_id: {
    type: "role",
    section: "Roles",
    label: "Artist Role",
    minTier: "admin",
    nullable: true,
  },
  ambassador_role_id: {
    type: "role",
    section: "Roles",
    label: "Ambassador Role",
    minTier: "admin",
    nullable: true,
  },
  nsfw_alert_role_id: {
    type: "role",
    section: "Roles",
    label: "NSFW Alert Role",
    minTier: "admin",
    nullable: true,
  },
  qotd_role_id: {
    type: "role",
    section: "Roles",
    label: "QOTD Role",
    minTier: "admin",
    nullable: true,
  },
  mod_role_ids: {
    type: "roles",
    section: "Roles",
    label: "Mod Roles",
    minTier: "admin",
    nullable: true,
  },

  // Gate
  gate_answer_max_length: {
    type: "chars",
    section: "Gate",
    label: "Max Answer Length",
    minTier: "admin",
    min: 100,
    max: 4000,
    integer: true,
  },
  review_roles_mode: {
    type: "text",
    section: "Gate",
    label: "Review Roles Mode",
    minTier: "admin",
    choices: ["none", "level_only", "all"],
  },
  ping_dev_on_app: {
    type: "bool",
    section: "Gate",
    label: "Ping Dev on Application",
    minTier: "admin",
  },
  silent_first_msg_days: {
    type: "number",
    section: "Gate",
    label: "Silent First Msg Days",
    minTier: "sa",
    min: 7,
    max: 365,
    integer: true,
  },
  reapply_cooldown_hours: {
    type: "hours",
    section: "Gate",
    label: "Reapply Cooldown",
    minTier: "sa",
    min: 1,
    max: 720,
    integer: true,
  },
  min_account_age_hours: {
    type: "hours",
    section: "Gate",
    label: "Min Account Age",
    minTier: "sa",
    min: 0,
    max: 8760,
    integer: true,
  },
  min_join_age_hours: {
    type: "hours",
    section: "Gate",
    label: "Min Join Age",
    minTier: "sa",
    min: 0,
    max: 8760,
    integer: true,
  },
  listopen_public_output: {
    type: "bool",
    section: "Gate",
    label: "Listopen Public Output",
    minTier: "admin",
  },

  // Avatar Scanning
  avatar_scan_enabled: {
    type: "bool",
    section: "Avatar Scanning",
    label: "Scan Enabled",
    minTier: "admin",
  },
  avatar_scan_nsfw_threshold: {
    type: "percent",
    section: "Avatar Scanning",
    label: "NSFW Threshold",
    minTier: "sa",
    min: 0.1,
    max: 1.0,
  },
  avatar_scan_skin_edge_threshold: {
    type: "percent",
    section: "Avatar Scanning",
    label: "Skin Edge Threshold",
    minTier: "sa",
    min: 0.05,
    max: 0.5,
  },
  avatar_scan_weight_model: {
    type: "percent",
    section: "Avatar Scanning",
    label: "Model Weight",
    minTier: "sa",
    min: 0.0,
    max: 1.0,
  },
  avatar_scan_weight_edge: {
    type: "percent",
    section: "Avatar Scanning",
    label: "Edge Weight",
    minTier: "sa",
    min: 0.0,
    max: 1.0,
  },
  avatar_scan_hard_threshold: {
    type: "percent",
    section: "Avatar Scanning",
    label: "Hard Threshold",
    minTier: "sa",
    min: 0.5,
    max: 1.0,
  },
  avatar_scan_soft_threshold: {
    type: "percent",
    section: "Avatar Scanning",
    label: "Soft Threshold",
    minTier: "sa",
    min: 0.3,
    max: 0.9,
  },
  avatar_scan_racy_threshold: {
    type: "percent",
    section: "Avatar Scanning",
    label: "Racy Threshold",
    minTier: "sa",
    min: 0.5,
    max: 1.0,
  },

  // Notifications
  notify_mode: {
    type: "text",
    section: "Notifications",
    label: "Notify Mode",
    minTier: "admin",
    choices: ["post", "dm", "off"],
  },
  notify_cooldown_seconds: {
    type: "seconds",
    section: "Notifications",
    label: "Cooldown",
    minTier: "sa",
    min: 1,
    max: 60,
    integer: true,
  },
  notify_max_per_hour: {
    type: "number",
    section: "Notifications",
    label: "Max Per Hour",
    minTier: "sa",
    min: 1,
    max: 100,
    integer: true,
  },
  level_reward_dm_enabled: {
    type: "bool",
    section: "Notifications",
    label: "Level Reward DMs",
    minTier: "admin",
  },

  // Artist
  artist_ticket_roles_json: {
    type: "json",
    section: "Artist",
    label: "Ticket Roles",
    minTier: "admin",
    nullable: true,
  },
  artist_ignored_users_json: {
    type: "json",
    section: "Artist",
    label: "Ignored Users",
    minTier: "admin",
    nullable: true,
  },

  // Modmail
  modmail_delete_on_close: {
    type: "bool",
    section: "Modmail",
    label: "Delete on Close",
    minTier: "admin",
  },
  modmail_forward_max_size: {
    type: "number",
    section: "Modmail",
    label: "Forward Max Size",
    minTier: "sa",
    min: 1000,
    max: 100000,
    integer: true,
  },

  // Fun Modes
  dadmode_enabled: { type: "bool", section: "Fun Modes", label: "Dad Mode", minTier: "admin" },
  dadmode_odds: {
    type: "number",
    section: "Fun Modes",
    label: "Dad Mode Odds",
    minTier: "admin",
    min: 2,
    max: 100000,
    integer: true,
  },
  skullmode_enabled: { type: "bool", section: "Fun Modes", label: "Skull Mode", minTier: "admin" },
  skullmode_odds: {
    type: "number",
    section: "Fun Modes",
    label: "Skull Mode Odds",
    minTier: "admin",
    min: 2,
    max: 100000,
    integer: true,
  },

  // Templates
  welcome_template: {
    type: "template",
    section: "Templates",
    label: "Welcome Template",
    minTier: "admin",
    nullable: true,
  },
  image_search_url_template: {
    type: "template",
    section: "Templates",
    label: "Image Search URL",
    minTier: "admin",
  },

  // Advanced
  retry_max_attempts: {
    type: "number",
    section: "Advanced",
    label: "Retry Max Attempts",
    minTier: "sa",
    min: 1,
    max: 10,
    integer: true,
  },
  retry_initial_delay_ms: {
    type: "ms",
    section: "Advanced",
    label: "Retry Initial Delay",
    minTier: "sa",
    min: 50,
    max: 1000,
    integer: true,
  },
  retry_max_delay_ms: {
    type: "ms",
    section: "Advanced",
    label: "Retry Max Delay",
    minTier: "sa",
    min: 1000,
    max: 30000,
    integer: true,
  },
  circuit_breaker_threshold: {
    type: "number",
    section: "Advanced",
    label: "Circuit Breaker Threshold",
    minTier: "sa",
    min: 1,
    max: 20,
    integer: true,
  },
  circuit_breaker_reset_ms: {
    type: "ms",
    section: "Advanced",
    label: "Circuit Breaker Reset",
    minTier: "sa",
    min: 10000,
    max: 300000,
    integer: true,
  },
  flag_rate_limit_ms: {
    type: "ms",
    section: "Advanced",
    label: "Flag Rate Limit",
    minTier: "sa",
    min: 500,
    max: 10000,
    integer: true,
  },
  flag_cooldown_ttl_ms: {
    type: "ms",
    section: "Advanced",
    label: "Flag Cooldown TTL",
    minTier: "sa",
    min: 60000,
    max: 7200000,
    integer: true,
  },
  banner_sync_interval_minutes: {
    type: "minutes",
    section: "Advanced",
    label: "Banner Sync Interval",
    minTier: "sa",
    min: 1,
    max: 60,
    integer: true,
  },
  banner_sync_enabled: {
    type: "bool",
    section: "Advanced",
    label: "Banner Sync Enabled",
    minTier: "admin",
  },
  poke_category_ids_json: {
    type: "json",
    section: "Advanced",
    label: "Poke Categories",
    minTier: "admin",
    nullable: true,
  },
  poke_excluded_channel_ids_json: {
    type: "json",
    section: "Advanced",
    label: "Poke Excluded Channels",
    minTier: "admin",
    nullable: true,
  },
  pulse_excluded_category_ids_json: {
    type: "json",
    section: "Advanced",
    label: "Pulse Excluded Categories",
    minTier: "admin",
    nullable: true,
  },
  vote_out_threshold: {
    type: "number",
    section: "Advanced",
    label: "Vote Out Threshold",
    minTier: "admin",
    min: 1,
    max: 10,
    integer: true,
  },
  verify_thread_parent_id: {
    type: "channel",
    section: "Channels",
    label: "Verify Thread Parent",
    minTier: "admin",
    nullable: true,
  },
  unverified_rules_channel_id: {
    type: "channel",
    section: "Channels",
    label: "Unverified Rules Channel",
    minTier: "admin",
    nullable: true,
  },
};

// ── Validators ───────────────────────────────────────────────────────────

export function validateConfigField(
  key: string,
  value: unknown
): { valid: boolean; error?: string } {
  const rule = CONFIG_FIELD_RULES[key];
  if (!rule) return { valid: false, error: `Unknown config field: ${key}` };

  if (value === null || value === "" || value === undefined) {
    if (rule.nullable) return { valid: true };
    return { valid: false, error: `${rule.label} is required` };
  }

  switch (rule.type) {
    case "bool": {
      if (typeof value === "boolean" || value === 0 || value === 1) return { valid: true };
      if (value === "true" || value === "false") return { valid: true };
      return { valid: false, error: `${rule.label} must be a boolean` };
    }

    case "channel":
    case "role": {
      if (value === null && rule.nullable) return { valid: true };
      const s = String(value);
      if (!SNOWFLAKE_RE.test(s))
        return { valid: false, error: `${rule.label} must be a valid Discord ID (17-20 digits)` };
      return { valid: true };
    }

    case "roles": {
      if (value === null && rule.nullable) return { valid: true };
      const s = String(value);
      if (s.trim() === "")
        return rule.nullable
          ? { valid: true }
          : { valid: false, error: `${rule.label} cannot be empty` };
      const ids = s
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      for (const id of ids) {
        if (!SNOWFLAKE_RE.test(id)) return { valid: false, error: `Invalid role ID: ${id}` };
      }
      return { valid: true };
    }

    case "number":
    case "hours":
    case "minutes":
    case "seconds":
    case "ms":
    case "chars": {
      const n = Number(value);
      if (isNaN(n)) return { valid: false, error: `${rule.label} must be a number` };
      if (rule.integer && !Number.isInteger(n))
        return { valid: false, error: `${rule.label} must be a whole number` };
      if (rule.min !== undefined && n < rule.min)
        return { valid: false, error: `${rule.label} must be at least ${rule.min}` };
      if (rule.max !== undefined && n > rule.max)
        return { valid: false, error: `${rule.label} must be at most ${rule.max}` };
      return { valid: true };
    }

    case "percent": {
      const n = Number(value);
      if (isNaN(n)) return { valid: false, error: `${rule.label} must be a number` };
      if (rule.min !== undefined && n < rule.min)
        return { valid: false, error: `${rule.label} must be at least ${rule.min}` };
      if (rule.max !== undefined && n > rule.max)
        return { valid: false, error: `${rule.label} must be at most ${rule.max}` };
      return { valid: true };
    }

    case "text": {
      if (rule.choices && !rule.choices.includes(String(value))) {
        return { valid: false, error: `${rule.label} must be one of: ${rule.choices.join(", ")}` };
      }
      return { valid: true };
    }

    case "json": {
      if (value === null && rule.nullable) return { valid: true };
      const s = String(value);
      if (s.trim() === "")
        return rule.nullable
          ? { valid: true }
          : { valid: false, error: `${rule.label} cannot be empty` };
      try {
        JSON.parse(s);
        return { valid: true };
      } catch {
        return { valid: false, error: `${rule.label} must be valid JSON` };
      }
    }

    case "template": {
      if (value === null && rule.nullable) return { valid: true };
      const s = String(value);
      if (s.length > 2000)
        return { valid: false, error: `${rule.label} must be at most 2000 characters` };
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}

export function validateConfigUpdate(fields: Record<string, unknown>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    const result = validateConfigField(key, value);
    if (!result.valid && result.error) {
      errors[key] = result.error;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
