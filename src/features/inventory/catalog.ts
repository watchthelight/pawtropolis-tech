// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/catalog.ts
 * WHAT: Which roles are inventory items, and how a repeat grant of one is treated.
 * WHY: The capture path must not eat arbitrary roles. Only catalogued roles are ever
 *      removed and banked, and each entry carries its own dedup policy.
 * SOURCES:
 *  - art tickets: getTicketRoles() from artistRotation/constants.ts
 *  - byte tokens: BYTE_TOKEN_CONFIG from constants/byteTokens.ts
 *  - anything else: inventory_extra_roles_json guild config
 *
 * Level reward roles need no separate seeding: level_rewards points at the same ticket
 * and token roles above. A level reward that grants some other role (a cosmetic colour,
 * say) is deliberately NOT an item unless it is added to inventory_extra_roles_json.
 */

import { getConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { getTicketRoles, ART_TYPE_DISPLAY } from "../artistRotation/constants.js";
import type { ArtType } from "../artistRotation/constants.js";
import { BYTE_TOKEN_CONFIG } from "../../constants/byteTokens.js";

type ItemSource = "art" | "byte" | "extra";

/**
 * once_per_key: the grant counts once per grant key, ever. For reward bots that re-sync
 *               their roles and would otherwise inflate a stack on every sweep.
 * every_grant:  each grant is a real new item, subject only to the debounce window.
 *               Correct for purchases and giveaway drops.
 */
export type GrantPolicy = "once_per_key" | "every_grant";

export interface CatalogItem {
  itemKey: string;
  roleId: string;
  display: string;
  source: ItemSource;
  policy: GrantPolicy;
}

const DEFAULT_GRACE_SECONDS = 60;
const DEFAULT_DEBOUNCE_SECONDS = 120;

export function inventoryEnabled(guildId: string): boolean {
  return getConfig(guildId)?.inventory_enabled === "true";
}

/** Seconds the bot waits after a role lands before taking it into inventory. */
export function graceSeconds(guildId: string): number {
  const raw = getConfig(guildId)?.inventory_grace_seconds;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GRACE_SECONDS;
  return Math.floor(n);
}

/** Window in which a repeat credit of the same item is treated as a re-sync, not a new item. */
export function debounceSeconds(guildId: string): number {
  const raw = getConfig(guildId)?.inventory_debounce_seconds;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DEBOUNCE_SECONDS;
  return Math.floor(n);
}

/**
 * Explicit allowlist of bots whose grants are banked.
 * Empty means "any bot other than us", which is the intended default: mods handing out
 * a role by hand should not have it swallowed, and our own re-issues are never captured.
 */
export function sourceBotAllowlist(guildId: string): Set<string> {
  const raw = getConfig(guildId)?.inventory_source_bot_ids_json;
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    logger.warn({ guildId }, "[inventory] inventory_source_bot_ids_json is not valid JSON, ignoring");
  }
  return new Set();
}

interface ExtraRoleEntry {
  roleId?: string;
  itemKey?: string;
  display?: string;
  policy?: string;
}

function extraItems(guildId: string): CatalogItem[] {
  const raw = getConfig(guildId)?.inventory_extra_roles_json;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ guildId }, "[inventory] inventory_extra_roles_json is not valid JSON, ignoring");
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const items: CatalogItem[] = [];
  for (const entry of parsed as ExtraRoleEntry[]) {
    if (!entry?.roleId || !entry?.itemKey) continue;
    items.push({
      itemKey: String(entry.itemKey),
      roleId: String(entry.roleId),
      display: String(entry.display ?? entry.itemKey),
      source: "extra",
      policy: entry.policy === "once_per_key" ? "once_per_key" : "every_grant",
    });
  }
  return items;
}

/**
 * The full item catalog for a guild.
 * Later entries win on roleId collision, so inventory_extra_roles_json can override the
 * display name or policy of a built-in ticket or token role.
 */
// Keyed by the cached GuildConfig object: getConfig hands out the same object until a
// config write or the cache TTL replaces it, and every input to the catalog comes from
// that row. handleItemRoleAdded calls getItemByRoleId once per role on every member
// update, which re-parsed the config JSON each time without this.
const catalogByConfig = new WeakMap<object, CatalogItem[]>();

export function getItemCatalog(guildId: string): CatalogItem[] {
  const cfg = getConfig(guildId);
  const cached = cfg ? catalogByConfig.get(cfg) : undefined;
  if (cached) return cached;

  const byRole = new Map<string, CatalogItem>();

  const ticketRoles = getTicketRoles(guildId);
  for (const [artType, roleId] of Object.entries(ticketRoles) as Array<[ArtType, string | null]>) {
    if (!roleId) continue;
    byRole.set(roleId, {
      itemKey: `art:${artType}`,
      roleId,
      display: `${ART_TYPE_DISPLAY[artType]} Ticket`,
      source: "art",
      policy: "every_grant",
    });
  }

  for (const cfg of Object.values(BYTE_TOKEN_CONFIG)) {
    byRole.set(cfg.tokenRoleId, {
      itemKey: `byte:${cfg.rarity}`,
      roleId: cfg.tokenRoleId,
      display: cfg.tokenRoleName,
      source: "byte",
      policy: "every_grant",
    });
  }

  for (const item of extraItems(guildId)) {
    byRole.set(item.roleId, item);
  }

  const items = [...byRole.values()];
  if (cfg) catalogByConfig.set(cfg, items);
  return items;
}

export function getItemByRoleId(guildId: string, roleId: string): CatalogItem | null {
  return getItemCatalog(guildId).find((i) => i.roleId === roleId) ?? null;
}

export function getItemByKey(guildId: string, itemKey: string): CatalogItem | null {
  return getItemCatalog(guildId).find((i) => i.itemKey === itemKey) ?? null;
}

/** Display name for an item key, falling back to the raw key for retired catalog entries. */
export function displayForKey(guildId: string, itemKey: string): string {
  return getItemByKey(guildId, itemKey)?.display ?? itemKey;
}
