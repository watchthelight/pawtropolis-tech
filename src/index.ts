/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import { Client, GatewayIntentBits, Partials, Collection, type Interaction } from "discord.js";
import { logger } from "./lib/logger.js";
import { env } from "./lib/env.js";
import * as health from "./commands/health.js";
import * as gate from "./commands/gate.js";

type CommandModule = {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: Interaction) => Promise<void>;
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const commands = new Collection<string, CommandModule>();
[health, gate].forEach((cmd) => commands.set(cmd.data.name, cmd as unknown as CommandModule));
client.once("ready", async () => {
  logger.info({ tag: client.user?.tag, id: client.user?.id }, "Bot ready");
  if (env.NODE_ENV === "development") {
    logger.info(
      "Dev mode: use `npm run deploy:cmds` (bro you made ts why do you not remember what this does)."
    );
  } else {
    logger.info("Prod mode: `npm run deploy:cmds`");
  }
});
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) {
    await interaction
      .reply({ content: "Unknown command.", ephemeral: true })
      .catch((err) => logger.warn({ err }, "Failed to reply with unknown command message"));
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cmd as any).execute(interaction);
  } catch (err) {
    logger.error({ err }, "Command execution error");
    if (interaction.deferred || interaction.replied) {
      await interaction
        .followUp({ content: "Something went wrong.", ephemeral: true })
        .catch((err) => logger.warn({ err }, "Failed to send error followUp"));
    } else {
      await interaction
        .reply({ content: "Something went wrong.", ephemeral: true })
        .catch((err) => logger.warn({ err }, "Failed to send error reply"));
    }
  }
});
// BRO DO NOT hardcode YOUR TOKEN HERE IT IS A SECURITY RISK YOU DUMMY
async function main() {
  await client.login(env.DISCORD_TOKEN);
}
main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
