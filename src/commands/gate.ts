// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  userMention,
  inlineCode,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
  type GuildMember,
} from "discord.js";
import { ConfigKey, Hours, HttpUrl, Snowflake } from "../lib/validators.js";
import { requireStaff, hasManageGuild, isReviewer } from "../lib/permissions.js";
import { getConfig, upsertConfig } from "../lib/config.js";
import { db } from "../db/connection.js";
import { ensurePinnedGateMessage } from "../features/gate/gateEntry.js";
import { wrapCommand, withStep, type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("gate")
  .setDescription("Gatekeeping configuration and utilities")
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
        o.setName("unverified_channel").setDescription("Unverified chat/ping channel").setRequired(true)
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
  .addSubcommand((sc) =>
    sc.setName("status").setDescription("Show bot status and config completeness")
  )
  .addSubcommand((sc) => sc.setName("queue").setDescription("Show application queue counts"))
  .addSubcommand((sc) =>
    sc
      .setName("reset")
      .setDescription("Delete a user's draft application")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
  )
  .addSubcommand((sc) =>
    sc.setName("ensure-entry").setDescription("Ensure the gate entry message is pinned")
  )
  .addSubcommand((sc) =>
    sc.setName("factory-reset").setDescription("Wipe application data after confirmation")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  if (!interaction.guildId) {
    ctx.step("invalid_scope");
    await interaction.reply({ ephemeral: true, content: "Guild only." });
    return;
  }

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  const sub = await withStep(ctx, "parse_subcommand", async () =>
    interaction.options.getSubcommand(true)
  );

  ctx.step(`dispatch_${sub}`);
  if (sub === "setup") return runSetup(ctx);
  if (sub === "config") return runConfig(ctx);
  if (sub === "status") return runStatus(ctx);
  if (sub === "queue") return runQueue(ctx);
  if (sub === "reset") return runReset(ctx);
  if (sub === "ensure-entry") return runEnsureEntry(ctx);
  if (sub === "factory-reset") return runFactoryReset(ctx);
}

async function runSetup(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const gid = interaction.guildId!;

  const channels = await withStep(ctx, "validate_input", async () => {
    const review = interaction.options.getChannel("review_channel", true).id;
    const gate = interaction.options.getChannel("gate_channel", true).id;
    const unverified = interaction.options.getChannel("unverified_channel", true).id;
    const general = interaction.options.getChannel("general_channel", true).id;
    const accepted = interaction.options.getRole("accepted_role", true).id;
    const reviewer = interaction.options.getRole("reviewer_role", true).id;
    Snowflake.parse(review);
    Snowflake.parse(gate);
    Snowflake.parse(unverified);
    Snowflake.parse(general);
    Snowflake.parse(accepted);
    Snowflake.parse(reviewer);
    return { review, gate, unverified, general, accepted, reviewer };
  });

  await withStep(ctx, "db_write", async () => {
    upsertConfig(gid, {
      review_channel_id: channels.review,
      gate_channel_id: channels.gate,
      unverified_channel_id: channels.unverified,
      general_channel_id: channels.general,
      accepted_role_id: channels.accepted,
      reviewer_role_id: channels.reviewer,
    });
  });

  const pinResult = await withStep(ctx, "pin_message", async () =>
    ensurePinnedGateMessage(interaction.client, gid)
  );

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({
      ephemeral: true,
      content:
        "Config saved.\n" +
        `review=${inlineCode(channels.review)}\n` +
        `gate=${inlineCode(channels.gate)}\n` +
        `unverified=${inlineCode(channels.unverified)}\n` +
        `general=${inlineCode(channels.general)}\n` +
        `accepted_role=${inlineCode(channels.accepted)} reviewer_role=${inlineCode(channels.reviewer)}\n` +
        `Pinned ${pinResult.pinned ? "✅" : "⚠️"}${pinResult.reason ? `: ${pinResult.reason}` : ""}`,
    });
  });
}

async function runConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const gid = interaction.guildId!;
  const action = await withStep(ctx, "parse_action", async () =>
    interaction.options.getString("action", true)
  );

  if (action === "get") {
    const cfg = await withStep(ctx, "load_config", async () => getConfig(gid));
    if (!cfg) {
      await withStep(ctx, "final_reply", async () => {
        await interaction.reply({
          ephemeral: true,
          content: "No config found. Run /gate setup first.",
        });
      });
      return;
    }
    const content = [
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
    await withStep(ctx, "final_reply", async () => {
      await interaction.reply({ ephemeral: true, content: "```ini\n" + content + "\n```" });
    });
    return;
  }

  const { key, value } = await withStep(ctx, "validate_input", async () => {
    const optionKey = interaction.options.getString("key", true);
    const optionValue = interaction.options.getString("value", true);
    ConfigKey.parse(optionKey);
    return { key: optionKey, value: optionValue };
  });

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

  await withStep(ctx, "db_write", async () => {
    upsertConfig(gid, patch);
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({ ephemeral: true, content: `✅ Updated ${inlineCode(key)}.` });
  });
}

async function runStatus(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const cfg = await withStep(ctx, "load_config", async () => getConfig(interaction.guildId!));
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

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({ ephemeral: true, content });
  });
}

async function runQueue(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const gid = interaction.guildId!;
  const rows = await withStep(ctx, "db_query", async () =>
    db
      .prepare(
        `
    SELECT status, COUNT(*) as count
    FROM application
    WHERE guild_id = ?
    GROUP BY status
  `
      )
      .all(gid) as Array<{ status: string; count: number }>
  );
  const counts = new Map(rows.map((row) => [row.status, row.count]));
  const lines = [
    `Submitted: ${counts.get("submitted") ?? 0}`,
    `Needs info: ${counts.get("needs_info") ?? 0}`,
    `Approved: ${counts.get("approved") ?? 0}`,
    `Rejected: ${counts.get("rejected") ?? 0}`,
    `Kicked: ${counts.get("kicked") ?? 0}`,
  ];

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({ ephemeral: true, content: lines.join("\n") });
  });
}

async function runReset(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const gid = interaction.guildId!;
  const user = await withStep(ctx, "validate_input", async () =>
    interaction.options.getUser("user", true)
  );

  const draft = await withStep(ctx, "lookup_draft", async () =>
    db
      .prepare(
        `
    SELECT id FROM application
    WHERE guild_id = ? AND user_id = ? AND status = 'draft'
  `
      )
      .get(gid, user.id) as { id: string } | undefined
  );

  if (!draft) {
    await withStep(ctx, "final_reply", async () => {
      await interaction.reply({
        ephemeral: true,
        content: `${userMention(user.id)} has no draft application.`,
      });
    });
    return;
  }

  await withStep(ctx, "db_write", async () => {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM application_response WHERE app_id = ?").run(draft.id);
      db.prepare("DELETE FROM application WHERE id = ?").run(draft.id);
    });
    tx();
  });

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({
      ephemeral: true,
      content: `✅ Deleted draft application for ${userMention(user.id)}.`,
    });
  });
}

async function runEnsureEntry(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const gid = interaction.guildId!;
  const pinResult = await withStep(ctx, "pin_message", async () =>
    ensurePinnedGateMessage(interaction.client, gid)
  );

  await withStep(ctx, "final_reply", async () => {
    await interaction.reply({
      ephemeral: true,
      content: `Gate entry message refreshed.\nPinned ${pinResult.pinned ? "✅" : "⚠️"}${
        pinResult.reason ? `: ${pinResult.reason}` : ""
      }`,
    });
  });
}

async function runFactoryReset(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  ctx.step("confirm_modal");
  const modal = new ModalBuilder().setCustomId("v1:factory-reset").setTitle("Factory Reset");
  const confirmInput = new TextInputBuilder()
    .setCustomId("v1:factory-reset:confirm")
    .setLabel("Type RESET to confirm")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput));
  await withStep(ctx, "show_modal", async () => {
    await interaction.showModal(modal);
  });
}

export const handleFactoryResetModal = wrapCommand<ModalSubmitInteraction>(
  "gate factory-reset",
  async (ctx) => {
    const { interaction } = ctx;

    ctx.step("verify_modal");
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ ephemeral: true, content: "Guild only." });
      return;
    }

    const guildMember = interaction.member as GuildMember | null;
    const manageGuild = hasManageGuild(guildMember);
    const reviewer = isReviewer(interaction.guildId, guildMember);
    if (!manageGuild && !reviewer) {
      await interaction.reply({ ephemeral: true, content: "Nope." });
      return;
    }

    const confirm = interaction.fields.getTextInputValue("v1:factory-reset:confirm").trim();
    if (confirm !== "RESET") {
      await interaction.reply({ ephemeral: true, content: "Nope." });
      return;
    }

    ctx.step("db_begin");
    const wipe = db.transaction(() => {
      ctx.step("drop_or_truncate");
      db.prepare("DELETE FROM application_response").run();
      db.prepare("DELETE FROM review_action").run();
      db.prepare("DELETE FROM review_card").run();
      db.prepare("DELETE FROM modmail_bridge").run();
      db.prepare("DELETE FROM user_snapshot").run();
      db.prepare("DELETE FROM application").run();
      db.prepare("DELETE FROM guild_question").run();
    });
    wipe();

  ctx.step("migrate_post_wipe");
  db.prepare("VACUUM").run();
    try {
      await import("../db/migrate.js");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(message)) {
        throw err;
      }
      logger.warn({ err }, "Factory reset migrations already applied");
    }

  ctx.step("reply_done");
  await interaction.reply({ ephemeral: true, content: "Factory reset complete." });
  }
);
