/**
 * Pawtropolis Tech — src/features/report/handlers.ts
 * WHAT: Button and modal handlers for the content report system.
 * WHY: Handles Resolve button clicks and resolution modal submissions.
 * FLOWS:
 *  - Staff clicks Resolve → opens modal for optional note
 *  - Modal submit → edit embed to resolved state → archive thread
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 *  - ModalSubmitInteraction: https://discord.js.org/#/docs/discord.js/main/class/ModalSubmitInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  ThreadChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { hasRoleOrAbove, ROLE_IDS, shouldBypass } from "../../lib/config.js";
import { BTN_REPORT_RESOLVE_RE } from "../../lib/modalPatterns.js";
import { buildResolvedEmbed, buildReportActionRow } from "./index.js";
import { newTraceId, ctx } from "../../lib/reqctx.js";

/**
 * Check if the user has Gatekeeper+ permissions.
 * Returns true if they can resolve reports.
 */
function canResolveReports(member: GuildMember | null, userId: string): boolean {
  if (!member) return false;
  if (shouldBypass(userId, member)) return true;
  return hasRoleOrAbove(member, ROLE_IDS.GATEKEEPER);
}

/**
 * Handle the Resolve button click on a report.
 * Opens a modal for the staff member to optionally add a note.
 */
export async function handleReportResolveButton(interaction: ButtonInteraction): Promise<void> {
  const match = BTN_REPORT_RESOLVE_RE.exec(interaction.customId);
  if (!match) return;

  const code = match[1];
  const member = interaction.member as GuildMember | null;
  const userId = interaction.user.id;

  // Check permissions - Gatekeeper+ required
  if (!canResolveReports(member, userId)) {
    await interaction.reply({
      content: "You need the Gatekeeper role or higher to resolve reports.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show the resolution modal
  try {
    const modal = new ModalBuilder()
      .setCustomId(`v1:modal:report:resolve:${code}`)
      .setTitle("Resolve Report")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("note")
            .setLabel("Resolution note (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Add any notes about how this was resolved...")
            .setRequired(false)
            .setMaxLength(500)
        )
      );

    await interaction.showModal(modal);
  } catch (err) {
    const traceId = ctx().traceId ?? newTraceId();
    logger.error({ err, code, traceId }, "[report] Failed to show resolve modal");
    captureException(err, { area: "handleReportResolveButton", code, traceId });

    await interaction.reply({
      content: `Failed to open resolution modal (trace: ${traceId}).`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

/**
 * Handle the resolution modal submission.
 * Updates the embed to resolved state and archives the thread.
 */
export async function handleReportResolveModal(
  interaction: ModalSubmitInteraction,
  code: string
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  const userId = interaction.user.id;

  // Double-check permissions
  if (!canResolveReports(member, userId)) {
    await interaction.reply({
      content: "You need the Gatekeeper role or higher to resolve reports.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer to give us time to process
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const note = interaction.fields.getTextInputValue("note").trim() || undefined;

  try {
    // Get the original message
    const message = interaction.message;
    if (!message) {
      await interaction.editReply({
        content: "Could not find the original report message.",
      });
      return;
    }

    // Get the original embed
    const originalEmbed = message.embeds[0];
    if (!originalEmbed) {
      await interaction.editReply({
        content: "Could not find the report embed.",
      });
      return;
    }

    // Build the resolved embed
    const resolvedEmbed = buildResolvedEmbed(
      EmbedBuilder.from(originalEmbed.toJSON()),
      userId,
      note
    );

    // Build disabled action row
    const disabledRow = buildReportActionRow(code, true);

    // Update the message
    await message.edit({
      embeds: [resolvedEmbed],
      components: [disabledRow],
    });

    // Archive the thread if this is in a thread channel
    const channel = interaction.channel;
    if (channel && channel.isThread()) {
      try {
        await (channel as ThreadChannel).setArchived(true, `Resolved by ${interaction.user.tag}`);
        logger.info(
          {
            evt: "report_resolved",
            code,
            resolvedBy: userId,
            threadId: channel.id,
            hasNote: !!note,
          },
          `[report] Report #${code} resolved and archived`
        );
      } catch (archiveErr) {
        // Non-fatal - report is still resolved
        logger.warn(
          { err: archiveErr, code, threadId: channel.id },
          "[report] Failed to archive thread after resolution"
        );
      }
    } else {
      logger.info(
        {
          evt: "report_resolved",
          code,
          resolvedBy: userId,
          hasNote: !!note,
        },
        `[report] Report #${code} resolved`
      );
    }

    await interaction.editReply({
      content: `Report #${code} has been resolved and the thread has been archived.`,
    });
  } catch (err) {
    const traceId = ctx().traceId ?? newTraceId();
    logger.error({ err, code, traceId }, "[report] Failed to resolve report");
    captureException(err, { area: "handleReportResolveModal", code, traceId });

    await interaction.editReply({
      content: `Failed to resolve report (trace: ${traceId}).`,
    }).catch(() => {});
  }
}
