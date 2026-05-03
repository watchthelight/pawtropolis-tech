/**
 * Pawtropolis Tech -- src/commands/gate/welcomebatch.ts
 * WHAT: /welcomebatch command — manages the batched welcome session.
 *       Subcommands: start, send, cancel, status.
 * WHY: Lets a Gatekeeper accept several users in a row, then deliver one combined
 *      welcome message with /welcomebatch send.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import {
  requireGatekeeper,
  getConfig,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  withStep,
  logger,
} from "./shared.js";
import {
  startSession,
  flushSession,
  cancelSession,
  getSessionStatus,
  WELCOME_BATCH_EXPIRY_MS,
  WELCOME_BATCH_MAX_USERS,
} from "../../features/welcomeBatch.js";

export const welcomeBatchData = new SlashCommandBuilder()
  .setName("welcomebatch")
  .setDescription("Batch multiple accepted users into one welcome message")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Open a batch session — pending welcomes will be queued instead of sent")
  )
  .addSubcommand((sub) =>
    sub
      .setName("send")
      .setDescription("Send the combined welcome card and close the session")
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Discard the buffered welcomes and close the session")
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show the current batch session status")
  )
  .setDMPermission(false);

async function dmExpiryNotice(
  client: Client,
  userId: string,
  guildName: string,
  memberIds: string[]
) {
  try {
    const u = await client.users.fetch(userId);
    const list = memberIds.length > 0 ? memberIds.map((id) => `<@${id}>`).join(", ") : "(none)";
    await u.send(
      `Your welcome batch session in **${guildName}** auto-expired after 30 minutes of inactivity. ` +
        `**${memberIds.length}** buffered welcome(s) were discarded: ${list}.\n\n` +
        `Open a new session with \`/welcomebatch start\` if needed.`
    );
  } catch (err) {
    logger.warn({ err, userId }, "[welcomebatch] failed to DM session opener about expiry");
  }
}

export async function executeWelcomeBatch(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireGatekeeper(
    interaction,
    "welcomebatch",
    "Manages the batched welcome session for accepted users."
  )) return;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guildId;
  const guild = interaction.guild;

  if (sub === "start") {
    const result = startSession(guildId, interaction.user.id, ({ openedBy, memberIds }) => {
      void dmExpiryNotice(interaction.client, openedBy, guild.name, memberIds);
    });
    if (result.alreadyActive) {
      await replyOrEdit(interaction, {
        content: `A batch session is already open (started by <@${result.openedBy}>). Use \`/welcomebatch send\` to deliver, or \`/welcomebatch cancel\` to discard.`,
      });
      return;
    }
    const minutes = Math.round(WELCOME_BATCH_EXPIRY_MS / 60000);
    await replyOrEdit(interaction, {
      content:
        `Batch welcome session opened. Up to **${WELCOME_BATCH_MAX_USERS}** accepts will be queued.\n` +
        `Use \`/welcomebatch send\` to deliver, \`/welcomebatch cancel\` to discard, or \`/welcomebatch status\` to inspect. Auto-expires after ${minutes} min.`,
    });
    return;
  }

  if (sub === "status") {
    const status = getSessionStatus(guildId);
    if (!status.active) {
      await replyOrEdit(interaction, { content: "No batch session active." });
      return;
    }
    const ids = status.memberIds ?? [];
    const elapsedMin = Math.round((Date.now() - (status.openedAt ?? Date.now())) / 60000);
    const list = ids.length > 0 ? ids.map((id) => `<@${id}>`).join(", ") : "_(empty)_";
    await replyOrEdit(interaction, {
      content:
        `**Batch session active**\n` +
        `Opened by: <@${status.openedBy}> (${elapsedMin}m ago)\n` +
        `Buffered (${ids.length}/${WELCOME_BATCH_MAX_USERS}): ${list}`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === "cancel") {
    const res = cancelSession(guildId);
    if (!res.cancelled) {
      await replyOrEdit(interaction, { content: "No batch session active." });
      return;
    }
    await replyOrEdit(interaction, {
      content: `Batch session cancelled. **${res.bufferedCount}** queued welcome(s) discarded.`,
    });
    return;
  }

  if (sub === "send") {
    const cfg = getConfig(guildId);
    if (!cfg) {
      await replyOrEdit(interaction, { content: "Guild not configured." });
      return;
    }
    if (!cfg.general_channel_id) {
      await replyOrEdit(interaction, {
        content: "Cannot send: general channel not configured. Use `/welcomebatch cancel` to close the session.",
      });
      return;
    }
    const flush = await flushSession(guild, cfg);
    if (flush.kind === "no_session") {
      await replyOrEdit(interaction, { content: "No batch session active." });
      return;
    }
    if (flush.kind === "empty") {
      await replyOrEdit(interaction, {
        content: "Session closed — no welcomes were queued. Nothing to send.",
      });
      return;
    }
    if (flush.kind === "error") {
      await replyOrEdit(interaction, {
        content: `Failed to send batch welcome (${flush.userCount} user(s)): ${flush.error}`,
      });
      return;
    }
    await replyOrEdit(interaction, {
      content: `Sent batch welcome for **${flush.userCount}** user(s) in <#${cfg.general_channel_id}>.`,
    });
    return;
  }

  await replyOrEdit(interaction, { content: `Unknown subcommand: ${sub}` });
}
