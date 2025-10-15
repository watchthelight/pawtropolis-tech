/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  userMention,
  inlineCode,
} from "discord.js";
import { ConfigKey, Hours, HttpUrl, Snowflake } from "../lib/validators.js";
import { requireStaff } from "../lib/permissions.js";
import { getConfig, upsertConfig } from "../lib/config.js";
import { db } from "../db/connection.js";
export const data = new SlashCommandBuilder()
  .setName("gate")
  .setDescription("Gatekeeping configuration and utilities")
  // /gate setup …
  .addSubcommand((sc) =>
    sc
      .setName("setup")
      .setDescription("Initialize config for this guild")
      .addChannelOption((o) =>
        o.setName("review_channel").setDescription("Staff review channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("gate_channel").setDescription("Public gate/apply channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("unverified_channel")
          .setDescription("Unverified chat/ping channel")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("general_channel").setDescription("General/welcome channel").setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("accepted_role").setDescription("Role to grant when accepted").setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("reviewer_role").setDescription("Role that can review").setRequired(true)
      )
  )
  // /gate config set key value
  .addSubcommand((sc) =>
    sc
      .setName("config")
      .setDescription("Get or set configuration")
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("get or set")
          .addChoices({ name: "get", value: "get" }, { name: "set", value: "set" })
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("key")
          .setDescription("config key")
          .addChoices(...ConfigKey.options.map((k) => ({ name: k, value: k })))
      )
      .addStringOption((o) =>
        o.setName("value").setDescription("new value (string/snowflake/hours/url)")
      )
  )
  // /gate status
  .addSubcommand((sc) =>
    sc.setName("status").setDescription("Show bot status and config completeness")
  )
  // /gate reset user @user
  .addSubcommand((sc) =>
    sc
      .setName("reset")
      .setDescription("Delete a user's draft application")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return interaction.reply({ ephemeral: true, content: "Guild only." });
  const sub = interaction.options.getSubcommand(true);
  // guard staff perms for all subcommands
  if (!requireStaff(interaction)) return;
  if (sub === "setup") return runSetup(interaction);
  if (sub === "config") return runConfig(interaction);
  if (sub === "status") return runStatus(interaction);
  if (sub === "reset") return runReset(interaction);
}
async function runSetup(interaction: ChatInputCommandInteraction) {
  const gid = interaction.guildId!;
  const review = interaction.options.getChannel("review_channel", true).id;
  const gate = interaction.options.getChannel("gate_channel", true).id;
  const unverified = interaction.options.getChannel("unverified_channel", true).id;
  const general = interaction.options.getChannel("general_channel", true).id;
  const accepted = interaction.options.getRole("accepted_role", true).id;
  const reviewer = interaction.options.getRole("reviewer_role", true).id;
  // validate as snowflakes
  Snowflake.parse(review);
  Snowflake.parse(gate);
  Snowflake.parse(unverified);
  Snowflake.parse(general);
  Snowflake.parse(accepted);
  Snowflake.parse(reviewer);
  upsertConfig(gid, {
    review_channel_id: review,
    gate_channel_id: gate,
    unverified_channel_id: unverified,
    general_channel_id: general,
    accepted_role_id: accepted,
    reviewer_role_id: reviewer,
  });
  await interaction.reply({
    ephemeral: true,
    content:
      "✅ Config saved.\n" +
      `review=${inlineCode(review)}\n` +
      `gate=${inlineCode(gate)}\n` +
      `unverified=${inlineCode(unverified)}\n` +
      `general=${inlineCode(general)}\n` +
      `accepted_role=${inlineCode(accepted)} reviewer_role=${inlineCode(reviewer)}`,
  });
}
async function runConfig(interaction: ChatInputCommandInteraction) {
  const gid = interaction.guildId!;
  const action = interaction.options.getString("action", true);
  if (action === "get") {
    const cfg = getConfig(gid);
    if (!cfg)
      return interaction.reply({
        ephemeral: true,
        content: "No config found. Run /gate setup first.",
      });
    const lines = [
      `review_channel_id: ${cfg.review_channel_id ?? "unset"}`,
      `gate_channel_id: ${cfg.gate_channel_id ?? "unset"}`,
      `unverified_channel_id: ${cfg.unverified_channel_id ?? "unset"}`,
      `general_channel_id: ${cfg.general_channel_id ?? "unset"}`,
      `accepted_role_id: ${cfg.accepted_role_id ?? "unset"}`,
      `reviewer_role_id: ${cfg.reviewer_role_id ?? "unset"}`,
      `reapply_cooldown_hours: ${cfg.reapply_cooldown_hours}`,
      `min_account_age_hours: ${cfg.min_account_age_hours}`,
      `min_join_age_hours: ${cfg.min_join_age_hours}`,
      `image_search_url_template: ${cfg.image_search_url_template}`,
    ].join("\n");
    return interaction.reply({ ephemeral: true, content: "```ini\n" + lines + "\n```" });
  }
  // set
  const key = interaction.options.getString("key", true);
  const value = interaction.options.getString("value", true);
  ConfigKey.parse(key);
  // validate by key
  const patch: Record<string, string | number | null> = {};
  if (key.endsWith("_id")) {
    Snowflake.parse(value);
    patch[key] = value;
  } else if (key.endsWith("_hours")) {
    patch[key] = Hours.parse(value);
  } else if (key === "image_search_url_template") {
    patch[key] = HttpUrl.parse(value);
  } else {
    patch[key] = value;
  }
  upsertConfig(gid, patch);
  await interaction.reply({ ephemeral: true, content: `✅ Updated ${inlineCode(key)}.` });
}
async function runStatus(interaction: ChatInputCommandInteraction) {
  const cfg = getConfig(interaction.guildId!);
  const required = [
    "review_channel_id",
    "gate_channel_id",
    "unverified_channel_id",
    "general_channel_id",
    "accepted_role_id",
    "reviewer_role_id",
  ] as const;
  const missing = required.filter((k) => !cfg?.[k]);
  const wsPing = Math.round(interaction.client.ws.ping);
  const ok = missing.length === 0;
  const content =
    `WS ping: ${wsPing}ms\n` +
    `Config: ${ok ? "complete" : "missing"}\n` +
    (ok ? "" : `Missing: ${missing.join(", ")}`);
  await interaction.reply({ ephemeral: true, content });
}
async function runReset(interaction: ChatInputCommandInteraction) {
  const gid = interaction.guildId!;
  const user = interaction.options.getUser("user", true);
  const draft = db
    .prepare(
      `
    SELECT id FROM application
    WHERE guild_id = ? AND user_id = ? AND status = 'draft'
  `
    )
    .get(gid, user.id) as { id: string } | undefined;
  if (!draft) {
    await interaction.reply({
      ephemeral: true,
      content: `${userMention(user.id)} has no draft application.`,
    });
    return;
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM application_response WHERE app_id = ?").run(draft.id);
    db.prepare("DELETE FROM application WHERE id = ?").run(draft.id);
  });
  tx();
  await interaction.reply({
    ephemeral: true,
    content: `🧹 Deleted draft application for ${userMention(user.id)}.`,
  });
}