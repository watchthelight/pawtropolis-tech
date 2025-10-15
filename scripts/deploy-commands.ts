/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import { REST, Routes } from "discord.js";
import { env } from "../src/lib/env.js";
import * as health from "../src/commands/health.js";
import * as gate from "../src/commands/gate.js";

const commands = [health.data.toJSON(), gate.data.toJSON()];
async function run() {
  // Debug info (only show in development, never log tokens)
  if (env.NODE_ENV === "development") {
     
    console.log("Client ID:", env.CLIENT_ID);
     
    console.log("Guild ID:", env.GUILD_ID || "(global deployment)");
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  if (env.GUILD_ID && env.GUILD_ID.trim().length > 0) {
    await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), {
      body: commands,
    });
     
    console.log(`Registered ${commands.length} command(s) to guild ${env.GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(env.CLIENT_ID), { body: commands });
     
    console.log(
      `Registered ${commands.length} global command(s). Propagation may take up to 1 hour.`
    );
  }
}
run().catch((err) => {
   
  console.error("Failed to deploy commands:", err);
  process.exit(1);
});
