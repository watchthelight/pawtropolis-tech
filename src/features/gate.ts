/**
 * Pawtropolis Tech — src/features/gate.ts
 * WHAT: Gate entry UX (Start button + modal pages), draft persistence, submission, and optional avatar scan queueing.
 * WHY: Keeps applicant-facing interactions and staff review linkage in one module.
 * FLOWS:
 *  - Start button: find/create draft → open modal for requested page
 *  - Modal submit: defer → validate → persist answers → maybe submit → refresh review card → reply
 *  - Submission: enqueue avatar scan (non-blocking) → notify user
 * DOCS:
 *  - CommandInteractions: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction response rules: https://discord.com/developers/docs/interactions/receiving-and-responding
 *  - Interaction reply options/flags: https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite UPSERT: https://sqlite.org/lang_UPSERT.html
 *
 * NOTE: Ephemeral replies keep channels clean; we only post public content where intentional.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  PermissionsBitField,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import type { CmdCtx } from "../lib/cmdWrap.js";
import { buildGateEntryPayload, findExistingGateEntry } from "./gate/entryPanel.js";
import { queueAvatarScan } from "./gate/scan.js";
export * from "./gate/drafts.js";
export { BRAND_COLOR } from "./gate/constants.js";
export { buildGateEntryPayload, queueAvatarScan };
export { ensureGateEntryStartup, refreshGateEntry } from "./gate/entryPanel.js";


export type EnsureGateEntryResult = {
  created: boolean;
  edited: boolean;
  pinned: boolean;
  channelId?: string;
  messageId?: string;
  reason?: string;
};

function logPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  logger.info({
    evt: "gate_entry_step",
    traceId: ctx.traceId,
    phase,
    ...extras,
  });
}

function markSkippedPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  ctx.step(phase);
  logPhase(ctx, phase, { skipped: true, ...extras });
}

/**
 * ensureGateEntry
 * WHAT: Ensures there is a pinned Gate Entry message with a Start button in the configured gate channel.
 * WHY: Applicants need a stable entry point; we refresh/edit/pin instead of duplicating.
 * PARAMS:
 *  - ctx: CommandContext for logging/tracing.
 *  - guildId: Target guild id.
 * RETURNS: EnsureGateEntryResult describing what happened (created/edited/pinned).
 * THROWS: Propagates errors; callers typically log and continue.
 * LINKS:
 *  - Guild text channels API: https://discord.js.org/#/docs/discord.js/main/class/GuildTextBasedChannel
 * PITFALLS:
 *  - Requires SendMessages/ManageMessages to pin; fail-soft when missing permissions.
 */
export async function ensureGateEntry(
  ctx: CmdCtx,
  guildId: string
): Promise<EnsureGateEntryResult> {
  const result: EnsureGateEntryResult = { created: false, edited: false, pinned: false };

  ctx.step("load_config");
  const cfg = getConfig(guildId);
  logPhase(ctx, "load_config", { guildId, hasGateChannel: Boolean(cfg?.gate_channel_id) });
  if (!cfg?.gate_channel_id) {
    markSkippedPhase(ctx, "open_channel", { guildId, reason: "gate channel not configured" });
    markSkippedPhase(ctx, "find_existing", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "gate channel not configured" });
    result.reason = "gate channel not configured";
    return result;
  }

  let channel: GuildTextBasedChannel | null = null;
  ctx.step("open_channel");
  try {
    const fetched = await ctx.interaction.client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!channel) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      reason: "channel unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "channel unavailable" });
    result.reason = "gate channel unavailable";
    return result;
  }

  result.channelId = channel.id;

  const botId = ctx.interaction.client.user?.id ?? null;
  const me =
    channel.guild.members.me ??
    (botId ? await channel.guild.members.fetch(botId).catch(() => null) : null);
  if (!me) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "bot member missing",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "bot member missing" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "bot member missing" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "bot member missing" });
    result.reason = "bot member missing";
    return result;
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "permissions unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "permissions unavailable" });
    result.reason = "unable to resolve permissions";
    return result;
  }

  const hasView = perms.has(PermissionsBitField.Flags.ViewChannel);
  const hasSend = perms.has(PermissionsBitField.Flags.SendMessages);
  const hasManage = perms.has(PermissionsBitField.Flags.ManageMessages);
  // Permissions check philosophy: fail-soft and explain what’s missing.
  // Docs: https://discord.com/developers/docs/topics/permissions

  logPhase(ctx, "open_channel", {
    guildId,
    channelId: channel.id,
    hasView,
    hasSend,
    hasManageMessages: hasManage,
  });

  if (!hasView) {
    markSkippedPhase(ctx, "find_existing", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "missing ViewChannel" });
    result.reason = "missing ViewChannel";
    return result;
  }

  ctx.step("find_existing");
  const existing = await findExistingGateEntry(channel, botId);
  if (existing) {
    result.messageId = existing.id;
  }
  logPhase(ctx, "find_existing", {
    channelId: channel.id,
    messageId: existing?.id ?? null,
  });

  if (!hasSend) {
    markSkippedPhase(ctx, "send_or_edit", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      reason: `missing SendMessages in #${channel.name}`,
    });
    markSkippedPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      hasManageMessages: hasManage,
      reason: `missing SendMessages in #${channel.name}`,
    });
    result.reason = `missing SendMessages in #${channel.name}`;
    return result;
  }

  ctx.step("send_or_edit");
  let message: Message | null = existing ?? null;
  let created = false;
  let edited = false;

  if (message) {
    const editPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    try {
      await message.edit({
        embeds: editPayload.embeds,
        components: editPayload.components,
        files: editPayload.files,
        attachments: [],
      });
      edited = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 10008) {
        message = null;
      } else {
        throw err;
      }
    }
  }

  if (!message) {
    // Fresh send - this happens on first setup or if the old message was deleted
    const createPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    const sent = await channel.send(createPayload);
    message = sent;
    created = true;
  }

  result.messageId = message.id;
  result.created = created;
  result.edited = edited;
  logger.info(
    {
      channelId: channel.id,
      messageId: message.id,
      created,
      edited,
    },
    "[gate] entry posted"
  );
  logPhase(ctx, "send_or_edit", {
    channelId: channel.id,
    messageId: message.id,
    created,
    edited,
  });

  ctx.step("maybe_pin");
  if (!hasManage) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: false,
      reason: "missing ManageMessages",
    });
    result.reason = "missing ManageMessages";
    return result;
  }

  try {
    if (!message.pinned) {
      await message.pin();
    }
    const pinnedResponse = await channel.messages.fetchPins();
    // discord.js v14.16+ fetchPins() returns { items: Collection, hasMore: boolean }, not a bare Collection.
    const pinnedItems = (pinnedResponse as unknown as { items?: { has: (id: string) => boolean } }).items;
    const pinnedMatch = pinnedItems ? pinnedItems.has(message.id) : false;
    result.pinned = pinnedMatch;
    if (!pinnedMatch) {
      result.reason = "pin verification failed";
    }
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      pinned: pinnedMatch,
    });
    return result;
  } catch (err) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Entry point for gate verification flow. Triggered when user clicks "Verify" button.
 * This is HOT PATH - runs on every application start, needs to be fast.
 *
 * Key constraint: Must show modal within 3 seconds or Discord kills the interaction.
 * We do minimal validation before showModal, deferring heavy work to modal submit.
 *
 * PERFORMANCE NOTE: getOrCreateDraft does a few DB queries, but they're sync
 * (better-sqlite3) so they complete in <10ms typically. If this ever becomes
 * a bottleneck, the getQuestions call is the one to cache - it rarely changes.
 */
export { handleStartButton, handleGateModalSubmit, handleDoneButton } from "./gate/handlers.js";
