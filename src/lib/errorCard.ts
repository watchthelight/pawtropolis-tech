// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  EmbedBuilder,
  type InteractionReplyOptions,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
} from "discord.js";
import { logger } from "./logger.js";

function hintFor(err: unknown): string {
  const error = err as { name?: string; message?: string; code?: unknown };
  const name = typeof error?.name === "string" ? error.name : undefined;
  const message = typeof error?.message === "string" ? error.message : "";
  const code = error?.code;

  if (name === "SqliteError" && /no such table/i.test(message)) {
    return "Database schema mismatch. Run migrations or reset safely.";
  }

  if (code === 50013) {
    return "Missing Discord permission in this channel.";
  }

  return "Unexpected error. Try again or contact staff.";
}

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
