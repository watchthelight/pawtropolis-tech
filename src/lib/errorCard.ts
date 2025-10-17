// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  EmbedBuilder,
  type InteractionReplyOptions,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
} from "discord.js";
import { hintFor } from "./errorHints.js";
import { logger } from "./logger.js";

type ReplyCapableInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction;

export async function safeReply(
  interaction: ReplyCapableInteraction,
  payload: InteractionReplyOptions
) {
  const base = { ...payload };
  try {
    if (interaction.deferred) {
      const { ephemeral: _drop, ...editPayload } = base as InteractionEditReplyOptions & {
        ephemeral?: boolean;
      };
      await interaction.editReply(editPayload);
      return;
    }
    if (interaction.replied) {
      await interaction.followUp(base);
      return;
    }
    await interaction.reply(base);
  } catch (err) {
    logger.warn({ err }, "safeReply primary channel failed, falling back to followUp");
    try {
      await interaction.followUp(base);
    } catch (followErr) {
      logger.error({ err: followErr }, "safeReply followUp failed");
    }
  }
}

type ErrorCardDetails = {
  traceId: string;
  cmd: string;
  phase: string;
  err: {
    name?: string;
    code?: unknown;
    message?: string;
  };
};

export async function postErrorCard(
  interaction: ReplyCapableInteraction,
  details: ErrorCardDetails
) {
  const embed = new EmbedBuilder()
    .setTitle("Command Error")
    .setColor(0xed4245)
    .addFields(
      { name: "Command", value: `/${details.cmd}` },
      { name: "Phase", value: details.phase || "unknown" },
      {
        name: "Code",
        value:
          typeof details.err.code === "string"
            ? details.err.code
            : details.err.code
              ? String(details.err.code)
              : details.err.name ?? "unknown",
      },
      { name: "Hint", value: hintFor(details.err) },
      { name: "Trace", value: details.traceId }
    )
    .setFooter({ text: new Date().toISOString() });

  await safeReply(interaction, { embeds: [embed], ephemeral: true });
}
