/**
 * Pawtropolis Tech — src/commands/test.ts
 * WHAT: Test command that throws an intentional error.
 * WHY: Tests the error handling, logging, and Sentry integration.
 * FLOWS:
 *  - /test -> Throws an error to test error card and wide event logging
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type CommandContext, withStep } from "../lib/cmdWrap.js";
import { isOwner } from "../lib/owner.js";

export const data = new SlashCommandBuilder()
  .setName("test")
  .setDescription("Test command - throws an intentional error for logging verification")
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Only allow bot owners to trigger test errors
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "This command is restricted to bot owners.",
      ephemeral: true,
    });
    return;
  }

  await withStep(ctx, "intentional_error", async () => {
    throw new Error("Intentional test error - verifying logging system");
  });
}
