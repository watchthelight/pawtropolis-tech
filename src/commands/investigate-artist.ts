/**
 * Pawtropolis Tech -- src/commands/investigate-artist.ts
 * WHAT: /investigate-artist, the owner's private review aid for 2D artist
 *       verification tickets.
 * WHY: Reviewing an application means checking a dozen images against several
 *      sites and the mod handbook by hand. This gathers that evidence and an
 *      advisory assessment into one private reply. It never approves, denies,
 *      assigns roles or messages the applicant.
 * FLOWS:
 *  - owner check in the handler -> ephemeral defer -> ticket check -> run -> private pages
 * PRIVACY:
 *  - Every reply is ephemeral. Errors are caught here and answered privately, so
 *    the shared error card (public when a reply was never deferred) is never used.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChannelType,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../db/db.js";
import { getSettings } from "../features/artistInvestigation/config.js";
import { renderReport } from "../features/artistInvestigation/render.js";
import { runInvestigation } from "../features/artistInvestigation/run.js";
import { classifyTicketChannel } from "../features/artistInvestigation/ticketContext.js";
import { getTicketsCategoryId } from "../features/tickets/config.js";
import { TicketService } from "../features/tickets/service.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { isOwner } from "../lib/owner.js";

export const data = new SlashCommandBuilder()
  .setName("investigate-artist")
  .setDescription(
    "Private advisory review of the 2D artist application in this ticket (owner only)"
  )
  .setDMPermission(false)
  // Keeps the command out of members' pickers. The real gate is the owner check in execute().
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((option) =>
    option
      .setName("applicant")
      .setDescription("The applicant, if the bot cannot tell who opened this ticket")
      .setRequired(false)
  );

const NO_MENTIONS = { parse: [] as [] };

async function investigate(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const { guild, channel } = interaction;

  const ticketRow = channel ? TicketService.findByChannelId(channel.id) : null;
  const check =
    guild && channel && !channel.isDMBased()
      ? classifyTicketChannel(
          {
            name: channel.name,
            parentId: channel.parentId,
            isGuildText: channel.type === ChannelType.GuildText,
          },
          ticketRow,
          getTicketsCategoryId(guild.id)
        )
      : {
          ok: false as const,
          reason: "This only works inside a 2D artist verification ticket channel.",
        };
  if (!check.ok || !guild || channel?.type !== ChannelType.GuildText) {
    await interaction.editReply({
      content: check.ok
        ? "This only works inside a 2D artist verification ticket channel."
        : check.reason,
    });
    return;
  }

  const result = await withStep(ctx, "investigate", () =>
    runInvestigation(
      {
        guild,
        channel,
        ticket: check,
        overrideApplicantId: interaction.options.getUser("applicant")?.id ?? null,
        memberOverwriteIds: [...channel.permissionOverwrites.cache.values()]
          .filter((overwrite) => overwrite.type === OverwriteType.Member)
          .map((overwrite) => overwrite.id),
        botUserId: interaction.client.user.id,
        invokedBy: interaction.user.id,
        onProgress: async (text) => {
          await interaction.editReply({ content: text }).catch(() => undefined);
        },
      },
      { db, settings: getSettings() }
    )
  );
  if (!result.ok) {
    await interaction.editReply({ content: result.message, allowedMentions: NO_MENTIONS });
    return;
  }

  ctx.step("reply");
  const [first, ...rest] = renderReport(result.report);
  await interaction.editReply({
    content: "",
    embeds: first?.embeds ?? [],
    allowedMentions: NO_MENTIONS,
  });
  for (const page of rest) {
    await interaction.followUp({
      embeds: page.embeds,
      flags: MessageFlags.Ephemeral,
      allowedMentions: NO_MENTIONS,
    });
  }
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  try {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: "❌ This command is only available to the bot owner.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await investigate(ctx);
  } catch (err) {
    // Message and code only: an error object can carry the request body, and
    // report text must not reach the logs.
    logger.error(
      {
        evt: "investigate_artist_failed",
        traceId: ctx.traceId,
        phase: ctx.currentPhase(),
        errName: err instanceof Error ? err.name : typeof err,
        errMessage: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        code: (err as { code?: unknown })?.code,
      },
      "[investigate-artist] stopped on an error"
    );
    const notice = {
      content: `The investigation stopped on an error. Nothing was posted in this channel. Trace: \`${ctx.traceId}\``,
      flags: MessageFlags.Ephemeral as const,
    };
    await (
      interaction.deferred || interaction.replied
        ? interaction.followUp(notice)
        : interaction.reply(notice)
    ).catch(() => undefined);
  }
}
