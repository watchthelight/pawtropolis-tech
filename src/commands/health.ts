// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */
import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health (uptime and latency).");
export async function execute(interaction: ChatInputCommandInteraction) {
  const uptimeSec = Math.floor(process.uptime());
  const ping = Math.round(interaction.client.ws.ping);
  const content = `Healthy. Uptime: ${uptimeSec}s • WS ping: ${ping}ms`;
  await interaction.reply({ content, ephemeral: false });
}
