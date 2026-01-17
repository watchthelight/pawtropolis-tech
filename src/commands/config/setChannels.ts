/**
 * Pawtropolis Tech -- src/commands/config/setChannels.ts
 * WHAT: Channel-setting handlers for /config set commands.
 * WHY: Groups all channel configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  MessageFlags,
  upsertConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  withStep,
  withSql,
  logger,
  setLoggingChannelId,
  setFlagsChannelId,
} from "./shared.js";

export async function executeSetModmailLogChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetModmailLogChannel
   * WHAT: Sets the modmail log channel in guild config.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config modmail_log_channel_id", () =>
      upsertConfig(interaction.guildId!, { modmail_log_channel_id: channel.id })
    );
    logger.info(
      { evt: "config_set_modmail_log_channel", guildId: interaction.guildId, channelId: channel.id },
      "[config] modmail log channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Modmail log channel set to <#${channel.id}>`,
    });
  });
}

export async function executeSetLogging(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetLogging
   * WHAT: Sets the action logging channel for analytics and audit trail.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE logging_channel", () =>
      setLoggingChannelId(interaction.guildId!, channel.id)
    );
    logger.info(
      { evt: "config_set_logging", guildId: interaction.guildId, channelId: channel.id },
      "[config] logging channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Action logging channel set to <#${channel.id}>\n\nAll moderator actions will now be logged here with pretty embeds.`,
    });
  });
}

export async function executeSetFlagsChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetFlagsChannel
   * WHAT: Sets the flags channel for Silent-Since-Join alerts (PR8).
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  // Validate channel is text-based
  if (!("isTextBased" in channel) || !channel.isTextBased()) {
    await replyOrEdit(interaction, {
      content: "Flags channel must be a text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE flags_channel", () =>
      setFlagsChannelId(interaction.guildId!, channel.id)
    );
    logger.info(
      { evt: "config_set_flags_channel", guildId: interaction.guildId, channelId: channel.id },
      "[config] flags channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Flags channel set to <#${channel.id}>\n\nSilent-Since-Join alerts will now be posted here when accounts exceed the configured threshold.`,
    });
  });
}

export async function executeSetBackfillChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the channel for backfill completion notifications.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config backfill_notification_channel_id", () =>
      upsertConfig(interaction.guildId!, { backfill_notification_channel_id: channel.id })
    );
    logger.info(
      { evt: "config_set_backfill_channel", guildId: interaction.guildId, channelId: channel.id },
      "[config] backfill notification channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Backfill notification channel set to <#${channel.id}>\n\nBackfill completion messages will now be posted here.`,
    });
  });
}

export async function executeSetForumChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config forum_channel_id", () =>
      upsertConfig(interaction.guildId!, { forum_channel_id: channel.id })
    );
    logger.info(
      { evt: "config_set_forum_channel", guildId: interaction.guildId, channelId: channel.id },
      "[config] forum channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Forum channel set to <#${channel.id}>`,
    });
  });
}

export async function executeSetNotificationChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config notification_channel_id", () =>
      upsertConfig(interaction.guildId!, { notification_channel_id: channel.id })
    );
    logger.info(
      { evt: "config_set_notification_channel", guildId: interaction.guildId, channelId: channel.id },
      "[config] notification channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Notification channel set to <#${channel.id}>`,
    });
  });
}

export async function executeSetSupportChannel(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config support_channel_id", () =>
      upsertConfig(interaction.guildId!, { support_channel_id: channel.id })
    );
    logger.info(
      { evt: "config_set_support_channel", guildId: interaction.guildId, channelId: channel.id },
      "[config] support channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Support channel set to <#${channel.id}>`,
    });
  });
}

export async function executeSetReportForum(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeSetReportForum
   * WHAT: Sets the forum channel for ambassador content reports.
   * WHY: Ambassadors report rule violations here; staff resolves them via forum threads.
   */
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const channel = await withStep(ctx, "get_channel", async () => {
    return interaction.options.getChannel("channel", true);
  });

  // Validate channel is a forum
  if (channel.type !== 15) { // ChannelType.GuildForum = 15
    await replyOrEdit(interaction, {
      content: "Report forum must be a Forum channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await withStep(ctx, "persist_channel", async () => {
    withSql(ctx, "INSERT/UPDATE guild_config report_forum_id", () =>
      upsertConfig(interaction.guildId!, { report_forum_id: channel.id })
    );
    logger.info(
      { evt: "config_set_report_forum", guildId: interaction.guildId, channelId: channel.id },
      "[config] report forum channel updated"
    );
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, {
      content: `Report forum set to <#${channel.id}>\n\nAmbassadors can now use \`/report\` to submit content violation reports to this forum.`,
    });
  });
}
