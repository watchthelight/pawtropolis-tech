/**
 * Pawtropolis Tech -- src/commands/config/poke.ts
 * WHAT: Poke command configuration handlers.
 * WHY: Groups all poke system configuration handlers together.
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

export async function executePokeAddCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Adds a category to the poke target list.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const category = await withStep(ctx, "get_category", async () => {
    return interaction.options.getChannel("category", true);
  });

  // Validate it's actually a category channel
  if (category.type !== ChannelType.GuildCategory) {
    await replyOrEdit(interaction, {
      content: `Channel <#${category.id}> is not a category. Please select a category channel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await withStep(ctx, "update_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    // Parse existing category IDs or start fresh
    let categoryIds: string[] = [];
    if (cfg?.poke_category_ids_json) {
      try {
        const parsed = JSON.parse(cfg.poke_category_ids_json);
        if (Array.isArray(parsed)) {
          categoryIds = parsed;
        }
      } catch {
        // Invalid JSON, start fresh
      }
    }

    // Check if already exists
    if (categoryIds.includes(category.id)) {
      return { alreadyExists: true, count: categoryIds.length };
    }

    // Add and save
    categoryIds.push(category.id);
    withSql(ctx, "INSERT/UPDATE guild_config poke_category_ids_json", () =>
      upsertConfig(interaction.guildId!, { poke_category_ids_json: JSON.stringify(categoryIds) })
    );

    logger.info(
      {
        evt: "poke_category_added",
        guildId: interaction.guildId,
        categoryId: category.id,
        categoryName: category.name,
        totalCategories: categoryIds.length,
      },
      "[config] poke category added"
    );

    return { alreadyExists: false, count: categoryIds.length };
  });

  if (result.alreadyExists) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is already in the poke target list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Added category **${category.name}** to poke targets.\n\nTotal categories: ${result.count}`,
    });
  });
}

export async function executePokeRemoveCategory(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Removes a category from the poke target list.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const category = await withStep(ctx, "get_category", async () => {
    return interaction.options.getChannel("category", true);
  });

  const result = await withStep(ctx, "update_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    // Parse existing category IDs
    let categoryIds: string[] = [];
    if (cfg?.poke_category_ids_json) {
      try {
        const parsed = JSON.parse(cfg.poke_category_ids_json);
        if (Array.isArray(parsed)) {
          categoryIds = parsed;
        }
      } catch {
        // Invalid JSON, nothing to remove
      }
    }

    // Check if exists
    const idx = categoryIds.indexOf(category.id);
    if (idx === -1) {
      return { notFound: true, count: categoryIds.length };
    }

    // Remove and save
    categoryIds.splice(idx, 1);
    withSql(ctx, "INSERT/UPDATE guild_config poke_category_ids_json", () =>
      upsertConfig(interaction.guildId!, { poke_category_ids_json: JSON.stringify(categoryIds) })
    );

    logger.info(
      {
        evt: "poke_category_removed",
        guildId: interaction.guildId,
        categoryId: category.id,
        categoryName: category.name,
        totalCategories: categoryIds.length,
      },
      "[config] poke category removed"
    );

    return { notFound: false, count: categoryIds.length };
  });

  if (result.notFound) {
    await replyOrEdit(interaction, {
      content: `Category <#${category.id}> is not in the poke target list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Removed category **${category.name}** from poke targets.\n\nRemaining categories: ${result.count}`,
    });
  });
}

export async function executePokeExcludeChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Adds a channel to the poke exclusion list.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  const result = await withStep(ctx, "update_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    // Parse existing excluded channel IDs or start fresh
    let excludedIds: string[] = [];
    if (cfg?.poke_excluded_channel_ids_json) {
      try {
        const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
        if (Array.isArray(parsed)) {
          excludedIds = parsed;
        }
      } catch {
        // Invalid JSON, start fresh
      }
    }

    // Check if already excluded
    if (excludedIds.includes(channel.id)) {
      return { alreadyExcluded: true, count: excludedIds.length };
    }

    // Add and save
    excludedIds.push(channel.id);
    withSql(ctx, "INSERT/UPDATE guild_config poke_excluded_channel_ids_json", () =>
      upsertConfig(interaction.guildId!, { poke_excluded_channel_ids_json: JSON.stringify(excludedIds) })
    );

    logger.info(
      {
        evt: "poke_channel_excluded",
        guildId: interaction.guildId,
        channelId: channel.id,
        channelName: channel.name,
        totalExcluded: excludedIds.length,
      },
      "[config] poke channel excluded"
    );

    return { alreadyExcluded: false, count: excludedIds.length };
  });

  if (result.alreadyExcluded) {
    await replyOrEdit(interaction, {
      content: `Channel <#${channel.id}> is already excluded from pokes.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Excluded channel **${channel.name}** from poke messages.\n\nTotal excluded: ${result.count}`,
    });
  });
}

export async function executePokeIncludeChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Removes a channel from the poke exclusion list.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  const result = await withStep(ctx, "update_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    // Parse existing excluded channel IDs
    let excludedIds: string[] = [];
    if (cfg?.poke_excluded_channel_ids_json) {
      try {
        const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
        if (Array.isArray(parsed)) {
          excludedIds = parsed;
        }
      } catch {
        // Invalid JSON, nothing to remove
      }
    }

    // Check if exists
    const idx = excludedIds.indexOf(channel.id);
    if (idx === -1) {
      return { notFound: true, count: excludedIds.length };
    }

    // Remove and save
    excludedIds.splice(idx, 1);
    withSql(ctx, "INSERT/UPDATE guild_config poke_excluded_channel_ids_json", () =>
      upsertConfig(interaction.guildId!, { poke_excluded_channel_ids_json: JSON.stringify(excludedIds) })
    );

    logger.info(
      {
        evt: "poke_channel_included",
        guildId: interaction.guildId,
        channelId: channel.id,
        channelName: channel.name,
        totalExcluded: excludedIds.length,
      },
      "[config] poke channel re-included"
    );

    return { notFound: false, count: excludedIds.length };
  });

  if (result.notFound) {
    await replyOrEdit(interaction, {
      content: `Channel <#${channel.id}> is not in the exclusion list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Re-included channel **${channel.name}** (removed from exclusion list).\n\nRemaining excluded: ${result.count}`,
    });
  });
}

export async function executePokeList(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Lists current poke configuration (categories + excluded channels).
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const { categoryIds, excludedIds } = await withStep(ctx, "get_config", async () => {
    const cfg = withSql(ctx, "SELECT guild_config", () => getConfig(interaction.guildId!));

    // Parse category IDs
    let categories: string[] = [];
    if (cfg?.poke_category_ids_json) {
      try {
        const parsed = JSON.parse(cfg.poke_category_ids_json);
        if (Array.isArray(parsed)) {
          categories = parsed;
        }
      } catch {
        // Invalid JSON
      }
    }

    // Parse excluded channel IDs
    let excluded: string[] = [];
    if (cfg?.poke_excluded_channel_ids_json) {
      try {
        const parsed = JSON.parse(cfg.poke_excluded_channel_ids_json);
        if (Array.isArray(parsed)) {
          excluded = parsed;
        }
      } catch {
        // Invalid JSON
      }
    }

    return { categoryIds: categories, excludedIds: excluded };
  });

  await withStep(ctx, "reply", async () => {
    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("Poke Configuration")
      .setColor(Colors.Blue)
      .setDescription("Categories and channels configured for the `/poke` command.");

    // Categories field
    const categoryValue = categoryIds.length > 0
      ? categoryIds.map(id => `<#${id}>`).join("\n")
      : "*No categories configured*\n\nUse `/config poke add-category` to add target categories.";
    embed.addFields({ name: `Target Categories (${categoryIds.length})`, value: categoryValue, inline: false });

    // Excluded channels field
    const excludedValue = excludedIds.length > 0
      ? excludedIds.map(id => `<#${id}>`).join("\n")
      : "*No channels excluded*";
    embed.addFields({ name: `Excluded Channels (${excludedIds.length})`, value: excludedValue, inline: false });

    // Usage hint
    embed.setFooter({ text: "Use /config poke add-category, remove-category, exclude-channel, include-channel" });

    await replyOrEdit(interaction, { embeds: [embed] });
  });
}
