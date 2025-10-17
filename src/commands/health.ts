// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health (uptime and latency).");

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const metrics = await withStep(ctx, "collect_metrics", async () => ({
    uptimeSec: Math.floor(process.uptime()),
    ping: Math.round(interaction.client.ws.ping),
  }));

  await withStep(ctx, "reply", async () => {
    const content = `Healthy. Uptime: ${metrics.uptimeSec}s �?� WS ping: ${metrics.ping}ms`;
    await interaction.reply({ content, ephemeral: false });
  });
}
