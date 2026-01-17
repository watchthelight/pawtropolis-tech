/**
 * Pawtropolis Tech — src/commands/report.ts
 * WHAT: /report command for ambassadors to report content violations.
 * WHY: Enables ambassadors to report rule violations with screenshot evidence.
 * FLOWS:
 *  - Ambassador/Gatekeeper+ runs /report → creates forum thread
 *  - Thread posted to configured report forum with embed + screenshot
 *  - Staff can resolve via button on the report
 * DOCS:
 *  - SlashCommandBuilder: https://discord.js.org/#/docs/discord.js/main/class/SlashCommandBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  GuildMember,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { withStep, withSql, ensureDeferred, replyOrEdit } from "../lib/cmdWrap.js";
import { getConfig, hasRoleOrAbove, ROLE_IDS, shouldBypass } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { createReportThread, generateReportCode } from "../features/report/index.js";

export const data = new SlashCommandBuilder()
  .setName("report")
  .setDescription("Report a content violation with evidence")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user who violated the rules")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Description of the violation")
      .setRequired(true)
      .setMaxLength(500)
  )
  .addAttachmentOption((option) =>
    option
      .setName("evidence")
      .setDescription("Screenshot of the violation")
      .setRequired(false)
  );

/**
 * Check if user can submit reports.
 * Allowed: Ambassador role OR Gatekeeper+
 */
function canSubmitReports(
  member: GuildMember | null,
  userId: string,
  guildId: string
): boolean {
  if (!member) return false;

  // Owner/dev bypass always allowed
  if (shouldBypass(userId, member)) return true;

  // Gatekeeper+ always allowed
  if (hasRoleOrAbove(member, ROLE_IDS.GATEKEEPER)) return true;

  // Check if user has the configured Ambassador role
  const config = getConfig(guildId);
  if (config?.ambassador_role_id && member.roles.cache.has(config.ambassador_role_id)) {
    return true;
  }

  return false;
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Validate guild context
  if (!interaction.guildId || !interaction.guild) {
    ctx.step("invalid_scope");
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check permissions
  ctx.step("permission_check");
  const member = interaction.member as GuildMember | null;
  const userId = interaction.user.id;

  if (!canSubmitReports(member, userId, interaction.guildId)) {
    const config = getConfig(interaction.guildId);
    const ambassadorMention = config?.ambassador_role_id
      ? `<@&${config.ambassador_role_id}>`
      : "Ambassador";

    await interaction.reply({
      content: `You need the ${ambassadorMention} role or Gatekeeper+ to submit reports.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer while we process
  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction, { ephemeral: true });
  });

  // Get command options
  const targetUser = await withStep(ctx, "get_options", async () => {
    return interaction.options.getUser("user", true);
  });

  const reason = interaction.options.getString("reason", true);
  const evidence = interaction.options.getAttachment("evidence");

  // Validate evidence is an image if provided
  if (evidence) {
    const contentType = evidence.contentType;
    if (!contentType?.startsWith("image/")) {
      await replyOrEdit(interaction, {
        content: "Evidence must be an image file (PNG, JPG, GIF, etc.).",
      });
      return;
    }
  }

  // Generate report code
  const code = generateReportCode(userId);

  // Create the report thread
  const result = await withStep(ctx, "create_thread", async () => {
    return createReportThread(interaction.guild!, {
      reporter: interaction.user,
      target: targetUser,
      reason,
      evidence: evidence ?? undefined,
      guildId: interaction.guildId!,
      code,
    });
  });

  // Respond with result
  await withStep(ctx, "reply", async () => {
    if (result.success) {
      logger.info(
        {
          evt: "report_command",
          code,
          reporterId: userId,
          targetId: targetUser.id,
          hasEvidence: !!evidence,
          guildId: interaction.guildId,
        },
        `[report] Report #${code} submitted`
      );

      await replyOrEdit(interaction, {
        content: `Report #${code} submitted successfully.\n\n${result.threadUrl}`,
      });
    } else {
      await replyOrEdit(interaction, {
        content: result.error || "Failed to create report. Please try again.",
      });
    }
  });
}
