import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActivityType,
} from "discord.js";
import { requireStaff } from "../lib/permissions.js";

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

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!requireStaff(interaction)) return;

  const text = interaction.options.getString("text", true);
  const user = interaction.client.user;
  if (!user) {
    await interaction.reply({ ephemeral: true, content: "Bot user missing (lol)." });
    return;
  }

  await user.setPresence({ activities: [], status: "online" });
  await user.setPresence({
    activities: [{ name: text, type: ActivityType.Playing }],
    status: "online",
  });

  await interaction.reply({ ephemeral: true, content: "Status updated." });
}
