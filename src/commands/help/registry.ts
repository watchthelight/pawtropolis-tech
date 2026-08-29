/**
 * Pawtropolis Tech — src/commands/help/registry.ts
 * WHAT: Static command registry with full documentation for all bot commands
 * WHY: Provides searchable, permission-aware help content for the /help system
 * FLOWS:
 *  - Loaded at startup for search indexing
 *  - Queried by help handlers for command details
 *  - Filtered by permission level for each user
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { CommandMetadata, CommandCategory } from "./metadata.js";

/**
 * Complete command registry with documentation for all Pawtropolis Tech commands.
 * Each entry includes usage, options, examples, notes, workflow tips, and related commands.
 */
/*
 * GOTCHA: This entire array is loaded into memory at startup. At ~900 lines,
 * it's not a problem now, but if someone decides to add inline images or
 * Base64-encoded help videos, future you will be very unhappy.
 */
export const COMMAND_REGISTRY: CommandMetadata[] = [
  // ============================================================================
  // GATE & VERIFICATION
  // ============================================================================
  {
    name: "gate",
    description: "Guild gate management and configuration",
    category: "gate",
    permissionLevel: "admin",
    usage: "/gate <subcommand>",
    subcommands: [
      { name: "setup", description: "Initialize gate config with channels and roles" },
      { name: "reset", description: "Reset a user's application data (fresh invite)" },
      { name: "status", description: "Show application statistics" },
      { name: "config", description: "View current gate configuration" },
    ],
    subcommandGroups: [
      {
        name: "welcome",
        description: "Manage the welcome message template",
        subcommands: [
          { name: "set", description: "Update the welcome message template" },
          { name: "preview", description: "Preview the welcome message" },
          { name: "clear", description: "Remove the welcome message" },
        ],
      },
      {
        name: "questions",
        description: "Manage gate application questions",
        // WHY q1-q5 instead of a single "set" with an index? Because Discord slash
        // command autocomplete makes numbered subcommands feel more intuitive than
        // "/gate questions set index:3 text:...". Sometimes UX trumps DRY.
        subcommands: [
          { name: "q1", description: "Set question 1" },
          { name: "q2", description: "Set question 2" },
          { name: "q3", description: "Set question 3" },
          { name: "q4", description: "Set question 4" },
          { name: "q5", description: "Set question 5" },
        ],
      },
    ],
    examples: [
      "/gate setup review_channel:#staff-review gate_channel:#apply general_channel:#general accepted_role:@Verified",
      "/gate status",
      "/gate welcome set content:Welcome {applicant.mention}!",
    ],
    notes: "The setup command initializes all required channels and roles for the gate system.",
    workflowTips: [
      "Run /gate setup first to configure your verification system",
      "Use /gate status to monitor application queue health",
      "Customize questions with /gate questions for better applicant screening",
    ],
    relatedCommands: ["accept", "reject", "listopen", "config"],
    aliases: ["verification", "entry", "setup"],
  },
  {
    name: "accept",
    // GOTCHA: Despite having three mutually exclusive identifiers (app, user, uid),
    // the actual command implementation should validate that exactly one is provided.
    // If you're getting weird behavior, check if someone passed both app AND user.
    description: "Approve an application and grant verified role",
    category: "gate",
    permissionLevel: "reviewer",
    usage: "/accept [app:<code>] [user:<@user>] [uid:<id>]",
    options: [
      { name: "app", description: "Application short code (e.g., A1B2C3)", type: "string", required: false },
      { name: "user", description: "User to accept (@mention or select)", type: "user", required: false },
      { name: "uid", description: "Discord User ID (if user not in server)", type: "string", required: false },
    ],
    examples: [
      "/accept app:A1B2C3",
      "/accept user:@JohnDoe",
      "/accept uid:123456789012345678",
    ],
    notes: "Provide exactly one identifier: app code, user mention, or uid. Automatically grants the accepted role and posts a welcome message.",
    workflowTips: [
      "Use the app code from the review card for fastest workflow",
      "The welcome message is posted automatically to general channel",
      "Check /listopen for your next pending review",
    ],
    relatedCommands: ["reject", "kick", "listopen", "search"],
    aliases: ["approve", "verify"],
  },
  {
    name: "reject",
    description: "Reject an application with a reason",
    category: "gate",
    permissionLevel: "reviewer",
    usage: "/reject reason:<text> [app:<code>] [user:<@user>] [uid:<id>] [perm:<bool>]",
    options: [
      { name: "reason", description: "Reason for rejection (max 500 chars)", type: "string", required: true },
      { name: "app", description: "Application short code (e.g., A1B2C3)", type: "string", required: false },
      { name: "user", description: "User to reject (@mention or select)", type: "user", required: false },
      { name: "uid", description: "Discord User ID (if user not in server)", type: "string", required: false },
      // perm:true is the nuclear option. Use sparingly or your appeals inbox will hate you.
      { name: "perm", description: "Permanently reject (blocks re-application)", type: "boolean", required: false },
    ],
    examples: [
      "/reject reason:Incomplete answers app:A1B2C3",
      "/reject reason:Account too new user:@JohnDoe",
      "/reject reason:Known spammer perm:true uid:123456789012345678",
    ],
    notes: "The user receives a DM with the rejection reason. Use perm:true to prevent re-application.",
    workflowTips: [
      "Be specific in rejection reasons to help users improve",
      "Use perm:true only for serious violations",
      "Use /unblock to remove permanent rejections if needed",
    ],
    relatedCommands: ["accept", "kick", "unblock", "listopen"],
    aliases: ["deny"],
  },
  {
    name: "kick",
    description: "Kick user from the application process",
    category: "gate",
    permissionLevel: "reviewer",
    usage: "/kick [app:<code>] [user:<@user>] [uid:<id>]",
    options: [
      { name: "app", description: "Application short code", type: "string", required: false },
      { name: "user", description: "User to kick", type: "user", required: false },
      { name: "uid", description: "Discord User ID", type: "string", required: false },
    ],
    examples: ["/kick app:A1B2C3", "/kick user:@JohnDoe"],
    notes: "Removes the user from the gate without a formal rejection. Use when user leaves or for cleanup.",
    workflowTips: [
      "Use kick for users who left the server mid-application",
      "Kicked users can reapply after the cooldown period",
    ],
    relatedCommands: ["accept", "reject", "listopen"],
    aliases: ["remove"],
  },
  {
    name: "unclaim",
    description: "Release a claimed application",
    category: "gate",
    permissionLevel: "reviewer",
    usage: "/unclaim [app:<code>] [user:<@user>] [uid:<id>]",
    options: [
      { name: "app", description: "Application short code", type: "string", required: false },
      { name: "user", description: "Applicant user", type: "user", required: false },
      { name: "uid", description: "Discord User ID", type: "string", required: false },
    ],
    examples: ["/unclaim app:A1B2C3"],
    notes: "Releases your claim on an application so other reviewers can pick it up.",
    workflowTips: [
      "Unclaim if you can't finish reviewing in a reasonable time",
      "Other reviewers can then claim the application",
    ],
    relatedCommands: ["listopen", "accept", "reject"],
    aliases: ["release"],
  },

  // ============================================================================
  // CONFIGURATION
  // ============================================================================
  {
    name: "config",
    /*
     * This command has grown organically over time. What started as "set a few
     * channels" is now a sprawling config empire. If you're adding yet another
     * subcommand, consider whether it really belongs here or deserves its own
     * top-level command. Your future self will thank you for the restraint.
     */
    description: "Guild configuration management",
    category: "config",
    permissionLevel: "staff",
    usage: "/config <group> <subcommand> [options]",
    subcommandGroups: [
      {
        name: "set",
        description: "Set core configuration values",
        subcommands: [
          { name: "mod_roles", description: "Set moderator roles (up to 5)" },
          { name: "gatekeeper", description: "Set the gatekeeper role" },
          { name: "reviewer_role", description: "Set the reviewer role" },
          { name: "leadership_role", description: "Set the leadership role" },
          { name: "bot_dev_role", description: "Set role to ping on new apps" },
          { name: "notify_role", description: "Set notification role" },
          { name: "modmail_log_channel", description: "Set modmail log channel" },
          { name: "logging", description: "Set action logging channel" },
          { name: "flags_channel", description: "Set flags alert channel" },
          { name: "backfill_channel", description: "Set backfill notifications channel" },
          { name: "forum_channel", description: "Set forum channel" },
          { name: "notification_channel", description: "Set notification channel" },
          { name: "support_channel", description: "Set support channel" },
          { name: "review_roles", description: "Set role display in review cards" },
          { name: "dadmode", description: "Toggle Dad Mode responses" }, // Yes, this is what you think it is.
          { name: "pingdevonapp", description: "Toggle bot dev pings" },
          { name: "banner_sync_toggle", description: "Toggle banner sync" },
          { name: "avatar_scan_toggle", description: "Toggle avatar scanning" },
          { name: "listopen_output", description: "Set listopen visibility" },
          { name: "modmail_delete", description: "Delete modmail on close" },
          { name: "notify_mode", description: "Set notification mode" },
          { name: "artist_rotation", description: "Configure artist rotation" },
          { name: "artist_ignored_users", description: "Manage ignored users" },
        ],
      },
      {
        name: "set-advanced",
        description: "Set advanced configuration values",
        subcommands: [
          { name: "flags_threshold", description: "Silent days threshold" },
          { name: "reapply_cooldown", description: "Hours before reapply" },
          { name: "min_account_age", description: "Minimum account age" },
          { name: "min_join_age", description: "Minimum time in server" },
          { name: "gate_answer_length", description: "Max answer length" },
          { name: "banner_sync_interval", description: "Banner sync interval" },
          { name: "modmail_forward_size", description: "Modmail tracking size" },
          { name: "retry_config", description: "API retry settings" },
          { name: "circuit_breaker", description: "Circuit breaker settings" },
          { name: "flag_rate_limit", description: "Flag rate limiting" },
          { name: "notify_config", description: "Notification settings" },
          { name: "avatar_thresholds", description: "NSFW scan thresholds" },
          { name: "avatar_scan_advanced", description: "Advanced scan settings" },
          { name: "movie_threshold", description: "Set movie qualification time" },
          { name: "game_threshold", description: "Set game qualification percentage" },
        ],
      },
      {
        name: "get",
        description: "View configuration values",
        subcommands: [
          { name: "logging", description: "View logging config" },
          { name: "flags", description: "View flags config" },
        ],
      },
      {
        name: "poke",
        description: "Configure /poke command",
        subcommands: [
          { name: "add_category", description: "Add category to poke" },
          { name: "remove_category", description: "Remove category from poke" },
          { name: "exclude_channel", description: "Exclude channel from poke" },
          { name: "include_channel", description: "Include channel in poke" },
          { name: "list", description: "View poke configuration" },
        ],
      },
    ],
    subcommands: [
      { name: "view", description: "View all current guild configuration" },
      { name: "isitreal", description: "Configure AI detection API keys (owner only)" },
    ],
    examples: [
      "/config set mod_roles role1:@Moderator role2:@Admin",
      "/config set logging channel:#mod-logs",
      "/config set dadmode state:on chance:500",
      "/config view",
    ],
    notes: "Most settings require staff permissions. Some advanced settings require admin or owner.",
    workflowTips: [
      "Use /config view to see all current settings at once",
      "Set logging channel first to track all configuration changes",
      "Configure mod_roles to grant command access to your team",
    ],
    relatedCommands: ["gate", "stats"],
    aliases: ["settings", "configure", "setup"],
  },

  // ============================================================================
  // MODERATION
  // ============================================================================
  {
    name: "audit",
    description: "Server audit commands for bot detection and NSFW scanning",
    category: "moderation",
    permissionLevel: "staff",
    usage: "/audit <subcommand>",
    subcommands: [
      { name: "members", description: "Scan for bot-like accounts" },
      {
        name: "nsfw",
        description: "Scan member avatars for NSFW content",
        options: [
          {
            name: "scope",
            description: "Which members to scan",
            type: "string",
            required: true,
            choices: [
              { name: "All members", value: "all" },
              { name: "Flagged members only", value: "flagged" },
            ],
          },
        ],
      },
    ],
    examples: ["/audit members", "/audit nsfw scope:all", "/audit nsfw scope:flagged"],
    // Note: Google Vision API bills per-image. A server-wide scan with 10k members
    // can get expensive fast. Always scope appropriately.
    notes: "Restricted to Community Manager and Bot Developer roles. Uses Google Vision API for NSFW detection.",
    workflowTips: [
      "Run /audit members periodically to catch bot accounts",
      "Use scope:flagged for faster scans on suspicious users",
      "Review flagged users in the flags channel",
    ],
    relatedCommands: ["flag", "isitreal"],
    aliases: ["scan", "check"],
  },
  {
    name: "flag",
    description: "Manually flag a user as suspicious",
    category: "moderation",
    permissionLevel: "staff",
    usage: "/flag user:<@user> [reason:<text>]",
    options: [
      { name: "user", description: "User to flag", type: "user", required: true },
      { name: "reason", description: "Reason for flagging", type: "string", required: false },
    ],
    examples: [
      "/flag user:@SuspiciousUser",
      "/flag user:@SpamBot reason:Advertising in DMs",
    ],
    // Idempotent means you can spam the command without creating duplicate flags.
    // The rate limit exists because someone definitely tried.
    notes: "Flags are idempotent - reflagging an already-flagged user is a no-op. Has a 2-second rate limit.",
    workflowTips: [
      "Flag users who exhibit suspicious behavior for team visibility",
      "Add a reason to help other mods understand the context",
      "Check the flags channel for team-flagged users",
    ],
    relatedCommands: ["audit", "unblock"],
    aliases: ["mark", "suspicious"],
  },
  {
    name: "isitreal",
    description: "Detect AI-generated images in a message",
    category: "moderation",
    permissionLevel: "staff",
    usage: "/isitreal message:<id or link>",
    options: [
      { name: "message", description: "Message ID or link containing image(s)", type: "string", required: true },
    ],
    examples: [
      "/isitreal message:1234567890123456789",
      "/isitreal message:https://discord.com/channels/123/456/789",
    ],
    // WHY multiple APIs? Because no single AI detection service is reliable enough on
    // its own, and the false positive rate drops significantly with consensus.
    notes: "Uses multiple AI detection APIs to analyze images. Shows per-service confidence scores.",
    workflowTips: [
      "Use on art submissions to verify authenticity",
      "Check profile pictures of suspicious users",
      "Higher confidence scores indicate likely AI generation",
    ],
    relatedCommands: ["audit", "flag"],
    aliases: ["aidetect", "aicheck", "fakedetect"],
  },
  {
    name: "unblock",
    description: "Remove permanent rejection from a user",
    category: "moderation",
    permissionLevel: "staff",
    usage: "/unblock [target:<@user>] [user_id:<id>] [username:<text>] reason:<text>",
    options: [
      { name: "target", description: "User mention to unblock", type: "user", required: false },
      { name: "user_id", description: "User ID to unblock", type: "string", required: false },
      { name: "username", description: "Username fallback for display", type: "string", required: false },
      { name: "reason", description: "Reason for unblocking", type: "string", required: true },
    ],
    examples: [
      "/unblock target:@User reason:Appeals committee approved",
      "/unblock user_id:123456789 reason:False positive",
    ],
    notes: "Removes the permanent rejection flag, allowing the user to reapply.",
    workflowTips: [
      "Document the reason for unblocking in the audit log",
      "Use for successful appeals or false positive corrections",
    ],
    relatedCommands: ["reject", "flag"],
    aliases: ["unpermban", "unban"],
  },
  {
    name: "report",
    description: "Report a content violation with evidence",
    category: "moderation",
    permissionLevel: "staff",
    usage: "/report user:<@user> reason:<text> [evidence:<attachment>]",
    options: [
      { name: "user", description: "User who violated the rules", type: "user", required: true },
      { name: "reason", description: "Description of the violation (max 500 chars)", type: "string", required: true },
      { name: "evidence", description: "Screenshot of the violation", type: "attachment", required: false },
    ],
    examples: [
      "/report user:@RuleBreaker reason:Posting NSFW content in general",
      "/report user:@Spammer reason:Advertising links evidence:<screenshot.png>",
    ],
    notes: "Available to ambassadors and staff. Creates a forum thread for staff review with a Resolve button.",
    workflowTips: [
      "Attach a screenshot as evidence when possible",
      "Delete the violating message before reporting (screenshot first)",
      "Staff can resolve reports via the Resolve button in the thread",
    ],
    relatedCommands: ["flag", "audit"],
    aliases: ["violation", "content-report"],
  },

  // ============================================================================
  // QUEUE MANAGEMENT
  // ============================================================================
  {
    name: "listopen",
    description: "List applications awaiting review",
    category: "queue",
    permissionLevel: "reviewer",
    usage: "/listopen [scope:<mine|all|drafts>]",
    options: [
      {
        name: "scope",
        description: "Which applications to show",
        type: "string",
        required: false,
        choices: [
          { name: "Mine (default)", value: "mine" },
          { name: "All (claimed + unclaimed)", value: "all" },
          { name: "Drafts (incomplete)", value: "drafts" },
        ],
      },
    ],
    examples: ["/listopen", "/listopen scope:all", "/listopen scope:drafts"],
    notes: "Shows 10 applications per page with pagination. Links directly to review cards.",
    workflowTips: [
      "Start your review session with /listopen to see your queue",
      "Use scope:all to find unclaimed applications",
      "scope:drafts shows incomplete applications that haven't submitted",
    ],
    relatedCommands: ["accept", "reject", "search"],
    aliases: ["queue", "pending", "reviews"],
  },
  {
    name: "search",
    description: "Search a user's application history",
    category: "queue",
    permissionLevel: "reviewer",
    usage: "/search user:<@user>",
    options: [
      { name: "user", description: "User to search", type: "user", required: true },
    ],
    examples: ["/search user:@JohnDoe"],
    notes: "Shows all past applications with status, timestamps, and direct links to review cards.",
    workflowTips: [
      "Check application history before reviewing a reapplication",
      "See previous rejection reasons for context",
      "Useful for verifying user claims about past applications",
    ],
    relatedCommands: ["listopen", "accept", "reject"],
    aliases: ["history", "lookup", "find"],
  },
  {
    name: "sample",
    description: "Preview sample UI components",
    category: "queue",
    permissionLevel: "reviewer",
    usage: "/sample reviewcard [status:<status>] [applicant:<text>] [claimed_by:<text>] [long:<bool>]",
    subcommands: [
      {
        name: "reviewcard",
        description: "Preview a sample review card",
        options: [
          { name: "status", description: "Application status", type: "string", required: false },
          { name: "applicant", description: "Sample applicant name", type: "string", required: false },
          { name: "claimed_by", description: "Sample reviewer name", type: "string", required: false },
          { name: "long", description: "Include long answers", type: "boolean", required: false },
        ],
      },
    ],
    examples: ["/sample reviewcard", "/sample reviewcard status:pending long:true"],
    notes: "Useful for testing review card appearance without actual applications.",
    workflowTips: ["Use to preview how review cards look with different content lengths"],
    relatedCommands: ["listopen"],
    aliases: ["preview", "test"],
  },

  // ============================================================================
  // ANALYTICS
  // ============================================================================
  {
    name: "stats",
    description: "Server analytics, moderator performance, and activity heatmaps",
    category: "analytics",
    permissionLevel: "staff",
    usage: "/stats <subcommand>",
    subcommands: [
      { name: "activity", description: "Server activity heatmap (1-8 weeks)" },
      { name: "approval-rate", description: "Application approval/rejection rates with trends" },
      { name: "leaderboard", description: "Moderator action leaderboard" },
      { name: "user", description: "Stats for a specific moderator" },
      { name: "export", description: "Full CSV export (admin only)" },
      { name: "reset", description: "Reset and rebuild metrics (admin only)" },
      { name: "history", description: "Moderator action history (leadership only)" },
    ],
    examples: [
      "/stats activity weeks:4",
      "/stats approval-rate",
      "/stats leaderboard",
      "/stats user user:@Mod",
      "/stats history moderator:@Mod days:90",
    ],
    notes: "One parent command for all analytics. Permission tiers differ per subcommand: activity/approval-rate/leaderboard/user are staff-level; export and reset are admin-only; history is leadership-only.",
    workflowTips: [
      "Use /stats activity to find peak hours for announcements",
      "Use /stats leaderboard to recognize active team members",
      "Use /stats history before promotions or performance reviews",
    ],
    relatedCommands: ["health", "modmail"],
    aliases: ["analytics", "modstats", "modhistory", "activity", "approval-rate", "modleaderboard"],
  },

  // ============================================================================
  // MESSAGING
  // ============================================================================
  {
    name: "send",
    description: "Post an anonymous message as the bot",
    category: "messaging",
    permissionLevel: "staff",
    usage: "/send message:<text> [embed:<bool>] [reply_to:<id>] [attachment:<file>] [silent:<bool>]",
    options: [
      { name: "message", description: "Content to send", type: "string", required: true },
      { name: "embed", description: "Send as embed (default: false)", type: "boolean", required: false },
      { name: "reply_to", description: "Message ID to reply to", type: "string", required: false },
      { name: "attachment", description: "Include a file or image", type: "attachment", required: false },
      { name: "silent", description: "Block all mentions (default: true)", type: "boolean", required: false },
    ],
    examples: [
      "/send message:Welcome to the server!",
      "/send message:Important announcement embed:true",
      '/send message:See above reply_to:1234567890',
    ],
    notes: "Requires ManageMessages permission. Messages are logged to the audit channel.",
    workflowTips: [
      "Use embed:true for formatted announcements",
      "silent:true prevents accidental pings",
      "reply_to lets you add context to existing messages",
    ],
    relatedCommands: ["purge", "modmail"],
    aliases: ["post", "announce"],
  },
  {
    name: "purge",
    description: "Bulk delete messages in a channel",
    category: "messaging",
    permissionLevel: "staff",
    usage: "/purge password:<text> [count:<number>]",
    options: [
      { name: "password", description: "Reset password for confirmation", type: "string", required: true },
      { name: "count", description: "Number of messages to delete", type: "integer", required: false },
    ],
    examples: ["/purge password:secretpass count:50"],
    // The 14-day limit is a Discord API limitation, not a design choice.
    // If someone asks why we can't purge older messages, blame Discord, not us.
    notes: "Requires password confirmation and ManageMessages permission. Cannot delete messages older than 14 days.",
    workflowTips: [
      "Use for cleaning up spam or accidental messages",
      "14-day limit is a Discord API restriction",
      "Password prevents accidental purges",
    ],
    relatedCommands: ["send"],
    aliases: ["clear", "delete", "clean"],
  },
  {
    name: "poke",
    description: "Ping a user across multiple category channels",
    category: "messaging",
    permissionLevel: "owner",
    usage: "/poke user:<@user>",
    options: [
      { name: "user", description: "User to ping", type: "user", required: true },
    ],
    examples: ["/poke user:@User"],
    notes: "Owner-only command. Pings in all configured category channels.",
    workflowTips: [
      "Use to get attention of inactive users",
      "Configure with /config poke commands",
    ],
    relatedCommands: ["config"],
    aliases: ["ping", "attention"],
  },
  {
    name: "modmail",
    description: "Staff-to-user private messaging system",
    category: "messaging",
    permissionLevel: "staff",
    usage: "Context menu: Modmail > Open",
    examples: ["Right-click user > Apps > Modmail: Open"],
    notes: "Opens a private thread for communicating with a user. Messages are forwarded to their DMs.",
    workflowTips: [
      "Use for private communications with applicants",
      "Thread persists until manually closed",
      "All messages are logged",
    ],
    relatedCommands: ["send"],
    aliases: ["dm", "contact", "message"],
  },

  // ============================================================================
  // ROLE AUTOMATION
  // ============================================================================
  {
    name: "roles",
    description: "Configure role automation settings",
    category: "roles",
    permissionLevel: "staff",
    usage: "/roles <subcommand>",
    subcommands: [
      { name: "add-level-tier", description: "Map level to level role" },
      { name: "add-level-reward", description: "Add reward for reaching level" },
      { name: "add-movie-tier", description: "Add movie night attendance tier" },
      { name: "list", description: "View configured role mappings" },
      { name: "remove", description: "Remove a role mapping" },
    ],
    examples: [
      "/roles add-level-tier level:10 role:@Level10",
      "/roles add-movie-tier count:5 role:@PopcornClub",
      "/roles list",
    ],
    notes: "Requires ManageRoles permission. Roles are assigned automatically based on triggers.",
    workflowTips: [
      "Set up level tiers for engagement rewards",
      "Movie tiers reward consistent attendance",
      "Use /panic to halt all role changes in emergencies",
    ],
    relatedCommands: ["movie", "panic"],
    aliases: ["roleconfig", "autoroles"],
  },
  {
    name: "movie",
    description: "Movie night attendance tracking",
    category: "roles",
    permissionLevel: "staff",
    usage: "/movie <subcommand>",
    subcommands: [
      {
        name: "start",
        description: "Start tracking in a voice channel",
        options: [{ name: "channel", description: "Voice channel to track", type: "channel", required: true }],
      },
      { name: "end", description: "End tracking and assign tier roles" },
      {
        name: "attendance",
        description: "View attendance stats",
        options: [{ name: "user", description: "Specific user (optional)", type: "user", required: false }],
      },
    ],
    examples: [
      "/movie start channel:#movie-night-vc",
      "/movie end",
      "/movie attendance user:@User",
    ],
    // 30 minutes is the magic number. Less than that and people game it by joining
    // for a minute then leaving. Ask me how we know.
    notes: "Users need 30+ minutes to qualify. Tier roles are assigned automatically.",
    workflowTips: [
      "Start tracking before the movie begins",
      "End when movie concludes to finalize attendance",
      "Users keep their tier roles even if they miss events",
    ],
    relatedCommands: ["roles", "panic"],
    aliases: ["movienight"],
  },
  {
    name: "usebyte",
    description: "Redeem byte token for XP multiplier",
    category: "roles",
    permissionLevel: "public",
    usage: "/usebyte [rarity:<token>]",
    options: [
      {
        name: "rarity",
        description: "Which token to redeem (optional)",
        type: "string",
        required: false,
        choices: [
          { name: "Common", value: "common" },
          { name: "Rare", value: "rare" },
          { name: "Epic", value: "epic" },
          { name: "Legendary", value: "legendary" },
          { name: "Mythic", value: "mythic" },
        ],
      },
    ],
    examples: ["/usebyte", "/usebyte rarity:common", "/usebyte rarity:mythic"],
    notes:
      "Self-service command for members with Byte Token roles. " +
      "Tokens are earned from giveaways, events, level rewards, and the Paw Bank shop. " +
      "Multiplier roles are automatically removed when they expire.",
    workflowTips: [
      "Run /usebyte to see your available tokens and pick which to use",
      "Specify rarity directly to skip the selection menu",
      "Higher rarity tokens give better multipliers and longer durations",
      "Upgrading to a higher multiplier replaces your current one (remaining time is lost)",
    ],
    relatedCommands: ["roles", "inventory"],
    aliases: ["byte", "multiplier"],
  },
  {
    name: "inventory",
    description: "See the reward items you are holding",
    category: "roles",
    permissionLevel: "public",
    usage: "/inventory [user:<member>]",
    options: [
      {
        name: "user",
        description: "Staff only: view someone else's inventory",
        type: "user",
        required: false,
      },
    ],
    examples: ["/inventory", "/inventory user:@Someone"],
    notes:
      "Reward roles do not stack, so the bot banks them here instead. " +
      "Items arrive automatically about a minute after you earn the role.",
    workflowTips: [
      "Stacks show as x2, x3 and so on",
      "Use /redeem to take one back out",
    ],
    relatedCommands: ["redeem", "usebyte", "redeemreward"],
    aliases: ["inv", "items"],
  },
  {
    name: "redeem",
    description: "Take one item out of your inventory",
    category: "roles",
    permissionLevel: "public",
    usage: "/redeem item:<item>",
    options: [
      {
        name: "item",
        description: "Which item to use",
        type: "string",
        required: true,
      },
    ],
    examples: ["/redeem item:emoji", "/redeem item:byte:mythic"],
    notes:
      "Hands the role back so the normal flow can consume it: staff run /redeemreward " +
      "for art tickets, and /usebyte activates a byte token. One item at a time.",
    workflowTips: [
      "The item list autocompletes from what you actually hold",
      "Finish the item you have out before redeeming the next one",
      "A failed hand-off refunds the item automatically",
    ],
    relatedCommands: ["inventory", "usebyte", "redeemreward"],
    aliases: ["use", "claim"],
  },
  {
    name: "panic",
    // Named "panic" because that's exactly what you'll be doing when you need it.
    description: "Emergency halt for role automation",
    category: "roles",
    permissionLevel: "owner",
    usage: "/panic <subcommand>",
    subcommands: [
      { name: "on", description: "Enable panic mode (halt all role changes)" },
      { name: "off", description: "Disable panic mode" },
      { name: "status", description: "Check panic mode status" },
    ],
    examples: ["/panic on", "/panic off", "/panic status"],
    notes: "Persists across bot restarts. Use when role automation is misbehaving.",
    workflowTips: [
      "Enable immediately if roles are being assigned incorrectly",
      "Investigate the issue before disabling",
      "Changes are logged to the audit channel",
    ],
    relatedCommands: ["roles", "movie"],
    aliases: ["halt", "stop", "emergency"],
  },

  // ============================================================================
  // ARTIST SYSTEM
  // ============================================================================
  {
    name: "artistqueue",
    description: "Manage Server Artist rotation queue",
    category: "artist",
    permissionLevel: "staff",
    usage: "/artistqueue <subcommand>",
    subcommands: [
      { name: "list", description: "View current queue order" },
      { name: "sync", description: "Sync queue with Server Artist role" },
      { name: "move", description: "Move artist to specific position" },
      { name: "skip", description: "Temporarily skip artist in rotation" },
      { name: "unskip", description: "Remove skip status" },
      { name: "history", description: "View assignment history" },
      { name: "setup", description: "Initial queue setup" },
    ],
    examples: [
      "/artistqueue list",
      "/artistqueue sync",
      "/artistqueue move user:@Artist position:1",
    ],
    notes: "Requires ManageRoles permission. Sync after role changes to update the queue.",
    workflowTips: [
      "Run /artistqueue sync after adding new artists",
      "Use skip for artists on temporary hiatus",
      "Check history to see past banner rotations",
    ],
    relatedCommands: ["art", "redeemreward"],
    aliases: ["artists", "bannerqueue"],
  },
  {
    name: "art",
    description: "Art rotation commands",
    category: "artist",
    permissionLevel: "staff",
    usage: "/art <subcommand>",
    examples: ["/art status"],
    notes: "Manages the art rotation system for featured artists.",
    workflowTips: ["Check rotation status before artist announcements"],
    relatedCommands: ["artistqueue", "redeemreward"],
    aliases: ["artrotation"],
  },
  {
    name: "redeemreward",
    description: "Redeem art reward ticket",
    category: "artist",
    permissionLevel: "staff",
    usage: "/redeemreward",
    examples: ["/redeemreward"],
    notes: "Interactive flow for artists to redeem their earned tickets.",
    workflowTips: [
      "Artists earn tickets through the rotation system",
      "Different ticket types have different rewards",
    ],
    relatedCommands: ["artistqueue", "art", "inventory"],
    aliases: ["ticket"],
  },

  // ============================================================================
  // EVENTS
  // ============================================================================
  {
    name: "event",
    description: "Event attendance tracking for movie and game nights",
    category: "roles",
    permissionLevel: "staff",
    usage: "/event <movie|game> <subcommand>",
    subcommandGroups: [
      {
        name: "movie",
        description: "Movie night attendance tracking",
        subcommands: [
          { name: "start", description: "Start tracking in a voice channel" },
          { name: "end", description: "End tracking and finalize attendance" },
          { name: "attendance", description: "View attendance stats" },
          { name: "add", description: "Manually add minutes to current event" },
          { name: "credit", description: "Credit minutes to any event date" },
          { name: "bump", description: "Give full credit (compensation)" },
          { name: "resume", description: "Check recovered session status" },
        ],
      },
      {
        name: "game",
        description: "Game night attendance tracking",
        subcommands: [
          { name: "start", description: "Start tracking in a voice channel" },
          { name: "end", description: "End tracking and finalize attendance" },
          { name: "attendance", description: "View attendance stats" },
          { name: "add", description: "Manually add minutes to current event" },
          { name: "credit", description: "Credit minutes to any event date" },
          { name: "bump", description: "Give full credit (compensation)" },
          { name: "resume", description: "Check recovered session status" },
        ],
      },
    ],
    examples: [
      "/event movie start channel:#movie-night-vc",
      "/event movie end",
      "/event game attendance user:@User",
      "/event movie credit user:@User date:2025-12-25 minutes:120",
    ],
    notes: "Unified event tracking for both movie and game nights. Users need 30+ minutes to qualify for tier roles.",
    workflowTips: [
      "Start tracking before the event begins",
      "End when event concludes to finalize attendance",
      "Use credit/bump to fix attendance issues retroactively",
      "Session persists if bot restarts - use resume to check status",
    ],
    relatedCommands: ["roles", "panic", "attendance"],
    aliases: ["movienight", "gamenight"],
  },
  {
    name: "attendance",
    description: "View event attendance stats and leaderboards",
    category: "roles",
    permissionLevel: "public",
    usage: "/attendance <user|leaderboard>",
    subcommands: [
      { name: "user", description: "View your or another user's event stats" },
      { name: "leaderboard", description: "View top event attendees" },
    ],
    options: [
      { name: "user", description: "User to view stats for (defaults to yourself)", type: "user", required: false },
      { name: "type", description: "Filter leaderboard by event type (all/movie/game)", type: "string", required: false },
    ],
    examples: [
      "/attendance user",
      "/attendance user user:@Friend",
      "/attendance leaderboard",
      "/attendance leaderboard type:movie",
    ],
    notes: "Anyone can view attendance stats. Shows movie nights, game nights, total time spent, and recent events.",
    workflowTips: [
      "Use /attendance user to see your own stats",
      "Check /attendance leaderboard to see top community members",
      "Filter by type to see movie-only or game-only rankings",
    ],
    relatedCommands: ["event", "roles"],
    aliases: ["stats", "leaderboard", "events"],
  },

  // ============================================================================
  // SYSTEM & MAINTENANCE
  // ============================================================================
  {
    name: "help",
    description: "Interactive help system for Pawtropolis Tech",
    category: "system",
    permissionLevel: "public",
    usage: "/help [command:<name>] [search:<keyword>] [category:<name>]",
    options: [
      { name: "command", description: "Get detailed help for a specific command", type: "string", required: false },
      { name: "search", description: "Search commands by keyword", type: "string", required: false },
      { name: "category", description: "Browse commands by category", type: "string", required: false },
    ],
    examples: [
      "/help",
      "/help command:accept",
      "/help search:role",
      "/help category:gate",
    ],
    notes: "Shows commands filtered by your permission level. Use autocomplete for faster navigation.",
    workflowTips: [
      "Use command: for detailed documentation on any command",
      "Search: finds commands by name, alias, or description",
      "Click category buttons to browse related commands",
    ],
    relatedCommands: ["health", "config"],
    aliases: ["commands", "?"],
  },
  {
    name: "health",
    description: "Check bot health, uptime, and latency",
    category: "system",
    permissionLevel: "public",
    usage: "/health",
    examples: ["/health"],
    notes: "Available to everyone. Shows uptime, WebSocket ping, and scheduler status.",
    workflowTips: [
      "Quick check if the bot is responsive",
      "WS ping should be under 200ms for healthy connection",
      "Scheduler health shows background task status",
    ],
    relatedCommands: ["database"],
    aliases: ["ping", "status", "uptime"],
  },
  {
    name: "update",
    description: "Update bot activity, status, banner, or avatar",
    category: "system",
    permissionLevel: "staff",
    usage: "/update <subcommand>",
    subcommands: [
      {
        name: "activity",
        description: "Set bot activity (Playing/Watching/etc)",
        options: [
          { name: "type", description: "Activity type", type: "string", required: true },
          { name: "name", description: "Activity text", type: "string", required: true },
        ],
      },
      {
        name: "status",
        description: "Set custom status",
        options: [{ name: "status", description: "Status text", type: "string", required: true }],
      },
      {
        name: "banner",
        description: "Update profile, gate, or welcome banner",
        options: [{ name: "image", description: "Banner image", type: "attachment", required: true }],
      },
      {
        name: "avatar",
        description: "Update bot profile picture",
        options: [{ name: "image", description: "Avatar image (supports GIF)", type: "attachment", required: true }],
      },
    ],
    examples: [
      "/update activity type:playing name:Watching the gate",
      "/update avatar image:<uploaded file>",
    ],
    notes: "Changes persist across restarts. Avatar supports animated GIFs.",
    workflowTips: [
      "Update status during events or maintenance",
      "Banner changes affect profile and gate appearance",
    ],
    relatedCommands: ["health"],
    aliases: ["setstatus", "setactivity"],
  },
  {
    name: "database",
    description: "Database management commands",
    category: "system",
    permissionLevel: "admin",
    usage: "/database <subcommand>",
    subcommands: [
      { name: "check", description: "Check database health and integrity" },
      { name: "recover", description: "Interactive database recovery (admin only)" },
    ],
    examples: ["/database check", "/database recover"],
    notes: "Check verifies local and remote database integrity. Recover requires admin permissions.",
    workflowTips: [
      "Run /database check periodically to verify integrity",
      "Use recover only when instructed by bot developer",
    ],
    relatedCommands: ["health"],
    aliases: ["db"],
  },
  {
    name: "resetdata",
    description: "Reset metrics data from now forward",
    category: "system",
    permissionLevel: "admin",
    usage: "/resetdata password:<text>",
    options: [
      { name: "password", description: "Reset password for confirmation", type: "string", required: true },
    ],
    examples: ["/resetdata password:secretpass"],
    notes: "Requires ManageGuild permission and password. Resets metrics epoch and clears caches.",
    workflowTips: [
      "Use after major server changes that invalidate old data",
      "Cannot be undone - historical data is preserved but excluded",
    ],
    relatedCommands: ["database"],
    aliases: ["reset"],
  },
  {
    name: "backfill",
    description: "Backfill message activity data for heatmap",
    category: "system",
    permissionLevel: "owner",
    usage: "/backfill [weeks:<1-8>] [dry-run:<bool>]",
    options: [
      { name: "weeks", description: "Weeks to backfill (default: 8)", type: "integer", required: false },
      { name: "dry-run", description: "Preview without saving", type: "boolean", required: false },
    ],
    examples: ["/backfill weeks:4", "/backfill dry-run:true"],
    notes: "Owner-only. Runs as background process with progress notifications.",
    workflowTips: [
      "Run after initial bot setup to populate activity data",
      "Use dry-run to preview message counts first",
    ],
    relatedCommands: ["stats"],
    aliases: ["populate", "filldata"],
  },
  {
    name: "developer",
    description: "Developer tools for debugging and trace inspection",
    category: "system",
    permissionLevel: "staff",
    usage: "/developer <subcommand>",
    subcommands: [
      {
        name: "trace",
        description: "Look up a trace by ID from an error card",
        options: [
          { name: "trace_id", description: "Trace ID from error card footer", type: "string", required: true },
        ],
      },
      { name: "stats", description: "Show trace cache statistics" },
    ],
    examples: [
      "/developer trace trace_id:xd6i6lUUV6g",
      "/developer stats",
    ],
    notes: "Staff-only debugging tools. Trace IDs are found in error card footers and stored for 30 minutes.",
    workflowTips: [
      "Copy trace ID from error card footer when investigating issues",
      "Trace shows full execution timeline, database queries, and error details",
      "Use stats to monitor trace cache health",
    ],
    relatedCommands: ["health", "database"],
    aliases: ["dev", "debug", "trace"],
  },
  {
    name: "skullmode",
    description: "Configure skull emoji reaction chance",
    category: "system",
    permissionLevel: "owner",
    usage: "/skullmode chance:<1-1000>",
    options: [
      { name: "chance", description: "Odds: 1 in N messages get skulled", type: "integer", required: true },
    ],
    examples: [
      "/skullmode chance:100",
      "/skullmode chance:1000",
    ],
    notes: "Owner-only fun command. Sets odds for bot to react with skull emoji. 1 = every message, 1000 = rare.",
    workflowTips: [
      "Lower numbers = more frequent skulls",
      "Set to 1000 for occasional surprise reactions",
    ],
    relatedCommands: ["config"],
    aliases: ["skull"],
  },

  // ============================================================================
  // GATE (continued) — batched welcome session
  // ============================================================================
  {
    name: "welcomebatch",
    description: "Batch multiple accepted users into one welcome message",
    category: "gate",
    permissionLevel: "staff",
    usage: "/welcomebatch <subcommand>",
    subcommands: [
      { name: "start", description: "Open a batch session — pending welcomes are queued instead of sent" },
      { name: "send", description: "Send the combined welcome card and close the session" },
      { name: "cancel", description: "Discard the buffered welcomes and close the session" },
      { name: "status", description: "Show batch session status (queued users, time remaining)" },
    ],
    examples: ["/welcomebatch start", "/welcomebatch send", "/welcomebatch status"],
    notes: "Gatekeeper+ only. Useful when accepting several users in a row so the channel gets one welcome message instead of N.",
    relatedCommands: ["accept", "gate"],
    aliases: ["batch", "welcome-batch"],
  },

  // ============================================================================
  // MEMBERSHIP & VERIFICATION
  // ============================================================================
  {
    name: "verify",
    description: "Self-verify first responder or military status for the Thin Line role",
    category: "gate",
    permissionLevel: "public",
    usage: "/verify",
    examples: ["/verify"],
    notes: "Honor-system verification. Runs an ephemeral flow, optionally accepts a document upload, and grants a cosmetic role on completion. Logged to the verification channel.",
    relatedCommands: ["accept"],
    aliases: ["firstresponder", "military", "thin-line"],
  },
  {
    name: "admin-migrate-unverified",
    description: "One-shot migration that creates per-user verify threads for every current unverified member",
    category: "gate",
    permissionLevel: "admin",
    usage: "/admin-migrate-unverified",
    examples: ["/admin-migrate-unverified"],
    notes: "Server Dev / Community Manager only. Run BEFORE locking down @everyone View on the lobby category so existing unverified members still get a thread and verification prompt.",
    workflowTips: [
      "Run during low-traffic hours — creates one thread per unverified user",
      "Safe to re-run; existing threads are not duplicated",
    ],
    relatedCommands: ["verify", "gate"],
    aliases: ["migrate-unverified", "verify-migration"],
  },

  // ============================================================================
  // MODERATION (continued)
  // ============================================================================
  {
    name: "cleanup",
    description: "Purge up to 1000 recent messages from this channel",
    category: "moderation",
    permissionLevel: "staff",
    usage: "/cleanup count:<1-1000> [reason:<text>]",
    options: [
      { name: "count", description: "How many messages to purge (1–1000)", type: "integer", required: true },
      { name: "reason", description: "Reason logged to the audit channel", type: "string", required: false },
    ],
    examples: ["/cleanup count:50", "/cleanup count:200 reason:Spam wave"],
    notes: "Moderator+. Messages older than 14 days are skipped (Discord bulk-delete limit) and reported in the result.",
    relatedCommands: ["purge", "flag"],
    aliases: ["clear", "sweep"],
  },
  {
    name: "restoreroles",
    description: "Re-grant the roles a returning member had before they left, were kicked, or banned",
    category: "roles",
    permissionLevel: "admin",
    usage: "/restoreroles user:<@user> [dry_run:<bool>]",
    options: [
      { name: "user", description: "User to restore roles for", type: "user", required: true },
      { name: "dry_run", description: "Preview what would be restored without applying", type: "boolean", required: false },
    ],
    examples: ["/restoreroles user:@JaneReturning", "/restoreroles user:@JaneReturning dry_run:true"],
    notes: "Administrator+. Pulls the most recent snapshot from member_role_snapshots, filters out deleted/managed/hierarchy/already-has roles, and applies the remainder in one batch. Logged to action_log.",
    relatedCommands: ["roles", "audit"],
    aliases: ["restore-roles", "regrant", "return"],
  },

  // ============================================================================
  // FIRST-PARTY TICKETS
  // ============================================================================
  {
    name: "postticketpanel",
    description: "Post (or refresh in place) the ticket-system panel embeds in the configured channel",
    category: "system",
    permissionLevel: "admin",
    usage: "/postticketpanel",
    examples: ["/postticketpanel"],
    notes: "ManageGuild required. Idempotent — re-run after ticket type registry changes to refresh the embeds without spamming the channel.",
    relatedCommands: ["closeticket", "assignticket"],
    aliases: ["ticket-panel", "panel"],
  },
  {
    name: "closeticket",
    description: "Close the current ticket channel (slash-command alternative to the red Close button)",
    category: "system",
    permissionLevel: "staff",
    usage: "/closeticket [reason:<text>]",
    options: [
      { name: "reason", description: "Reason saved in the ticket transcript", type: "string", required: false },
    ],
    examples: ["/closeticket", "/closeticket reason:Resolved in DMs"],
    notes: "Community Ambassador or Mod Team only. Same gate as the red Close button on the greeting embed. Useful when the greeting message has scrolled off-screen.",
    relatedCommands: ["postticketpanel", "assignticket"],
    aliases: ["close-ticket"],
  },
  {
    name: "assignticket",
    description: "Manually swap the assigned artist on a first-party art ticket",
    category: "system",
    permissionLevel: "staff",
    usage: "/assignticket artist:<@user>",
    options: [
      { name: "artist", description: "Artist to assign to the current ticket", type: "user", required: true },
    ],
    examples: ["/assignticket artist:@NewArtist"],
    notes: "ManageRoles / Community Ambassador / Mod Team. Atomically updates ticket perms, closes prior art_job, and inserts a new art_job linked to the ticket. Posts a visible reassignment embed.",
    relatedCommands: ["postticketpanel", "closeticket", "artistqueue"],
    aliases: ["reassign", "swap-artist"],
  },

  // ============================================================================
  // REVIEW NOTIFY CONFIG
  // ============================================================================
  {
    name: "review-set-notify-config",
    description: "Configure forum-post notification settings for the review queue",
    category: "config",
    permissionLevel: "admin",
    usage: "/review-set-notify-config [mode:<post|channel>] [role:<@role>] [channel:<#channel>] [cooldown:<sec>] [max_per_hour:<n>]",
    options: [
      { name: "mode", description: "Notification mode: 'post' (in-thread) or 'channel' (separate)", type: "string", required: false, choices: [{ name: "post (in-thread)", value: "post" }, { name: "channel (separate)", value: "channel" }] },
      { name: "role", description: "Role to ping on new forum posts", type: "role", required: false },
      { name: "channel", description: "Channel to post notifications to (channel mode only)", type: "channel", required: false },
      { name: "cooldown", description: "Cooldown seconds between pings to the same role", type: "integer", required: false },
      { name: "max_per_hour", description: "Hard cap on pings per hour", type: "integer", required: false },
    ],
    examples: [
      "/review-set-notify-config mode:post role:@Reviewers cooldown:600",
      "/review-set-notify-config mode:channel channel:#review-pings max_per_hour:6",
    ],
    notes: "Administrator/Leadership only. Rate limiting prevents review-queue ping spam from drowning reviewers.",
    relatedCommands: ["review-get-notify-config", "review-set-listopen-output", "listopen"],
    aliases: ["notify-config", "review-notify"],
  },
  {
    name: "review-get-notify-config",
    description: "View the current review forum-post notification settings",
    category: "config",
    permissionLevel: "admin",
    usage: "/review-get-notify-config",
    examples: ["/review-get-notify-config"],
    notes: "Administrator/Leadership only. Read-only inspection of the values set by /review-set-notify-config.",
    relatedCommands: ["review-set-notify-config", "review-set-listopen-output"],
    aliases: ["notify-config-get", "show-notify-config"],
  },
  {
    name: "review-set-listopen-output",
    description: "Toggle whether /listopen output is public or ephemeral",
    category: "config",
    permissionLevel: "admin",
    usage: "/review-set-listopen-output mode:<public|ephemeral>",
    options: [
      { name: "mode", description: "Visibility for /listopen replies", type: "string", required: true, choices: [{ name: "public", value: "public" }, { name: "ephemeral", value: "ephemeral" }] },
    ],
    examples: [
      "/review-set-listopen-output mode:public",
      "/review-set-listopen-output mode:ephemeral",
    ],
    notes: "ManageGuild required. Some servers want /listopen public for accountability; others want it ephemeral to reduce noise.",
    relatedCommands: ["listopen", "review-set-notify-config"],
    aliases: ["listopen-output", "listopen-visibility"],
  },

  // ============================================================================
  // QUESTION OF THE DAY
  // ============================================================================
  {
    name: "qotd",
    description: "Question of the Day suggestion system — community suggests, staff curate",
    category: "messaging",
    permissionLevel: "public",
    usage: "/qotd <subcommand>",
    subcommands: [
      { name: "suggest", description: "Open a modal to suggest a Question of the Day" },
      { name: "queue", description: "View QOTD queue status (staff)" },
      { name: "pull", description: "Pull a random approved QOTD suggestion (staff)" },
    ],
    examples: ["/qotd suggest", "/qotd queue", "/qotd pull"],
    notes: "Anyone can `suggest`. `queue` and `pull` are staff-only (Gatekeeper+). Approved suggestions are pulled at random and marked used so they don't repeat.",
    relatedCommands: ["send", "modmail"],
    aliases: ["question", "questionoftheday"],
  },
];

/**
 * Get a command by name from the registry.
 */
// O(n) lookup. For 30-ish commands this is fine. If the registry grows to hundreds
// of commands, consider building a Map at module load time. But honestly, if you
// have hundreds of commands, the registry structure is the least of your problems.
export function getCommand(name: string): CommandMetadata | undefined {
  return COMMAND_REGISTRY.find((cmd) => cmd.name === name);
}

/**
 * Get all commands in a specific category.
 */
export function getCommandsByCategory(category: CommandCategory): CommandMetadata[] {
  return COMMAND_REGISTRY.filter((cmd) => cmd.category === category);
}

/**
 * Get all unique category keys from the registry.
 */
// Returns categories in order of first appearance in the registry.
// If you want alphabetical order, sort it yourself.
export function getAllCategories(): CommandCategory[] {
  return [...new Set(COMMAND_REGISTRY.map((cmd) => cmd.category))];
}
