/**
 * Pawtropolis Tech — src/commands/audit.ts
 *
 * /audit command dispatcher. Routes subcommands to handler modules in audit/:
 * - security / acknowledge / unacknowledge / acknowledge-all / trends / diff:
 *   self-contained handlers that defer early.
 * - members / nsfw: show a confirmation prompt, then run in the background via
 *   the button router.
 *
 * Restricted to specific roles (Admin+ and Server Dev).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { logger } from "../lib/logger.js";
import { postPermissionDenied } from "../lib/permissionCard.js";
import { type CommandContext, withStep } from "../lib/cmdWrap.js";
import { shouldBypass } from "../lib/roles.js";
import { ALLOWED_ROLES } from "./audit/shared.js";
import { executeSecurity } from "./audit/security.js";
import { executeAcknowledge } from "./audit/acknowledge.js";
import { executeUnacknowledge } from "./audit/unacknowledge.js";
import { executeAcknowledgeAll } from "./audit/acknowledgeAll.js";
import { executeTrends } from "./audit/trends.js";
import { executeDiff } from "./audit/diff.js";
import { executeMembersNsfwConfirm } from "./audit/confirm.js";

export { data } from "./audit/data.js";
export { handleAuditButton } from "./audit/buttonRouter.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId, guild, user } = interaction;

  if (!guildId || !guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  // IMPORTANT: Defer EARLY for slow subcommands to avoid 3-second timeout
  // Members/NSFW show confirmation buttons first, so they defer later
  const deferEarly = ["security", "acknowledge", "unacknowledge", "acknowledge-all", "trends", "diff"].includes(subcommand);
  if (deferEarly) {
    await withStep(ctx, "defer_early", async () => {
      const isEphemeral = subcommand === "unacknowledge";
      await interaction.deferReply(isEphemeral ? { flags: MessageFlags.Ephemeral } : undefined);
    });
  }

  // Check if user has an allowed role or is bot owner/server dev
  const { hasAllowedRole, canBypass } = await withStep(ctx, "permission_check", async () => {
    const member = await guild.members.fetch(user.id);
    const hasAllowedRole = member.roles.cache.some((role) => (ALLOWED_ROLES as readonly string[]).includes(role.id));
    const canBypass = shouldBypass(user.id, member);
    return { hasAllowedRole, canBypass };
  });

  if (!hasAllowedRole && !canBypass) {
    const descriptions: Record<string, string> = {
      nsfw: "Scans member avatars for NSFW content using Google Vision API.",
      members: "Scans for bot-like accounts using multiple heuristics.",
      security: "Generates server permission/security documentation.",
      acknowledge: "Acknowledges a security warning as intentional.",
      unacknowledge: "Removes acknowledgment from a security warning.",
      "acknowledge-all": "Bulk acknowledges all security warnings of a severity level.",
    };
    // Use editReply if already deferred, otherwise use postPermissionDenied
    if (deferEarly) {
      await interaction.editReply({
        content: `❌ You don't have permission to use \`/audit ${subcommand}\`. Required: Admin, Senior Admin, Community Manager, or Server Dev role.`,
      });
    } else {
      await postPermissionDenied(interaction, {
        command: `audit ${subcommand}`,
        description: descriptions[subcommand] || "Server audit command.",
        requirements: [{ type: "roles", roleIds: ALLOWED_ROLES }],
      });
    }
    logger.warn(
      { userId: user.id, guildId },
      "[audit] Unauthorized user attempted to run audit"
    );
    return;
  }

  switch (subcommand) {
    case "security":
      await executeSecurity(ctx);
      return;
    case "acknowledge":
      await executeAcknowledge(ctx);
      return;
    case "unacknowledge":
      await executeUnacknowledge(ctx);
      return;
    case "acknowledge-all":
      await executeAcknowledgeAll(ctx);
      return;
    case "trends":
      await executeTrends(ctx);
      return;
    case "diff":
      await executeDiff(ctx);
      return;
    default:
      // members + nsfw: confirmation prompt, then background run via button router
      await executeMembersNsfwConfirm(ctx);
      return;
  }
}
