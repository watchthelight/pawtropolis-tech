// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { initializeSentry, addBreadcrumb, setUser, setTag, captureException } from "./lib/sentry.js";
initializeSentry();

import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  type ChatInputCommandInteraction,
  Events,
} from "discord.js";
import { logger } from "./lib/logger.js";
import { env } from "./lib/env.js";
import * as health from "./commands/health.js";
import * as gate from "./commands/gate.js";
import * as statusupdate from "./commands/statusupdate.js";
import {
  handleStartButton,
  handleGateModalSubmit,
  handleDoneButton,
} from "./features/gate.js";
import {
  handleReviewButton,
  handleRejectModal,
  handleAvatarViewSourceButton,
  handleAvatarConfirmModal,
} from "./features/review.js";
import { wrapCommand } from "./lib/cmdWrap.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const commands = new Collection<string, (interaction: ChatInputCommandInteraction) => Promise<void>>();
commands.set(health.data.name, wrapCommand("health", health.execute));
commands.set(gate.data.name, wrapCommand("gate", gate.execute));
commands.set(statusupdate.data.name, wrapCommand("statusupdate", statusupdate.execute));

client.once(Events.ClientReady, async () => {
  logger.info({ tag: client.user?.tag, id: client.user?.id }, "Bot ready");

  if (client.user) {
    setTag("bot_id", client.user.id);
    setTag("bot_username", client.user.username);
  }

  addBreadcrumb({
    message: "Bot successfully connected to Discord",
    category: "bot",
    level: "info",
  });

  if (env.NODE_ENV === "development") {
    logger.info("Dev mode: use `npm run deploy:cmds`.");
  } else {
    logger.info("Prod mode: `npm run deploy:cmds`");
  }
});

client.on("interactionCreate", async (interaction) => {
  setUser({
    id: interaction.user.id,
    username: interaction.user.username,
  });

  if (interaction.isChatInputCommand()) {
    const executor = commands.get(interaction.commandName);
    if (!executor) {
      addBreadcrumb({
        message: `Unknown command attempted: ${interaction.commandName}`,
        category: "command",
        level: "warning",
        data: { commandName: interaction.commandName },
      });

      await interaction
        .reply({ content: "Unknown command.", ephemeral: true })
        .catch((err) => logger.warn({ err }, "Failed to reply with unknown command message"));
      return;
    }

    addBreadcrumb({
      message: `Executing command: ${interaction.commandName}`,
      category: "command",
      level: "info",
      data: {
        commandName: interaction.commandName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
    });

    try {
      await executor(interaction);

      addBreadcrumb({
        message: `Command completed: ${interaction.commandName}`,
        category: "command",
        level: "info",
      });
    } catch (err) {
      logger.error({ err }, "Command execution error (unwrapped)");
      captureException(err, {
        commandName: interaction.commandName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        username: interaction.user.username,
      });
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("v1:avatar:viewsrc:")) {
      await handleAvatarViewSourceButton(interaction);
      return;
    }
    if (interaction.customId.startsWith("v1:decide:")) {
      await handleReviewButton(interaction);
      return;
    }
    if (interaction.customId === "v1:done") {
      await handleDoneButton(interaction);
      return;
    }
    if (interaction.customId.startsWith("v1:start")) {
      await handleStartButton(interaction);
      return;
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("v1:avatar:confirm18:")) {
      await handleAvatarConfirmModal(interaction);
      return;
    }
    if (interaction.customId.startsWith("v1:modal:reject:")) {
      await handleRejectModal(interaction);
      return;
    }
    if (interaction.customId.startsWith("v1:modal:p")) {
      await handleGateModalSubmit(interaction);
      return;
    }
  }
});

async function main() {
  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
