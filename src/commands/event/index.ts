/**
 * Pawtropolis Tech — src/commands/event/index.ts
 * WHAT: Unified event attendance tracking command
 * WHY: Provides /event movie and /event game subcommand groups
 * FLOWS:
 *  - /event movie [subcommand] → movie night tracking
 *  - /event game [subcommand] → game night tracking
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ChatInputCommandInteraction } from "discord.js";
import { type CommandContext, withStep } from "../../lib/cmdWrap.js";
import { requireMinRole, ROLE_IDS } from "../../lib/config.js";
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

  // Require Moderator+ role
  const hasPermission = await withStep(ctx, "permission_check", async () => {
    return requireMinRole(interaction, ROLE_IDS.MODERATOR, {
      command: "event",
      description: "Event attendance tracking and tier role management.",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.MODERATOR }],
    });
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
