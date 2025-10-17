// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActivityType,
} from "discord.js";
import { requireStaff } from "../lib/config.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("statusupdate")
  .setDescription("Update the bot's presence text")
  .addStringOption((option) =>
    option
      .setName("text")
      .setDescription("Status text")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(128)
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const text = await withStep(ctx, "validate_input", async () =>
    interaction.options.getString("text", true)
  );

  const user = await withStep(ctx, "load_bot_user", async () => interaction.client.user);
  if (!user) {
    await withStep(ctx, "reply_missing_user", async () => {
      await interaction.reply({ ephemeral: true, content: "Bot user missing (lol)." });
    });
    return;
  }

  await withStep(ctx, "update_presence", async () => {
    await user.setPresence({ activities: [], status: "online" });
    await user.setPresence({
      activities: [{ name: text, type: ActivityType.Playing }],
      status: "online",
    });
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({ ephemeral: true, content: "Status updated." });
  });
}
