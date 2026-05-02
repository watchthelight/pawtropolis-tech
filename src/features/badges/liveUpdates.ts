// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/liveUpdates.ts
 * WHAT: Discord event listeners that re-resolve a single badge as soon as
 *       its underlying role/channel/user changes.
 * WHY: Daily refresh keeps things eventually correct, but renames and color
 *       changes should propagate to the docs in seconds, not 24 hours.
 *
 * Per-badge debounce (1500ms) absorbs Discord's rapid-fire dispatch when an
 * admin clicks Save on the role editor. Errors are caught and logged; badge
 * state never blocks Discord event handling.
 */

import type {
  Client,
  Role,
  GuildBasedChannel,
  User,
  PartialUser,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  defaultStoreConfig,
  listBadgeDefinitions,
  manifestEntryUrl,
  readManifest,
  renderBadgeSvg,
  upsertManifestEntry,
  writeBadgeSvg,
  writeManifest,
} from "./index.js";
import type {
  BadgeDefinition,
  BadgeStoreConfig,
} from "./index.js";
import { resolveBadge } from "./resolve.js";

const DEBOUNCE_MS = 1500;
const pending = new Map<string, NodeJS.Timeout>();

let attached = false;

function defsForDiscordId(
  discordId: string,
  kind: BadgeDefinition["kind"],
): BadgeDefinition[] {
  return listBadgeDefinitions().filter(
    (d) => d.discordId === discordId && d.kind === kind,
  );
}

async function refreshOne(
  client: Client,
  def: BadgeDefinition,
  config: BadgeStoreConfig,
): Promise<void> {
  const guildId = process.env.GUILD_ID;
  if (!guildId) return;
  let manifest = readManifest(config);
  const prior = manifest.entries[def.id];
  const result = await resolveBadge(def, { client, guildId, prior });
  const entry = {
    ...result,
    style: def.style,
    url: manifestEntryUrl(config, def.id),
    generatedAt: new Date().toISOString(),
  };
  try {
    writeBadgeSvg(config, def.id, renderBadgeSvg(entry));
  } catch (err) {
    logger.warn(
      { evt: "badge_live_write_failed", id: def.id, err: (err as Error).message },
      "[badges] live update svg write failed",
    );
  }
  manifest = upsertManifestEntry(manifest, entry);
  try {
    writeManifest(config, manifest);
  } catch (err) {
    logger.warn(
      { evt: "badge_live_manifest_failed", id: def.id, err: (err as Error).message },
      "[badges] live update manifest write failed",
    );
  }
  logger.info(
    { evt: "badge_live_refreshed", id: def.id, displayName: result.displayName, stale: result.stale },
    "[badges] live refresh applied",
  );
}

function scheduleRefresh(
  client: Client,
  defs: BadgeDefinition[],
  config: BadgeStoreConfig,
): void {
  for (const def of defs) {
    const existing = pending.get(def.id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      pending.delete(def.id);
      refreshOne(client, def, config).catch((err) => {
        logger.warn(
          { evt: "badge_live_refresh_failed", id: def.id, err: (err as Error).message },
          "[badges] live refresh failed",
        );
      });
    }, DEBOUNCE_MS);
    t.unref?.();
    pending.set(def.id, t);
  }
}

export function attachBadgeLiveListeners(
  client: Client,
  config: BadgeStoreConfig = defaultStoreConfig(),
): void {
  if (attached) return;
  attached = true;

  client.on("roleUpdate", (_old: Role, next: Role) => {
    const defs = defsForDiscordId(next.id, "role");
    if (defs.length === 0) return;
    scheduleRefresh(client, defs, config);
  });
  client.on("roleDelete", (role: Role) => {
    const defs = defsForDiscordId(role.id, "role");
    if (defs.length === 0) return;
    scheduleRefresh(client, defs, config);
  });
  client.on(
    "channelUpdate",
    (_old: unknown, next: GuildBasedChannel | unknown) => {
      const c = next as { id?: string } | undefined;
      if (!c?.id) return;
      const defs = defsForDiscordId(c.id, "channel");
      if (defs.length === 0) return;
      scheduleRefresh(client, defs, config);
    },
  );
  client.on("channelDelete", (channel: GuildBasedChannel | unknown) => {
    const c = channel as { id?: string } | undefined;
    if (!c?.id) return;
    const defs = defsForDiscordId(c.id, "channel");
    if (defs.length === 0) return;
    scheduleRefresh(client, defs, config);
  });
  client.on("userUpdate", (_old: User | PartialUser, next: User) => {
    const defs = defsForDiscordId(next.id, "user");
    if (defs.length === 0) return;
    scheduleRefresh(client, defs, config);
  });

  logger.info(
    { evt: "badge_live_listeners_attached" },
    "[badges] live update listeners attached",
  );
}

export function detachBadgeLiveListeners(client: Client): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  // discord.js does not have removeAll for selected handlers; production
  // teardown happens via client.destroy(). This stub keeps the API
  // symmetric for tests that need it.
  void client;
  attached = false;
}

export function _resetForTests(): void {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  attached = false;
}
