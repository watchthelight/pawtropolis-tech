// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/scheduler/itemCaptureScheduler.ts
 * WHAT: Drains pending_item_capture once each grace window expires.
 * WHY: The grace window is the whole point of the delay Taylor asked for: Mimu and Amari
 *      get to finish verifying their own grant before the role disappears. Doing the work
 *      here rather than in a setTimeout means a restart mid-window still banks the item.
 * FLOWS:
 *  - every 10s: due rows -> audit log check -> remove role -> credit inventory
 *  - transient failures are deferred and retried, not dropped
 */

import type { Client } from "discord.js";
import { logger } from "../lib/logger.js";
import { recordSchedulerRun } from "../lib/schedulerHealth.js";
import { isPanicMode } from "../features/panicStore.js";
import { removeRole } from "../features/roleAutomation.js";
import { logActionPretty } from "../logging/pretty.js";
import {
  debounceSeconds,
  getItemByRoleId,
  inventoryEnabled,
  sourceBotAllowlist,
} from "../features/inventory/catalog.js";
import { decideDedup, isSuppressed, clearSuppression } from "../features/inventory/capture.js";
import { decideSource, resolveRoleGrantExecutor } from "../features/inventory/executor.js";
import {
  claimGrantKey,
  creditItem,
  creditedWithin,
  deferCapture,
  deleteCapture,
  dueCaptures,
  type PendingCapture,
} from "../features/inventory/store.js";

const DRAIN_INTERVAL_MS = 10 * 1000;
const ROLE_WRITE_DELAY_MS = 1100;
const RETRY_DELAY_S = 60;
const MAX_ATTEMPTS = 5;

let _activeInterval: NodeJS.Timeout | null = null;
let _draining = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process one queued capture.
 * RETURNS: true when a role write happened, so the caller knows to pace the next one.
 */
async function processCapture(client: Client, row: PendingCapture): Promise<boolean> {
  const guild = client.guilds.cache.get(row.guild_id) ?? null;
  if (!guild) {
    logger.warn({ guildId: row.guild_id, captureId: row.id }, "[inventory] guild not cached, dropping capture");
    deleteCapture(row.id);
    return false;
  }

  // Both of these can flip between queueing and draining. Leave the row queued so the
  // item is still banked once the brake comes off.
  if (!inventoryEnabled(row.guild_id) || isPanicMode(row.guild_id)) return false;

  const member = await guild.members.fetch(row.user_id).catch(() => null);
  if (!member) {
    logger.info({ guildId: row.guild_id, userId: row.user_id, captureId: row.id },
      "[inventory] member left before capture, dropping");
    deleteCapture(row.id);
    return false;
  }

  // Someone already took the role back off. Nothing to bank.
  if (!member.roles.cache.has(row.role_id)) {
    deleteCapture(row.id);
    return false;
  }

  const item = getItemByRoleId(row.guild_id, row.role_id);
  if (!item) {
    logger.info({ guildId: row.guild_id, roleId: row.role_id, captureId: row.id },
      "[inventory] role left the catalog before capture, leaving it alone");
    deleteCapture(row.id);
    return false;
  }

  if (isSuppressed(row.guild_id, row.user_id, row.role_id)) {
    clearSuppression(row.guild_id, row.user_id, row.role_id);
    deleteCapture(row.id);
    return false;
  }

  const executor = await resolveRoleGrantExecutor(guild, row.user_id, row.role_id);
  const verdict = decideSource(executor, client.user?.id ?? "", sourceBotAllowlist(row.guild_id));

  if (!verdict.ok) {
    logger.info(
      {
        evt: "inventory_capture_released",
        guildId: row.guild_id,
        userId: row.user_id,
        itemKey: row.item_key,
        executorId: executor?.id ?? null,
        reason: verdict.reason,
      },
      `Leaving ${item.display} in place: ${verdict.reason}`
    );
    deleteCapture(row.id);
    return false;
  }

  const grantKeyFree = row.grant_key
    ? claimGrantKey(row.guild_id, row.user_id, row.grant_key)
    : true;
  const debounceHit = creditedWithin(
    row.guild_id,
    row.user_id,
    row.item_key,
    Math.floor(Date.now() / 1000) - debounceSeconds(row.guild_id)
  );
  const outcome = decideDedup(item.policy, grantKeyFree, debounceHit);

  const result = await removeRole(
    guild,
    row.user_id,
    row.role_id,
    outcome === "credit"
      ? `inventory_capture: banked as ${item.display}`
      : `inventory_capture: duplicate grant of ${item.display}`,
    client.user?.id ?? "system"
  );

  if (!result.success) {
    const attempts = deferCapture(row.id, RETRY_DELAY_S);
    logger.warn(
      { guildId: row.guild_id, userId: row.user_id, roleId: row.role_id, attempts, error: result.error },
      "[inventory] could not remove role, will retry"
    );
    if (attempts >= MAX_ATTEMPTS) {
      logger.error(
        { guildId: row.guild_id, userId: row.user_id, roleId: row.role_id, attempts },
        "[inventory] giving up on capture, check the bot's role hierarchy position"
      );
      deleteCapture(row.id);
    }
    return true;
  }

  deleteCapture(row.id);

  if (outcome === "absorb") {
    logger.info(
      {
        evt: "inventory_capture_absorbed",
        guildId: row.guild_id,
        userId: row.user_id,
        itemKey: row.item_key,
        policy: item.policy,
      },
      `Absorbed a duplicate ${item.display} without crediting`
    );
    return true;
  }

  const quantity = creditItem(
    row.guild_id,
    row.user_id,
    row.item_key,
    1,
    item.source,
    executor?.id ?? null,
    `captured from role ${row.role_id}`
  );

  logger.info(
    {
      evt: "inventory_item_credited",
      guildId: row.guild_id,
      userId: row.user_id,
      itemKey: row.item_key,
      quantity,
      executorId: executor?.id ?? null,
    },
    `Banked ${item.display} (now x${quantity})`
  );

  await logActionPretty(guild, {
    actorId: client.user?.id ?? "system",
    subjectId: row.user_id,
    action: "role_remove",
    reason: `Stored ${item.display} in inventory`,
    meta: { itemKey: row.item_key, quantity, grantedBy: executor?.id ?? "unknown" },
  }).catch((err) => {
    logger.warn({ err, guildId: row.guild_id, userId: row.user_id },
      "[inventory] failed to log capture to the audit channel");
  });

  await member
    .send({
      content:
        `**${item.display}** was added to your inventory (now **x${quantity}**).\n` +
        "Use `/stash` to see everything you're holding, and `/redeem` when you want to use one.",
    })
    .catch(() => undefined);

  return true;
}

export async function drainDueCaptures(client: Client): Promise<number> {
  if (_draining) {
    logger.debug("[inventory] drain already running, skipping overlapping tick");
    return 0;
  }
  _draining = true;
  try {
    const rows = dueCaptures(Math.floor(Date.now() / 1000));
    if (rows.length === 0) return 0;

    let processed = 0;
    for (const row of rows) {
      let didRoleWrite = false;
      try {
        didRoleWrite = await processCapture(client, row);
      } catch (err) {
        logger.error({ err, captureId: row.id }, "[inventory] capture failed");
        deferCapture(row.id, RETRY_DELAY_S);
      }
      processed++;
      // Space out role writes so a queue backlog does not trip Discord's per-guild limit.
      if (didRoleWrite) await sleep(ROLE_WRITE_DELAY_MS);
    }
    return processed;
  } finally {
    _draining = false;
  }
}

export function startItemCaptureScheduler(client: Client): void {
  if (process.env.INVENTORY_SCHEDULER_DISABLED === "1") {
    logger.debug("[inventory] capture scheduler disabled via env flag");
    return;
  }

  logger.info({ intervalSeconds: DRAIN_INTERVAL_MS / 1000 }, "[inventory] capture scheduler starting");

  const interval = setInterval(async () => {
    try {
      await drainDueCaptures(client);
      recordSchedulerRun("itemCapture", true);
    } catch (err) {
      recordSchedulerRun("itemCapture", false);
      logger.error({ err }, "[inventory] capture drain failed");
    }
  }, DRAIN_INTERVAL_MS);

  interval.unref();
  _activeInterval = interval;
}

export function stopItemCaptureScheduler(): void {
  if (_activeInterval) {
    clearInterval(_activeInterval);
    _activeInterval = null;
    logger.info("[inventory] capture scheduler stopped");
  }
}
