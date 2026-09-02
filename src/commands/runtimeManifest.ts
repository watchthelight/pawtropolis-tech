// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/commands/runtimeManifest.ts
 *
 * Single source of truth for the names of every slash command and context
 * menu the bot dispatches at runtime. Intentionally string-only (no imports
 * of command modules) so tests can inspect it without booting the Discord
 * client.
 *
 * Invariants enforced by tests/commands/registration.test.ts:
 *   - every entry in SLASH_COMMAND_NAMES has a corresponding JSON payload
 *     in src/commands/buildCommands.ts
 *   - every JSON payload in buildCommands() is in SLASH_COMMAND_NAMES or
 *     CONTEXT_MENU_NAMES
 *   - the gate command and its four aliases (accept/reject/kick/unclaim)
 *     are all present
 *
 * src/index.ts asserts at startup that commands.size === SLASH_COMMAND_NAMES
 * length and that each name is wired to a handler.
 */

export const SLASH_COMMAND_NAMES = [
  // Gate workflow + aliases
  "gate",
  "accept",
  "reject",
  "kick",
  "unclaim",
  "welcomebatch",

  // System / admin
  "health",
  "update",
  "config",
  "database",

  // Feature commands
  "modmail",
  "stats",
  "event",
  "send",
  "resetdata",
  "resetprofile",
  "purge",
  "cleanup",
  "flag",
  "sample",
  "listopen",
  "review-set-notify-config",
  "review-get-notify-config",
  "poke",
  "unblock",
  "backfill",
  "review-set-listopen-output",
  "movie",
  "roles",
  "panic",
  "search",

  // Artist rotation
  "artistqueue",
  "redeemreward",
  "art",

  // Byte tokens
  "usebyte",
  "stash",
  "redeem",

  // Admin tooling
  "audit",
  "isitreal",

  // Help
  "help",

  // Dev tools
  "developer",
  "test",
  "skullmode",

  // Reports
  "report",

  // Events / QOTD / verify
  "attendance",
  "qotd",
  "verify",
  "admin-migrate-unverified",

  // First-party ticket system
  "postticketpanel",
  "closeticket",
  "assignticket",

  // Role recovery
  "restoreroles",

  // Staff-hoist experiment toggle
  "testidea",
] as const;

export const CONTEXT_MENU_NAMES = [
  "Is It Real?",
  "Modmail: Open",
  "Welcome Batch",
] as const;

export const ALL_REGISTERED_NAMES = [
  ...SLASH_COMMAND_NAMES,
  ...CONTEXT_MENU_NAMES,
] as const;

/**
 * Slash command names that exist in the runtime dispatch table but are
 * intentionally NOT registered with Discord. Empty for now; declared so
 * future internal-only commands can be exempted from drift checks with
 * an explicit, reviewed entry rather than a silent gap.
 */
export const INTERNAL_ONLY_RUNTIME_NAMES: readonly string[] = [] as const;
