/**
 * Pawtropolis Tech — src/handlers/errorCardButtons.ts
 * WHAT: Handles the three buttons attached to every error card by errorCardV2.ts:
 *         ec:ping:<traceId>   → publicly mentions the bot dev with the trace ID
 *         ec:copy:<traceId>   → ephemeral reply with the trace ID in a code block
 *         ec:trace:<traceId>  → ephemeral reply with the full /developer trace embeds
 * WHY: A trace ID in an error card footer is useless without affordances. Staff
 *      can dig in immediately; non-staff can summon the bot dev or surface the
 *      ID for support without copy-pasting from a footer.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { hasStaffPermissions } from "../lib/config.js";
import { isOwner } from "../lib/owner.js";
import { ERROR_CARD_BUTTON_RE } from "../lib/errorCardV2.js";
import { getTrace, getTraceStats } from "../lib/traceStore.js";
import { buildTraceEmbeds } from "../commands/developer.js";
import { env } from "../lib/env.js";
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";

const OWNER_IDS = (env.OWNER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function matchErrorCardButton(customId: string): { action: "ping" | "copy" | "trace"; traceId: string } | null {
  const m = customId.match(ERROR_CARD_BUTTON_RE);
  if (!m) return null;
  return { action: m[1] as "ping" | "copy" | "trace", traceId: m[2]! };
}

export async function handleErrorCardButton(
  interaction: ButtonInteraction,
  action: "ping" | "copy" | "trace",
  traceId: string
): Promise<void> {
  switch (action) {
    case "ping":
      await handlePing(interaction, traceId);
      return;
    case "copy":
      await handleCopy(interaction, traceId);
      return;
    case "trace":
      await handleTrace(interaction, traceId);
      return;
  }
}

async function handlePing(interaction: ButtonInteraction, traceId: string): Promise<void> {
  if (!isStaffOrOwner(interaction)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        "Only staff can ping the bot dev. Copy the trace ID with the **Copy trace** button and ask a moderator to escalate.",
    });
    return;
  }

  const devId = OWNER_IDS[0];
  if (!devId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "No bot dev is configured in `OWNER_IDS`. Tell whoever runs the bot.",
    });
    return;
  }

  // Rate limit per trace: one error pings the dev once per window, no matter how
  // many times the button is clicked. Prevents the public-ping spam seen when a
  // card is hammered. Blocked clicks reply ephemerally so they add no new ping.
  const cooldown = checkCooldown("errorcard_ping", traceId, COOLDOWNS.ERRORCARD_PING_MS);
  if (!cooldown.allowed) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `The bot dev was already pinged about trace \`${traceId}\`. Try again in ${formatCooldown(cooldown.remainingMs!)} if it is still unresolved.`,
    });
    return;
  }

  await interaction.reply({
    content: `<@${devId}> error trace \`${traceId}\` — pinged by ${interaction.user} from ${interaction.channel}`,
    allowedMentions: { users: [devId] },
  });

  logger.info(
    {
      evt: "errorcard_ping_dev",
      traceId,
      actorId: interaction.user.id,
      devId,
      channelId: interaction.channelId,
    },
    "[errorcard] bot dev pinged"
  );
}

async function handleCopy(interaction: ButtonInteraction, traceId: string): Promise<void> {
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: [
      "Trace ID:",
      `\`\`\`\n${traceId}\n\`\`\``,
      "Tap-and-hold (mobile) or triple-click (desktop) to select, then copy.",
    ].join("\n"),
  });

  logger.debug(
    { evt: "errorcard_copy_trace", traceId, actorId: interaction.user.id },
    "[errorcard] trace copied"
  );
}

async function handleTrace(interaction: ButtonInteraction, traceId: string): Promise<void> {
  if (!isStaffOrOwner(interaction)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Running a trace is staff-only. Use **Copy trace** to send the ID to staff instead.",
    });
    return;
  }

  const trace = getTrace(traceId);
  if (!trace) {
    const stats = getTraceStats();
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Trace \`${traceId}\` not found. Traces expire after ${stats.ttlMinutes} minutes. (Cache: ${stats.size}/${stats.maxSize}.)`,
    });
    return;
  }

  const embeds = buildTraceEmbeds(trace);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds,
  });

  logger.info(
    { evt: "errorcard_run_trace", traceId, actorId: interaction.user.id },
    "[errorcard] trace expanded"
  );
}

function isStaffOrOwner(interaction: ButtonInteraction): boolean {
  if (isOwner(interaction.user.id)) return true;
  if (!interaction.guildId) return false;
  const member = interaction.member as GuildMember | null;
  return hasStaffPermissions(member, interaction.guildId);
}
