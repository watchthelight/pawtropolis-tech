/**
 * Pawtropolis Tech — src/commands/event/index.ts
 * WHAT: Unified event attendance tracking command
 * WHY: Provides /event movie and /event game subcommand groups
 * FLOWS:
 *  - /event movie [subcommand] → movie night tracking
 *  - /event game [subcommand] → game night tracking
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { ROLE_IDS, hasAnyRole, hasRoleOrAbove, shouldBypass } from "../../lib/roles.js";
import { data } from "./data.js";
import { handleMovieSubcommand } from "./movie.js";
import { handleGameSubcommand } from "./game.js";

export { data };

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Require Event Host, Events Manager, or Moderator+
  const hasPermission = await withStep(ctx, "permission_check", async () => {
    const member = interaction.member as GuildMember;
    const userId = interaction.user.id;

    // Bypass for owner/dev
    if (shouldBypass(userId, member)) return true;

    // Check event-specific roles
    if (hasAnyRole(member, [ROLE_IDS.EVENT_HOST, ROLE_IDS.EVENTS_MANAGER])) return true;

    // Check mod hierarchy (Moderator+)
    if (hasRoleOrAbove(member, ROLE_IDS.MODERATOR)) return true;

    // No permission - show error
    await interaction.reply({
      content: "You need **Event Host**, **Events Manager**, or **Moderator+** to use this command.",
      ephemeral: true,
    });
    return false;
  });

  if (!hasPermission) return;

  await withStep(ctx, "route_subcommand", async () => {
    const group = interaction.options.getSubcommandGroup(true);
    const subcommand = interaction.options.getSubcommand(true);

    switch (group) {
      case "movie":
        await handleMovieSubcommand(ctx, subcommand);
        break;
      case "game":
        await handleGameSubcommand(ctx, subcommand);
        break;
      default:
        await interaction.reply({
          content: "Unknown subcommand group.",
          ephemeral: true,
        });
    }
  });
}
