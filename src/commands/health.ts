// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health (uptime and latency).");

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const metrics = await withStep(ctx, "collect_metrics", async () => ({
    uptimeSec: Math.floor(process.uptime()),
    ping: Math.round(interaction.client.ws.ping),
  }));

  await withStep(ctx, "reply", async () => {
    const embed = new EmbedBuilder()
      .setTitle("Health Check")
      .setColor(0x57f287)
      .addFields(
        { name: "Status", value: "Healthy", inline: true },
        { name: "Uptime", value: formatUptime(metrics.uptimeSec), inline: true },
        { name: "WS Ping", value: `${metrics.ping}ms`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  });
}
