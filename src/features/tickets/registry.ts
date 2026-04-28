/**
 * Pawtropolis Tech -- src/features/tickets/registry.ts
 * WHAT: Loads the ticket_type registry from SQLite into a typed in-memory Map.
 * WHY: Hot path — every panel render, every button click, every channel rename
 *      reads from the registry. Parsing JSON columns once and caching avoids
 *      per-interaction overhead.
 *
 * USAGE:
 *   import { getTicketType, listActiveTypes, reloadRegistry } from "./registry.js";
 *   const cfg = getTicketType("art-redeem");
 *
 * REFRESH: The registry is loaded lazily on first access. Call reloadRegistry()
 * after any /admin command that mutates ticket_type rows. There is no admin
 * command for that yet; types are seeded by migration only.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import type {
  ButtonEmoji,
  DiscordButtonStyle,
  PanelStack,
  PermTemplate,
  TicketTypeConfig,
  TicketTypeRow,
} from "./types.js";

let cache: Map<string, TicketTypeConfig> | null = null;

function parseEmoji(raw: string | null): ButtonEmoji | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name === "string") {
      return {
        name: parsed.name,
        id: typeof parsed.id === "string" ? parsed.id : undefined,
        animated: parsed.animated === true,
      };
    }
    return null;
  } catch {
    logger.warn({ raw }, "[tickets/registry] failed to parse button_emoji JSON");
    return null;
  }
}

function parsePermTemplate(raw: string): PermTemplate {
  const parsed = JSON.parse(raw);
  return {
    everyone_deny: Array.isArray(parsed.everyone_deny) ? parsed.everyone_deny : [],
    roles: Array.isArray(parsed.roles)
      ? parsed.roles.map((r: { id: string; allow: string[] }) => ({
          id: String(r.id),
          allow: Array.isArray(r.allow) ? r.allow : [],
        }))
      : [],
    opener_allow: Array.isArray(parsed.opener_allow) ? parsed.opener_allow : [],
    opener_deny: Array.isArray(parsed.opener_deny) ? parsed.opener_deny : [],
  };
}

function parseRoleIds(raw: string): string[] {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function rowToConfig(row: TicketTypeRow): TicketTypeConfig {
  if (row.panel_stack !== "tickets" && row.panel_stack !== "verification") {
    throw new Error(
      `[tickets/registry] invalid panel_stack '${row.panel_stack}' for type '${row.key}'`
    );
  }
  if (row.button_style < 1 || row.button_style > 4) {
    throw new Error(
      `[tickets/registry] invalid button_style ${row.button_style} for type '${row.key}'`
    );
  }
  return {
    key: row.key,
    label: row.label,
    panelStack: row.panel_stack as PanelStack,
    panelPosition: row.panel_position,
    buttonEmoji: parseEmoji(row.button_emoji),
    buttonStyle: row.button_style as DiscordButtonStyle,
    embedColor: row.embed_color,
    numCounterKey: row.num_counter_key,
    channelNameTemplate: row.channel_name_template,
    greetingMd: row.greeting_md,
    pingRoleIds: parseRoleIds(row.ping_role_ids),
    permTemplate: parsePermTemplate(row.perm_template_json),
    hasStaffThread: row.has_staff_thread === 1,
    isActive: row.is_active === 1,
  };
}

function load(): Map<string, TicketTypeConfig> {
  const rows = db
    .prepare(
      `SELECT key, label, panel_stack, panel_position, button_emoji, button_style,
              embed_color, num_counter_key, channel_name_template, greeting_md,
              ping_role_ids, perm_template_json, has_staff_thread, is_active,
              created_at, updated_at
       FROM ticket_type`
    )
    .all() as TicketTypeRow[];

  const map = new Map<string, TicketTypeConfig>();
  for (const row of rows) {
    try {
      const cfg = rowToConfig(row);
      map.set(cfg.key, cfg);
    } catch (err) {
      logger.error({ err, key: row.key }, "[tickets/registry] failed to load type — skipped");
    }
  }
  logger.info({ count: map.size }, "[tickets/registry] loaded ticket types");
  return map;
}

/** Returns the cached registry, loading from DB on first call. */
export function getRegistry(): Map<string, TicketTypeConfig> {
  if (!cache) cache = load();
  return cache;
}

/** Forces a fresh load from the database. Call after admin edits to ticket_type. */
export function reloadRegistry(): void {
  cache = load();
}

/** Returns config for a single type key, or null if unknown. */
export function getTicketType(key: string): TicketTypeConfig | null {
  return getRegistry().get(key) ?? null;
}

/** All active types, ordered by panel_stack then panel_position. */
export function listActiveTypes(): TicketTypeConfig[] {
  const all = [...getRegistry().values()].filter((t) => t.isActive);
  all.sort((a, b) => {
    if (a.panelStack !== b.panelStack) return a.panelStack.localeCompare(b.panelStack);
    return a.panelPosition - b.panelPosition;
  });
  return all;
}

/** Active types within a single panel, ordered by panelPosition. */
export function listActiveTypesByStack(stack: PanelStack): TicketTypeConfig[] {
  return listActiveTypes()
    .filter((t) => t.panelStack === stack)
    .sort((a, b) => a.panelPosition - b.panelPosition);
}
