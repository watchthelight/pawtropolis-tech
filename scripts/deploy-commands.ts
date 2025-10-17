// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import {
  REST,
  Routes,
  type RESTGetAPIOAuth2CurrentApplicationResult,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { env } from "../src/lib/env.js";

function mask(t?: string) {
  return t ? `${t.slice(0, 6)}...(${t.length})` : "(missing)";
}

async function preflight(rest: REST) {
  const me = (await rest.get(
    Routes.oauth2CurrentApplication()
  )) as RESTGetAPIOAuth2CurrentApplicationResult;
  const returnedId = me?.id;
  console.log("Client ID:", env.CLIENT_ID);
  console.log("Guild ID:", env.GUILD_ID || "(none)");
  console.log("Token:", mask(process.env.DISCORD_TOKEN));
  if (!returnedId) throw new Error("No application id from @me");
  if (returnedId !== env.CLIENT_ID) {
    throw new Error(
      `Token/CLIENT_ID mismatch: token belongs to ${returnedId}, env.CLIENT_ID=${env.CLIENT_ID}`
    );
  }
}

async function run() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  try {
    await preflight(rest);
  } catch (e) {
    console.error("[deploy:cmds] Preflight failed:", e);
    console.error("Tip: run `npm run auth:whoami` for a focused check.");
    process.exit(2);
  }

  const cmds: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
  const modules = [
    "../src/commands/health.js",
    "../src/commands/gate.js",
    "../src/commands/statusupdate.js",
  ];

  for (const mod of modules) {
    try {
      const loaded = await import(mod);
      if (loaded?.data?.toJSON) {
        const payload = loaded.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody;
        cmds.push(payload);
      }
    } catch {
      // optional command not present
    }
  }

  try {
    if (env.GUILD_ID && env.GUILD_ID.trim()) {
      await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), { body: cmds });
      console.log(`Registered ${cmds.length} command(s) to guild ${env.GUILD_ID}.`);
    } else {
      await rest.put(Routes.applicationCommands(env.CLIENT_ID), { body: cmds });
      console.log(`Registered ${cmds.length} global command(s).`);
    }
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err as { status?: number }).status === 401
    ) {
      console.error("[deploy:cmds] 401 Unauthorized. Token invalid or mismatched with CLIENT_ID.");
      console.error("Run: npm run auth:whoami");
    }
    throw err;
  }
}

run().catch((err) => {
  console.error("Failed to deploy commands:", err);
  process.exit(1);
});
