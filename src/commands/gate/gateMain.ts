/**
 * Pawtropolis Tech -- src/commands/gate/gateMain.ts
 * WHAT: /gate command for guild gate management.
 * WHY: Setup, reset, status, config, welcome, and question management.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import {
  requireStaff,
  upsertConfig,
  getConfig,
  hasManageGuild,
  isReviewer,
  canRunAllCommands,
  hasGateAdmin,
  type GuildConfig,
} from "../../lib/config.js";
import { ensureGateEntry } from "../../features/gate.js";
import { renderWelcomeTemplate } from "../../features/review.js";
import { postWelcomeCard } from "../../features/welcome.js";
import { seedDefaultQuestionsIfEmpty, getQuestions, upsertQuestion } from "../../features/gate/questions.js";
import { postGateConfigCard } from "../../lib/configCard.js";
import {
  wrapCommand,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  withStep,
  withSql,
} from "../../lib/cmdWrap.js";
import { db } from "../../db/db.js";
import { secureCompare } from "../../lib/secureCompare.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";
import type { GuildMember } from "discord.js";
import { isGuildMember } from "../../lib/typeGuards.js";

export const data = new SlashCommandBuilder()
  .setName("gate")
  .setDescription("Guild gate management (v2)")
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
        o.setName("general_channel").setDescription("General/welcome channel").setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("accepted_role").setDescription("Role to grant when accepted").setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("unverified_channel")
          .setDescription("Unverified channel for pings (optional)")
          .setRequired(false)
      )
      .addRoleOption((o) =>
        o
          .setName("reviewer_role")
          .setDescription("Role that can review (optional)")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("reset").setDescription("Reset all application data (fresh invite) - staff only")
  )
  .addSubcommand((sc) => sc.setName("status").setDescription("Show application stats"))
  .addSubcommand((sc) => sc.setName("config").setDescription("View current gate configuration"))
  .addSubcommandGroup((group) =>
    group
      .setName("welcome")
      .setDescription("Manage the welcome message")
      .addSubcommand((sc) =>
        sc
          .setName("set")
          .setDescription("Update the welcome message template")
          .addStringOption((option) =>
            option
              .setName("content")
              .setDescription("Template content (supports {applicant.*} tokens)")
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(2000)
          )
      )
      .addSubcommand((sc) =>
        sc.setName("preview").setDescription("Preview the welcome message for yourself")
      )
      .addSubcommand((sc) =>
        sc
          .setName("channels")
          .setDescription("Configure welcome channels and ping role")
          .addChannelOption((o) =>
            o
              .setName("info_channel")
              .setDescription("Info channel to mention in welcome")
              .setRequired(false)
          )
          .addChannelOption((o) =>
            o
              .setName("rules_channel")
              .setDescription("Rules channel to mention in welcome")
              .setRequired(false)
          )
          .addRoleOption((o) =>
            o
              .setName("ping_role")
              .setDescription("Role to ping in welcome message")
              .setRequired(false)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName("role")
          .setDescription("Set the extra ping role for welcome messages")
          .addRoleOption((o) =>
            o.setName("role").setDescription("Role to ping in welcome message").setRequired(true)
          )
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-questions")
      .setDescription("Set (update) gate questions q1..q5. Omit any to leave unchanged.")
      .addStringOption((o) => o.setName("q1").setDescription("Question 1").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q2").setDescription("Question 2").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q3").setDescription("Question 3").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q4").setDescription("Question 4").setRequired(false).setMaxLength(500))
      .addStringOption((o) => o.setName("q5").setDescription("Question 5").setRequired(false).setMaxLength(500))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

async function executeSetup(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channels = await withStep(ctx, "validate_input", async () => {
    const reviewerRole = interaction.options.getRole("reviewer_role");
    const unverifiedChannel = interaction.options.getChannel("unverified_channel");
    return {
      review: interaction.options.getChannel("review_channel", true).id,
      gate: interaction.options.getChannel("gate_channel", true).id,
      general: interaction.options.getChannel("general_channel", true).id,
      unverified: unverifiedChannel?.id ?? null,
      accepted: interaction.options.getRole("accepted_role", true).id,
      reviewer: reviewerRole?.id ?? null,
    };
  });

  await withStep(ctx, "db_write", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config gate channels/roles", () =>
      upsertConfig(interaction.guildId!, {
        review_channel_id: channels.review,
        gate_channel_id: channels.gate,
        general_channel_id: channels.general,
        unverified_channel_id: channels.unverified,
        accepted_role_id: channels.accepted,
        reviewer_role_id: channels.reviewer,
      })
    );
  });

  const { inserted, total } = await withStep(ctx, "seed_questions", async () => {
    const result = seedDefaultQuestionsIfEmpty(interaction.guildId!, ctx);
    logger.info(
      { evt: "gate_questions_seed", guildId: interaction.guildId!, inserted: result.inserted, total: result.total },
      "[gate] questions seeded (if empty)"
    );
    return result;
  });

  await withStep(ctx, "ensure_entry", async () => {
    await ensureGateEntry(ctx, interaction.guildId!);
  });

  await withStep(ctx, "post_config_card", async () => {
    await postGateConfigCard(
      interaction,
      interaction.guild!,
      {
        reviewChannelId: channels.review,
        gateChannelId: channels.gate,
        generalChannelId: channels.general,
        unverifiedChannelId: channels.unverified,
        acceptedRoleId: channels.accepted,
        reviewerRoleId: channels.reviewer,
      },
      total
    );
  });
}

async function executeReset(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  const cfg = await withStep(ctx, "check_config", async () => {
    return withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));
  });

  if (!cfg) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "No configuration found. Run /gate setup first.",
    });
    return;
  }

  await withStep(ctx, "show_confirmation_modal", async () => {
    const modal = new ModalBuilder()
      .setCustomId(`v1:gate:reset:${interaction.guildId}`)
      .setTitle("⚠️ Reset Guild Data");

    const confirmInput = new TextInputBuilder()
      .setCustomId("v1:gate:reset:confirm")
      .setLabel('Type "RESET" to confirm')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("RESET");

    const passwordInput = new TextInputBuilder()
      .setCustomId("v1:gate:reset:password")
      .setLabel("Enter reset password (from env)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput)
    );

    await interaction.showModal(modal);
  });
}

export const handleResetModal = wrapCommand<ModalSubmitInteraction>("gate:reset", async (ctx) => {
  const { interaction } = ctx;

  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  const permissionResult = await withStep(ctx, "permission_check", async () => {
    const member = isGuildMember(interaction.member) ? interaction.member : null;
    const hasPermission =
      canRunAllCommands(member, interaction.guildId) ||
      hasManageGuild(member) ||
      isReviewer(interaction.guildId, member);
    return { hasPermission };
  });

  if (!permissionResult.hasPermission) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "You don't have permission for this.",
    });
    return;
  }

  const confirmResult = await withStep(ctx, "validate_confirm", async () => {
    const confirmText = interaction.fields.getTextInputValue("v1:gate:reset:confirm").trim();
    return { valid: confirmText === "RESET" };
  });

  if (!confirmResult.valid) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Confirmation word incorrect.",
    });
    return;
  }

  const passwordResult = await withStep(ctx, "validate_password", async () => {
    const password = interaction.fields.getTextInputValue("v1:gate:reset:password").trim();

    if (!env.RESET_PASSWORD) {
      return { valid: false, reason: "not_configured" as const };
    }

    if (!secureCompare(password, env.RESET_PASSWORD)) {
      logger.warn(
        {
          evt: "gate_reset_denied",
          guildId: interaction.guildId,
          userId: interaction.user.id,
        },
        "[gate] Reset denied: invalid password"
      );
      return { valid: false, reason: "incorrect" as const };
    }

    return { valid: true, reason: null };
  });

  if (!passwordResult.valid) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: passwordResult.reason === "not_configured" ? "RESET_PASSWORD not configured." : "Password incorrect.",
    });
    return;
  }

  await withStep(ctx, "defer_reply", async () => {
    await ensureDeferred(interaction);
  });

  const guildId = interaction.guildId;

  const recheckResult = await withStep(ctx, "permission_recheck", async () => {
    const memberRecheck = isGuildMember(interaction.member) ? interaction.member : null;
    const stillHasPermission =
      canRunAllCommands(memberRecheck, guildId) ||
      hasManageGuild(memberRecheck) ||
      isReviewer(guildId, memberRecheck);
    return { stillHasPermission };
  });

  if (!recheckResult.stillHasPermission) {
    logger.warn(
      { evt: "gate_reset_permission_revoked", guildId, userId: interaction.user.id },
      "[gate] Permission revoked between modal open and submit"
    );
    await interaction.editReply({ content: "Your permissions were revoked. Reset cancelled." });
    return;
  }

  await withStep(ctx, "wipe_tables", async () => {
    const resetAll = db.transaction(() => {
      const runDelete = (sql: string, optional = false) => {
        try {
          withSql(ctx, sql, () => db.prepare(sql).run());
        } catch (err) {
          if (optional && err instanceof Error && /no such table/i.test(err.message ?? "")) {
            logger.warn(
              { evt: "gate_reset_optional_missing", sql, err },
              "[gate] optional table missing during reset"
            );
            return;
          }
          throw err;
        }
      };

      runDelete("DELETE FROM application");
      runDelete("DELETE FROM application_response");
      runDelete("DELETE FROM review_action");
      runDelete("DELETE FROM modmail_bridge");
      runDelete("DELETE FROM review_card", true);
      runDelete("DELETE FROM avatar_scan", true);
      runDelete("DELETE FROM review_claim", true);
    });

    resetAll();
  });

  await withStep(ctx, "wipe_guild_question", async () => {
    const wipeQuestionsSql = "DELETE FROM guild_question WHERE guild_id = ?";
    try {
      withSql(ctx, wipeQuestionsSql, () => db.prepare(wipeQuestionsSql).run(guildId));
    } catch (err) {
      if (err instanceof Error && /no such table/i.test(err.message ?? "")) {
        logger.warn(
          { evt: "gate_reset_optional_missing", sql: wipeQuestionsSql, err },
          "[gate] questions table missing during reset"
        );
      } else {
        throw err;
      }
    }
  });

  const { inserted, total } = await withStep(ctx, "reseed_questions", async () => {
    const result = seedDefaultQuestionsIfEmpty(guildId, ctx);
    logger.info(
      { evt: "gate_questions_seed", guildId, inserted: result.inserted, total: result.total },
      "[gate] questions seeded (if empty)"
    );

    logger.info(
      {
        evt: "gate_reset_completed",
        guildId,
        userId: interaction.user.id,
      },
      `[gate] Reset completed for guild=${guildId}`
    );

    return result;
  });

  await withStep(ctx, "ensure_entry", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(guildId));
    if (cfg && cfg.gate_channel_id) {
      try {
        await ensureGateEntry(ctx, guildId!);
      } catch (err) {
        logger.warn({ err, guildId }, "Failed to ensure gate entry after reset");
      }
    }
  });

  await interaction.editReply({
    content: `Guild data reset. Questions seeded: ${total}. Gate Entry ensured.`,
  });
});

async function executeStatus(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const { statusCounts, claimedCount } = await withStep(ctx, "query_stats", async () => {
    const guildId = interaction.guildId!;

    const counts = withSql(ctx, "SELECT application status counts", () =>
      db
        .prepare(
          `SELECT status, COUNT(*) as count
           FROM application
           WHERE guild_id = ?
           GROUP BY status`
        )
        .all(guildId) as Array<{ status: string; count: number }>
    );

    const claimed = withSql(ctx, "SELECT review_claim count", () =>
      db
        .prepare(`SELECT COUNT(DISTINCT app_id) as count FROM review_claim`)
        .get() as { count: number }
    );

    return { statusCounts: counts, claimedCount: claimed };
  });

  await withStep(ctx, "reply", async () => {
    const lines = ["**Application Statistics**", ""];
    for (const row of statusCounts) {
      lines.push(`${row.status}: ${row.count}`);
    }
    lines.push("", `Claimed: ${claimedCount.count}`);

    await replyOrEdit(interaction, { content: lines.join("\n") });
  });
}

async function executeConfigView(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const cfg = await withStep(ctx, "load_config", async () => {
    return withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));
  });

  if (!cfg) {
    await replyOrEdit(interaction, { content: "No configuration found. Run /gate setup first." });
    return;
  }

  await withStep(ctx, "reply", async () => {
    const lines = [
      "**Gate Configuration**",
      "",
      `Review channel: ${cfg.review_channel_id ? `<#${cfg.review_channel_id}>` : "not set"}`,
      `Gate channel: ${cfg.gate_channel_id ? `<#${cfg.gate_channel_id}>` : "not set"}`,
      `General channel: ${cfg.general_channel_id ? `<#${cfg.general_channel_id}>` : "not set"}`,
      `Unverified channel: ${cfg.unverified_channel_id ? `<#${cfg.unverified_channel_id}>` : "not set"}`,
      `Accepted role: ${cfg.accepted_role_id ? `<@&${cfg.accepted_role_id}>` : "not set"}`,
      `Reviewer role: ${cfg.reviewer_role_id ? `<@&${cfg.reviewer_role_id}>` : "not set (uses channel perms)"}`,
      "",
      `Avatar scan enabled: ${cfg.avatar_scan_enabled ? "yes" : "no"}`,
    ];

    await replyOrEdit(interaction, { content: lines.join("\n") });
  });
}

async function executeSetQuestions(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const hasPermission = await withStep(ctx, "validate_permission", async () => {
    return await hasGateAdmin(interaction);
  });

  if (!hasPermission) {
    await replyOrEdit(interaction, {
      flags: MessageFlags.Ephemeral,
      content:
        "You need owner/admin privileges to modify gate questions (guild owner, bot owners, configured admin roles, or Manage Server permission).",
    });
    return;
  }

  const guildId = interaction.guildId!;

  const updates = await withStep(ctx, "parse_input", async () => {
    const result: Array<{ index: number; prompt: string }> = [];
    for (let i = 1; i <= 5; i++) {
      const val = interaction.options.getString(`q${i}`, false);
      if (val && val.trim()) {
        result.push({ index: i - 1, prompt: val.trim() });
      }
    }
    return result;
  });

  if (updates.length === 0) {
    const preview = await withStep(ctx, "load_current", async () => {
      const current = withSql(ctx, "SELECT guild_question", () =>
        getQuestions(guildId).filter(q => q.q_index >= 0 && q.q_index <= 4)
      );
      return current.length > 0
        ? current.map((q, i) => `${i + 1}) ${q.prompt}`).join("\n")
        : "(No questions set)";
    });
    await replyOrEdit(interaction, {
      flags: MessageFlags.Ephemeral,
      content: `No changes provided.\n\n**Current questions:**\n${preview}\n\nTo update, use: \`/gate set-questions q1:"Your question here"\``,
    });
    return;
  }

  await withStep(ctx, "upsert_questions", async () => {
    const tx = db.transaction(() => {
      for (const u of updates) {
        upsertQuestion(guildId, u.index, u.prompt, 1, ctx);
      }
    });
    tx();
  });

  const { updated, preview } = await withStep(ctx, "load_updated", async () => {
    const current = withSql(ctx, "SELECT guild_question", () =>
      getQuestions(guildId).filter(q => q.q_index >= 0 && q.q_index <= 4)
    );
    const updatedStr = updates.map((u) => `q${u.index + 1}`).join(", ");
    const previewStr = current.length > 0
      ? current.map((q, i) => `${i + 1}) ${q.prompt}`).join("\n")
      : "(No questions)";
    return { updated: updatedStr, preview: previewStr };
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      flags: MessageFlags.Ephemeral,
      content: `✅ Updated: **${updated}**\n\n**Current questions:**\n${preview}`,
    });
  });
}

async function executeWelcomeSet(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const validationResult = await withStep(ctx, "validate_template", async () => {
    const raw = interaction.options.getString("content", true);
    const content = raw.trim();
    if (content.length === 0) {
      return { valid: false, reason: "empty" as const, content: "" };
    }
    if (content.length > 2000) {
      return { valid: false, reason: "too_long" as const, content: "" };
    }
    return { valid: true, reason: null, content };
  });

  if (!validationResult.valid) {
    await replyOrEdit(interaction, {
      content: validationResult.reason === "empty"
        ? "Template must include some text."
        : "Template is too long (limit 2000 characters).",
    });
    return;
  }

  await withStep(ctx, "persist_template", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config welcome_template", () =>
      upsertConfig(interaction.guildId!, { welcome_template: validationResult.content })
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, { content: "Welcome template updated." });
  });
}

async function executeWelcomePreview(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const member = interaction.member as GuildMember | null;
  if (!member) {
    await replyOrEdit(interaction, { content: "Preview unavailable (member not resolved)." });
    return;
  }

  const content = await withStep(ctx, "render_preview", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    return renderWelcomeTemplate({
      template: cfg?.welcome_template ?? null,
      guildName: interaction.guild!.name,
      applicant: {
        id: member.id,
        tag: member.user?.tag ?? member.user.username,
        display: member.displayName,
      },
    });
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, { content });
  });
}

async function executeWelcomeChannels(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const updates = await withStep(ctx, "gather_options", async () => {
    const infoChannel = interaction.options.getChannel("info_channel");
    const rulesChannel = interaction.options.getChannel("rules_channel");
    const pingRole = interaction.options.getRole("ping_role");

    const result: Partial<GuildConfig> = {};
    if (infoChannel) result.info_channel_id = infoChannel.id;
    if (rulesChannel) result.rules_channel_id = rulesChannel.id;
    if (pingRole) result.welcome_ping_role_id = pingRole.id;
    return result;
  });

  if (Object.keys(updates).length === 0) {
    await replyOrEdit(interaction, { content: "No changes specified." });
    return;
  }

  await withStep(ctx, "persist_config", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config welcome channels", () =>
      upsertConfig(interaction.guildId!, updates)
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, { content: "Welcome channels updated." });
  });
}

async function executeWelcomeRole(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const role = await withStep(ctx, "get_role", async () => {
    return interaction.options.getRole("role", true);
  });

  await withStep(ctx, "persist_config", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config welcome_ping_role_id", () =>
      upsertConfig(interaction.guildId!, { welcome_ping_role_id: role.id })
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, { content: "Welcome ping role updated." });
  });
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await withStep(ctx, "invalid_scope", async () => {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    });
    return;
  }

  const hasPermission = await withStep(ctx, "permission_check", async () => {
    return requireStaff(interaction, {
      command: "gate",
      description: "Manages guild gate and verification settings.",
      requirements: [
        { type: "config", field: "mod_role_ids" },
        { type: "permission", permission: "ManageGuild" },
      ],
    });
  });

  if (!hasPermission) return;

  await withStep(ctx, "route_subcommand", async () => {
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    if (!subcommandGroup) {
      const subcommand = interaction.options.getSubcommand();
      switch (subcommand) {
        case "setup":
          await executeSetup(ctx);
          break;
        case "reset":
          await executeReset(ctx);
          break;
        case "status":
          await executeStatus(ctx);
          break;
        case "config":
          await executeConfigView(ctx);
          break;
        case "set-questions":
          await executeSetQuestions(ctx);
          break;
      }
      return;
    }

    if (subcommandGroup === "welcome") {
      const subcommand = interaction.options.getSubcommand();
      switch (subcommand) {
        case "set":
          await executeWelcomeSet(ctx);
          break;
        case "preview":
          await executeWelcomePreview(ctx);
          break;
        case "channels":
          await executeWelcomeChannels(ctx);
          break;
        case "role":
          await executeWelcomeRole(ctx);
          break;
      }
    }
  });
}
