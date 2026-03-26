/**
 * Pawtropolis Tech -- src/commands/config/pulse.ts
 * WHAT: Pulse newsletter configuration handlers.
 * WHY: Lets staff exclude Discord categories from newsletter stats
 *      (prevents inflated numbers and staff channel name leaks).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { EmbedBuilder, Colors, ChannelType } from "discord.js";
import {
  type ChatInputCommandInteraction,
  MessageFlags,
  upsertConfig,
  getConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  withStep,
  withSql,
  logger,
} from "./shared.js";

export async function executePulseExcludeCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const category = await withStep(ctx, "get_category", async () => {
    return interaction.options.getChannel("category", true);
  });

  if (category.type !== ChannelType.GuildCategory) {
    await replyOrEdit(interaction, {
      content: `Channel <#${category.id}> is not a category. Please select a category channel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await withStep(ctx, "update_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    let categoryIds: string[] = [];
    if (cfg?.pulse_excluded_category_ids_json) {
      try {
        const parsed = JSON.parse(cfg.pulse_excluded_category_ids_json);
        if (Array.isArray(parsed)) categoryIds = parsed;
      } catch {
        // Invalid JSON, start fresh
      }
    }

    if (categoryIds.includes(category.id)) {
      return { alreadyExists: true, count: categoryIds.length };
    }

    categoryIds.push(category.id);
    withSql(ctx, "INSERT/UPDATE guild_config pulse_excluded_category_ids_json", () =>
      upsertConfig(interaction.guildId!, { pulse_excluded_category_ids_json: JSON.stringify(categoryIds) })
    );

    logger.info(
      {
        evt: "pulse_category_excluded",
        guildId: interaction.guildId,
        categoryId: category.id,
        categoryName: category.name,
        totalExcluded: categoryIds.length,
      },
      "[config] pulse category excluded"
    );

    return { alreadyExists: false, count: categoryIds.length };
  });

  if (result.alreadyExists) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is already excluded from pulse stats.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Excluded category **${category.name}** from newsletter stats.\n\nTotal excluded: ${result.count}`,
    });
  });
}

export async function executePulseIncludeCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const category = await withStep(ctx, "get_category", async () => {
    return interaction.options.getChannel("category", true);
  });

  const result = await withStep(ctx, "update_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    let categoryIds: string[] = [];
    if (cfg?.pulse_excluded_category_ids_json) {
      try {
        const parsed = JSON.parse(cfg.pulse_excluded_category_ids_json);
        if (Array.isArray(parsed)) categoryIds = parsed;
      } catch {
        // Invalid JSON, nothing to remove
      }
    }

    const idx = categoryIds.indexOf(category.id);
    if (idx === -1) {
      return { notFound: true, count: categoryIds.length };
    }

    categoryIds.splice(idx, 1);
    withSql(ctx, "INSERT/UPDATE guild_config pulse_excluded_category_ids_json", () =>
      upsertConfig(interaction.guildId!, { pulse_excluded_category_ids_json: JSON.stringify(categoryIds) })
    );

    logger.info(
      {
        evt: "pulse_category_included",
        guildId: interaction.guildId,
        categoryId: category.id,
        categoryName: category.name,
        totalExcluded: categoryIds.length,
      },
      "[config] pulse category re-included"
    );

    return { notFound: false, count: categoryIds.length };
  });

  if (result.notFound) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is not in the exclusion list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Re-included category **${category.name}** in newsletter stats.\n\nRemaining excluded: ${result.count}`,
    });
  });
}

export async function executePulseList(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const categoryIds = await withStep(ctx, "get_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    let ids: string[] = [];
    if (cfg?.pulse_excluded_category_ids_json) {
      try {
        const parsed = JSON.parse(cfg.pulse_excluded_category_ids_json);
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        // Invalid JSON
      }
    }
    return ids;
  });

  await withStep(ctx, "reply", async () => {
    const embed = new EmbedBuilder()
      .setTitle("Pulse Newsletter Exclusions")
      .setColor(Colors.Blue)
      .setDescription("Categories excluded from weekly newsletter stats (messages, communicators, voice minutes, top voice channels).");

    const value = categoryIds.length > 0
      ? categoryIds.map(id => `<#${id}>`).join("\n")
      : "*No categories excluded*\n\nUse `/config pulse exclude-category` to exclude staff categories.";
    embed.addFields({ name: `Excluded Categories (${categoryIds.length})`, value, inline: false });

    embed.setFooter({ text: "Use /config pulse exclude-category, include-category, list" });

    await replyOrEdit(interaction, { embeds: [embed] });
  });
}
