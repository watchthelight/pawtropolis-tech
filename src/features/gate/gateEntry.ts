// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  type GuildTextBasedChannel,
} from "discord.js";
import { captureException, addBreadcrumb } from "../../lib/sentry.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "../../lib/config.js";
import { db } from "../../db/connection.js";
import { buildModalForPage, getQuestions, paginate } from "./pager.js";
import { ensureReviewMessage } from "../review/reviewCard.js";
import { getDraft, getOrCreateDraft, submitApplication, upsertAnswer } from "./repo.js";
import { scanAvatar } from "../avatarScan/scanner.js";
import { upsertScan } from "../avatarScan/repo.js";

function parsePage(customId: string): number {
  const match = customId.match(/^v1:start(?::p(\d+))?/);
  if (match && match[1]) return Number.parseInt(match[1], 10);
  return 0;
}

function parseModalPage(customId: string): number | null {
  const match = customId.match(/^v1:modal:p(\d+)/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function toAnswerMap(responses: Array<{ q_index: number; answer: string }>) {
  return new Map(responses.map((row) => [row.q_index, row.answer] as const));
}

function buildNavRow(pageIndex: number, pageCount: number) {
  const buttons: ButtonBuilder[] = [];
  if (pageCount > 1 && pageIndex > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex - 1}`)
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (pageIndex < pageCount - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (buttons.length === 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex}`)
        .setLabel("Retry")
        .setStyle(ButtonStyle.Primary)
    );
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

function buildFixRow(pageIndex: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex}`)
        .setLabel(`Go to page ${pageIndex + 1}`)
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildDoneRow() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("v1:done").setLabel("Done").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

type EnsureGateResult = { pinned: boolean; reason?: string };

export async function ensurePinnedGateMessage(
  client: Client,
  guildId: string
): Promise<EnsureGateResult> {
  const result: EnsureGateResult = { pinned: false };
  try {
    const cfg = getConfig(guildId);
    if (!cfg?.gate_channel_id) {
      result.reason = "Gate channel not configured";
      return result;
    }
    const channel = (await client.channels
      .fetch(cfg.gate_channel_id)
      .catch((err) => {
        logger.warn({ err, guildId }, "Failed to fetch gate channel");
        return null;
      })) as GuildTextBasedChannel | null;
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      result.reason = "Gate channel unavailable";
      return result;
    }
    const me =
      channel.guild.members.me ??
      (client.user
        ? await channel.guild.members.fetch(client.user.id).catch(() => null)
        : null);
    if (!me) {
      logger.warn({ guildId, channelId: channel.id }, "Bot member missing for gate channel");
      result.reason = "Bot member missing";
      return result;
    }
    const perms = me.permissionsIn(channel);
    const missingBase: string[] = [];
    if (!perms.has(PermissionsBitField.Flags.ViewChannel)) missingBase.push("ViewChannel");
    if (!perms.has(PermissionsBitField.Flags.SendMessages)) missingBase.push("SendMessages");
    if (missingBase.length > 0) {
      logger.warn(
        { guildId, channelId: channel.id, missing: missingBase },
        "Missing base permissions for gate entry message"
      );
      result.reason = `Missing ${missingBase.join(", ")} permission(s)`;
      return result;
    }
    const embed = new EmbedBuilder()
      .setTitle("Gate Entry")
      .setDescription("Press Start to begin or resume your application.")
      .setColor(0x5865f2);
    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("v1:start").setLabel("Start").setStyle(ButtonStyle.Primary)
      ),
    ];

    const pinned = await channel.messages.fetchPinned().catch(() => null);
    const existing = pinned?.find(
      (msg) =>
        msg.author?.id === client.user?.id &&
        msg.embeds.some((e) => e.title?.toLowerCase() === "gate entry")
    );

    if (existing) {
      await existing
        .edit({ embeds: [embed], components })
        .catch((err) => logger.warn({ err, guildId }, "Failed to edit gate entry message"));
      const canPin = perms.has(PermissionsBitField.Flags.ManageMessages);
      if (!canPin) {
        logger.warn(
          { guildId, channelId: channel.id, missing: "ManageMessages" },
          "Cannot pin gate entry message"
        );
        result.reason = "Missing ManageMessages permission; message left unpinned.";
        return result;
      }
      addBreadcrumb({
        message: "Pinning gate entry message",
        category: "gate",
        data: { channelId: channel.id, hasManageMessages: canPin },
        level: "info",
      });
      if (!existing.pinned) {
        try {
          await existing.pin();
          result.pinned = true;
          return result;
        } catch (err) {
          const code = (err as { code?: unknown }).code;
          if (code === 50013) {
            logger.warn(
              { guildId, channelId: channel.id },
              "Failed to pin gate entry message due to missing permissions"
            );
            result.reason = "ManageMessages denied; message left unpinned.";
            return result;
          }
          captureException(err, { guildId, channelId: channel.id, area: "ensurePinnedGateMessage" });
          logger.warn({ err, guildId }, "Failed to pin existing gate entry message");
          result.reason = "Pin failed";
          return result;
        }
      }
      result.pinned = true;
      return result;
    }

    const message = await channel
      .send({ embeds: [embed], components })
      .catch((err) => {
        logger.warn({ err, guildId }, "Failed to send gate entry message");
        return null;
      });
    if (!message) {
      result.reason = "Failed to send gate entry message";
      return result;
    }
    const canPin = perms.has(PermissionsBitField.Flags.ManageMessages);
    if (!canPin) {
      logger.warn(
        { guildId, channelId: channel.id, missing: "ManageMessages" },
        "Cannot pin gate entry message"
      );
      result.reason = "Missing ManageMessages permission; message left unpinned.";
      return result;
    }
    addBreadcrumb({
      message: "Pinning gate entry message",
      category: "gate",
      data: { channelId: channel.id, hasManageMessages: canPin },
      level: "info",
    });
    try {
      if (!message.pinned) {
        await message.pin();
      }
      result.pinned = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 50013) {
        logger.warn(
          { guildId, channelId: channel.id },
          "Failed to pin gate entry message due to missing permissions"
        );
        result.reason = "ManageMessages denied; message left unpinned.";
        return result;
      }
      captureException(err, { guildId, channelId: channel.id, area: "ensurePinnedGateMessage" });
      logger.warn({ err, guildId }, "Failed to pin gate entry message");
      result.reason = "Pin failed";
    }
    return result;
  } catch (err) {
    captureException(err, { guildId, area: "ensurePinnedGateMessage" });
    result.reason = "Unexpected error";
    return result;
  }
}

export async function handleStartButton(interaction: ButtonInteraction) {
  try {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ ephemeral: true, content: "Guild only." });
      return;
    }
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const questions = getQuestions(db, guildId);
    if (questions.length === 0) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ephemeral: true, content: "No questions configured." });
      }
      return;
    }
    const pages = paginate(questions);
    const requestedPage = parsePage(interaction.customId);
    const page = pages[requestedPage];
    if (!page) {
      await interaction.reply({
        ephemeral: true,
        content: "That page is unavailable. Start over.",
      });
      return;
    }
    let draft;
    try {
      draft = getOrCreateDraft(db, guildId, userId);
    } catch (err) {
      if (err instanceof Error && err.message === "Active application already submitted") {
        await interaction.reply({
          ephemeral: true,
          content: "You already have a submitted application.",
        });
        return;
      }
      throw err;
    }
    const draftData = getDraft(db, draft.application_id);
    const answerMap = draftData ? toAnswerMap(draftData.responses) : new Map();
    const modal = buildModalForPage(page, answerMap);

    addBreadcrumb({
      message: "Gate entry modal opened",
      category: "gate",
      data: { guildId, userId, pageIndex: page.pageIndex },
      level: "info",
    });

    await interaction.showModal(modal);
  } catch (err) {
    captureException(err, {
      guildId: interaction.guildId ?? "unknown",
      userId: interaction.user.id,
      area: "handleStartButton",
    });
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ ephemeral: true, content: "Something broke. Try again." })
        .catch(() => undefined);
    }
  }
}

export async function handleGateModalSubmit(interaction: ModalSubmitInteraction) {
  try {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ ephemeral: true, content: "Guild only." });
      return;
    }
    const pageIndex = parseModalPage(interaction.customId);
    if (pageIndex === null) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    const questions = getQuestions(db, guildId);
    if (questions.length === 0) {
      await interaction.reply({ ephemeral: true, content: "No questions configured." });
      return;
    }
    const pages = paginate(questions);
    const page = pages[pageIndex];
    if (!page) {
      await interaction.reply({
        ephemeral: true,
        content: "This page is out of date. Press Start to reload.",
      });
      return;
    }

    const draftRow = db
      .prepare(
        `SELECT id FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`
      )
      .get(guildId, userId) as { id: string } | undefined;

    if (!draftRow) {
      await interaction.reply({
        ephemeral: true,
        content: "No active draft found. Press Start to begin again.",
      });
      return;
    }

    const answersOnPage = page.questions.map((question) => {
      const raw = interaction.fields.getTextInputValue(`v1:q:${question.q_index}`) ?? "";
      const value = raw.slice(0, 1000);
      return { question, value };
    });

    const missing = answersOnPage.filter(
      ({ question, value }) => question.required && value.trim().length === 0
    );
    if (missing.length > 0) {
      const list = missing.map(({ question }) => question.q_index + 1).join(", ");
      await interaction.reply({
        ephemeral: true,
        content: `Fill required question(s): ${list}.`,
        components: buildNavRow(pageIndex, pages.length),
      });
      return;
    }

    const save = db.transaction((rows: typeof answersOnPage) => {
      for (const row of rows) {
        upsertAnswer(db, draftRow.id, row.question.q_index, row.value);
      }
    });
    save(answersOnPage);

    const hasNext = pageIndex < pages.length - 1;

    if (hasNext) {
      await interaction.reply({
        ephemeral: true,
        content: `Saved page ${pageIndex + 1}.`,
        components: buildNavRow(pageIndex, pages.length),
      });
      return;
    }

    const draftData = getDraft(db, draftRow.id);
    const answerMap = draftData ? toAnswerMap(draftData.responses) : new Map<number, string>();
    const missingRequired = questions.filter((q) => q.required && !answerMap.get(q.q_index)?.trim());
    if (missingRequired.length > 0) {
      const list = missingRequired.map((q) => q.q_index + 1).join(", ");
      const firstMissing = missingRequired[0];
      const targetPage = pages.find((p) => p.questions.some((q) => q.q_index === firstMissing.q_index));
      const targetIndex = targetPage?.pageIndex ?? 0;
      await interaction.reply({
        ephemeral: true,
        content: `Required question(s) missing: ${list}.`,
        components: buildFixRow(targetIndex),
      });
      return;
    }

    addBreadcrumb({
      message: "Submitting gate application",
      category: "gate",
      data: { guildId, userId, appId: draftRow.id },
      level: "info",
    });

    submitApplication(db, draftRow.id);
    const cfg = getConfig(guildId);
    if (cfg?.avatar_scan_enabled) {
      const avatarUrl = interaction.user.displayAvatarURL({
        extension: "png",
        forceStatic: true,
        size: 512,
      });
      if (avatarUrl) {
        try {
          const result = await scanAvatar(avatarUrl, {
            nsfwThreshold: cfg.avatar_scan_nsfw_threshold ?? 0.6,
            skinEdgeThreshold: cfg.avatar_scan_skin_edge_threshold ?? 0.18,
          });
          upsertScan(draftRow.id, {
            avatarUrl,
            nsfwScore: result.nsfw_score,
            skinEdgeScore: result.skin_edge_score,
            flagged: result.flagged,
            reason: result.reason,
          });
        } catch (scanErr) {
          logger.warn({ err: scanErr, appId: draftRow.id }, "Avatar scan failed");
        }
      }
    }
    try {
      await ensureReviewMessage(interaction.client, draftRow.id);
    } catch (err) {
      logger.warn({ err, appId: draftRow.id }, "Failed to ensure review card after submission");
    }

    await interaction.reply({ ephemeral: true, content: "Application submitted", components: buildDoneRow() });
  } catch (err) {
    captureException(err, {
      guildId: interaction.guildId ?? "unknown",
      userId: interaction.user.id,
      area: "handleGateModalSubmit",
    });
    if (interaction.replied || interaction.deferred) {
      await interaction
        .followUp({ ephemeral: true, content: "Something broke. Try again." })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({ ephemeral: true, content: "Something broke. Try again." })
        .catch(() => undefined);
    }
  }
}

export async function handleDoneButton(interaction: ButtonInteraction) {
  try {
    await interaction.update({ components: [] });
  } catch (err) {
    captureException(err, { area: "handleDoneButton" });
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => undefined);
    }
  }
}
