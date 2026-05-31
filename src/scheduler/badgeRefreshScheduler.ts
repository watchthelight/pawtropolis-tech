// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/scheduler/badgeRefreshScheduler.ts
 * WHAT: Daily refresh of every registered Discord badge.
 * WHY: Role names and colors do drift; we want the docs to stay current
 *      without a manual regen. Refresh interval is configurable; default
 *      is 24 hours. Initial refresh is delayed so we do not hammer Discord
 *      during startup.
 *
 * Failure mode: per-badge errors are caught inside resolveBadge; this
 * scheduler never crashes the bot. Discord API rate use is paced via a
 * small inter-badge delay.
 */

import type { Client } from "discord.js";
import { logger } from "../lib/logger.js";
import {
  defaultStoreConfig,
  listBadgeDefinitions,
  manifestEntryUrl,
  readManifest,
  renderBadgeSvg,
  resolveBadge,
  upsertManifestEntry,
  writeBadgeSvg,
  writeManifest,
} from "../features/badges/index.js";
import type {
  BadgeManifestEntry,
  BadgeStoreConfig,
} from "../features/badges/index.js";

const DEFAULT_INTERVAL_HOURS = 24;
const STARTUP_DELAY_MS = 60_000;
const PER_BADGE_DELAY_MS = 50;

let timer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

function intervalMs(): number {
  const raw = process.env.BADGE_REFRESH_INTERVAL_HOURS;
  const hours = raw ? parseFloat(raw) : DEFAULT_INTERVAL_HOURS;
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_INTERVAL_HOURS * 3600 * 1000;
  return Math.max(60_000, Math.floor(hours * 3600 * 1000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function refreshAllBadges(
  client: Client,
  config: BadgeStoreConfig = defaultStoreConfig(),
): Promise<{ resolved: number; stale: number }> {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    logger.warn("[badges] GUILD_ID not set; skipping badge refresh");
    return { resolved: 0, stale: 0 };
  }
  if (!client.isReady()) {
    logger.warn("[badges] client not ready; skipping refresh");
    return { resolved: 0, stale: 0 };
  }
  const defs = listBadgeDefinitions();
  let manifest = readManifest(config);
  let resolved = 0;
  let stale = 0;
  for (const def of defs) {
    const prior = manifest.entries[def.id];
    const result = await resolveBadge(def, { client, guildId, prior });
    const entry: BadgeManifestEntry = {
      ...result,
      style: def.style,
      url: manifestEntryUrl(config, def.id),
      generatedAt: new Date().toISOString(),
    };
    try {
      const svg = renderBadgeSvg(entry);
      writeBadgeSvg(config, def.id, svg);
    } catch (err) {
      logger.warn(
        { evt: "badge_write_failed", id: def.id, err: (err as Error).message },
        "[badges] failed to write SVG",
      );
    }
    manifest = upsertManifestEntry(manifest, entry);
    if (result.stale) stale += 1;
    else resolved += 1;
    if (PER_BADGE_DELAY_MS > 0) await sleep(PER_BADGE_DELAY_MS);
  }
  try {
    writeManifest(config, manifest);
  } catch (err) {
    logger.error(
      { evt: "badge_manifest_write_failed", err: (err as Error).message },
      "[badges] failed to write manifest",
    );
  }
  logger.info(
    { evt: "badge_refresh_done", resolved, stale, total: defs.length },
    "[badges] refresh complete",
  );
  return { resolved, stale };
}

export function startBadgeRefreshScheduler(client: Client): void {
  const ms = intervalMs();
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    refreshAllBadges(client).catch((err) => {
      logger.error({ err }, "[badges] startup refresh failed");
    });
  }, STARTUP_DELAY_MS);
  startupTimer.unref?.();

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    refreshAllBadges(client).catch((err) => {
      logger.error({ err }, "[badges] scheduled refresh failed");
    });
  }, ms);
  timer.unref?.();
  logger.info(
    { evt: "badge_scheduler_started", intervalMs: ms },
    "[badges] refresh scheduler started",
  );
}

export function stopBadgeRefreshScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
}
