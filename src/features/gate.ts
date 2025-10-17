// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
  type GuildTextBasedChannel,
  type Message,
  Collection,
} from "discord.js";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { captureException, addBreadcrumb } from "../lib/sentry.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import { db } from "../db/db.js";
import { ensureReviewMessage } from "./review.js";
import { scanAvatar } from "./avatarScan.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { currentTraceId } from "../lib/cmdWrap.js";

const ANSWER_MAX_LENGTH = 1000;
const INPUT_MAX_LENGTH = 1000;
const LABEL_MAX_LENGTH = 45;
const PLACEHOLDER_MAX_LENGTH = 100;
const GATE_ENTRY_FOOTER = "GateEntry v1";

type GateQuestion = {
  q_index: number;
  prompt: string;
  required: boolean;
};

type QuestionPage = {
  pageIndex: number;
  questions: GateQuestion[];
};

export type EnsureGateEntryResult = {
  created: boolean;
  edited: boolean;
  pinned: boolean;
  channelId?: string;
  messageId?: string;
  reason?: string;
};

function getQuestions(db: BetterSqliteDatabase, guildId: string): GateQuestion[] {
  const rows = db
    .prepare(
      `
      SELECT q_index, prompt, required
      FROM guild_question
      WHERE guild_id = ?
      ORDER BY q_index ASC
    `
    )
    .all(guildId) as Array<{ q_index: number; prompt: string; required: number }>;
  return rows.map((row) => ({
    q_index: row.q_index,
    prompt: row.prompt,
    required: row.required === 1,
  }));
}

function paginate(questions: GateQuestion[], pageSize = 5): QuestionPage[] {
  if (pageSize <= 0) throw new Error("pageSize must be positive");
  const pages: QuestionPage[] = [];
  for (let i = 0; i < questions.length; i += pageSize) {
    const slice = questions.slice(i, i + pageSize);
    pages.push({ pageIndex: pages.length, questions: slice });
  }
  return pages;
}

function buildModalForPage(
  page: QuestionPage,
  draftAnswersMap: Map<number, string>
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:p${page.pageIndex}`)
    .setTitle(`Gate Entry - Page ${page.pageIndex + 1}`);

  const rows = page.questions.map((question) => {
    const label =
      question.prompt.length > LABEL_MAX_LENGTH
        ? `${question.prompt.slice(0, LABEL_MAX_LENGTH - 3)}...`
        : question.prompt || `Question ${question.q_index + 1}`;
    const placeholder =
      question.prompt.length > PLACEHOLDER_MAX_LENGTH
        ? question.prompt.slice(0, PLACEHOLDER_MAX_LENGTH)
        : question.prompt;
    const input = new TextInputBuilder()
      .setCustomId(`v1:q:${question.q_index}`)
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(INPUT_MAX_LENGTH)
      .setRequired(question.required);
    if (placeholder) {
      input.setPlaceholder(placeholder);
    }
    const existing = draftAnswersMap.get(question.q_index);
    if (existing) {
      input.setValue(existing.slice(0, INPUT_MAX_LENGTH));
    }
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  });
  if (rows.length === 0) {
    throw new Error("Cannot build modal without inputs");
  }
  modal.addComponents(...rows);
  return modal;
}

function getOrCreateDraft(db: BetterSqliteDatabase, guildId: string, userId: string) {
  const existing = db
    .prepare(
      `SELECT id FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`
    )
    .get(guildId, userId) as { id: string } | undefined;
  if (existing) return { application_id: existing.id };

  const active = db
    .prepare(
      `SELECT id, status FROM application WHERE guild_id = ? AND user_id = ? AND status IN ('submitted','needs_info')`
    )
    .get(guildId, userId) as { id: string; status: string } | undefined;
  if (active) {
    throw new Error("Active application already submitted");
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO application (id, guild_id, user_id, status)
      VALUES (?, ?, ?, 'draft')
    `
  ).run(id, guildId, userId);
  return { application_id: id };
}

function getDraft(db: BetterSqliteDatabase, appId: string) {
  const app = db
    .prepare(`SELECT id, guild_id, user_id, status FROM application WHERE id = ?`)
    .get(appId) as { id: string; guild_id: string; user_id: string; status: string } | undefined;
  if (!app) return undefined;
  const responses = db
    .prepare(
      `
        SELECT q_index, answer
        FROM application_response
        WHERE app_id = ?
      `
    )
    .all(appId) as Array<{ q_index: number; answer: string }>;
  return { application: app, responses };
}

function upsertAnswer(db: BetterSqliteDatabase, appId: string, q_index: number, value: string) {
  const app = db
    .prepare(`SELECT guild_id FROM application WHERE id = ?`)
    .get(appId) as { guild_id: string } | undefined;
  if (!app) throw new Error("Draft not found");

  const question = db
    .prepare(
      `
        SELECT prompt
        FROM guild_question
        WHERE guild_id = ? AND q_index = ?
      `
    )
    .get(app.guild_id, q_index) as { prompt: string } | undefined;
  if (!question) throw new Error("Question not found");

  const trimmed = value.length > ANSWER_MAX_LENGTH ? value.slice(0, ANSWER_MAX_LENGTH) : value;

  db.prepare(
    `
      INSERT INTO application_response (app_id, q_index, question, answer, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(app_id, q_index) DO UPDATE SET
        question = excluded.question,
        answer = excluded.answer,
        created_at = datetime('now')
    `
  ).run(appId, q_index, question.prompt, trimmed);
}

function submitApplication(db: BetterSqliteDatabase, appId: string) {
  const result = db
    .prepare(
      `
      UPDATE application
      SET status = 'submitted',
          submitted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND status = 'draft'
    `
    )
    .run(appId);
  if (result.changes === 0) {
    throw new Error("No draft to submit");
  }
}

function upsertScan(
  applicationId: string,
  data: {
    avatarUrl: string;
    nsfwScore: number | null;
    skinEdgeScore: number;
    flagged: boolean;
    reason: string;
  }
) {
  db.prepare(
    `
    INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, skin_edge_score, flagged, reason, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(application_id) DO UPDATE SET
      avatar_url = excluded.avatar_url,
      nsfw_score = excluded.nsfw_score,
      skin_edge_score = excluded.skin_edge_score,
      flagged = excluded.flagged,
      reason = excluded.reason,
      scanned_at = datetime('now')
  `
  ).run(
    applicationId,
    data.avatarUrl,
    data.nsfwScore,
    data.skinEdgeScore,
    data.flagged ? 1 : 0,
    data.reason
  );
}

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

type GateEntryPayload = {
  embeds: Array<EmbedBuilder>;
  components: Array<ActionRowBuilder<ButtonBuilder>>;
};

function buildGateEntryPayload(): GateEntryPayload {
  const embed = new EmbedBuilder()
    .setTitle("Gate Entry")
    .setDescription("Press Start to begin or resume your application.")
    .setColor(0x5865f2)
    .setFooter({ text: GATE_ENTRY_FOOTER });

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("v1:start").setLabel("Start").setStyle(ButtonStyle.Primary)
    ),
  ];

  return { embeds: [embed], components };
}

function messageHasStartButton(message: Message) {
  return message.components.some((row) => {
    if (!("components" in row)) return false;
    return row.components?.some(
      (component: any) =>
        component.type === ComponentType.Button && component.customId === "v1:start"
    );
  });
}

function isGateEntryCandidate(message: Message, botId: string | null) {
  if (botId && message.author?.id !== botId) return false;
  return messageHasStartButton(message);
}

async function findExistingGateEntry(
  channel: GuildTextBasedChannel,
  botId: string | null
) {
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const [, pinnedMessage] of pinned as Collection<string, Message>) {
      if (isGateEntryCandidate(pinnedMessage, botId)) return pinnedMessage;
    }
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const [, candidate] of recent as Collection<string, Message>) {
      if (isGateEntryCandidate(candidate, botId)) return candidate;
    }
  }

  return null;
}

function logPhase(ctx: CommandContext, phase: string, extras: Record<string, unknown> = {}) {
  logger.info({
    evt: "gate_entry_step",
    traceId: currentTraceId(ctx),
    phase,
    ...extras,
  });
}

function markSkippedPhase(
  ctx: CommandContext,
  phase: string,
  extras: Record<string, unknown> = {}
) {
  ctx.step(phase);
  logPhase(ctx, phase, { skipped: true, ...extras });
}

export async function ensureGateEntry(
  ctx: CommandContext,
  guildId: string
): Promise<EnsureGateEntryResult> {
  const result: EnsureGateEntryResult = { created: false, edited: false, pinned: false };

  ctx.step("load_config");
  const cfg = getConfig(guildId);
  logPhase(ctx, "load_config", { guildId, hasGateChannel: Boolean(cfg?.gate_channel_id) });
  if (!cfg?.gate_channel_id) {
    markSkippedPhase(ctx, "open_channel", { guildId, reason: "gate channel not configured" });
    markSkippedPhase(ctx, "find_existing", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "gate channel not configured" });
    result.reason = "gate channel not configured";
    return result;
  }

  let channel: GuildTextBasedChannel | null = null;
  ctx.step("open_channel");
  try {
    const fetched = await ctx.interaction.client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!channel) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      reason: "channel unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "channel unavailable" });
    result.reason = "gate channel unavailable";
    return result;
  }

  result.channelId = channel.id;

  const botId = ctx.interaction.client.user?.id ?? null;
  const me =
    channel.guild.members.me ??
    (botId ? await channel.guild.members.fetch(botId).catch(() => null) : null);
  if (!me) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "bot member missing",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "bot member missing" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "bot member missing" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "bot member missing" });
    result.reason = "bot member missing";
    return result;
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "permissions unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "permissions unavailable" });
    result.reason = "unable to resolve permissions";
    return result;
  }

  const hasView = perms.has(PermissionsBitField.Flags.ViewChannel);
  const hasSend = perms.has(PermissionsBitField.Flags.SendMessages);
  const hasManage = perms.has(PermissionsBitField.Flags.ManageMessages);

  logPhase(ctx, "open_channel", {
    guildId,
    channelId: channel.id,
    hasView,
    hasSend,
    hasManageMessages: hasManage,
  });

  if (!hasView) {
    markSkippedPhase(ctx, "find_existing", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "missing ViewChannel" });
    result.reason = "missing ViewChannel";
    return result;
  }

  ctx.step("find_existing");
  const existing = await findExistingGateEntry(channel, botId);
  if (existing) {
    result.messageId = existing.id;
  }
  logPhase(ctx, "find_existing", {
    channelId: channel.id,
    messageId: existing?.id ?? null,
  });

  if (!hasSend) {
    markSkippedPhase(ctx, "send_or_edit", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      reason: `missing SendMessages in #${channel.name}`,
    });
    markSkippedPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      hasManageMessages: hasManage,
      reason: `missing SendMessages in #${channel.name}`,
    });
    result.reason = `missing SendMessages in #${channel.name}`;
    return result;
  }

  const payload = buildGateEntryPayload();
  ctx.step("send_or_edit");
  let message: Message | null = existing ?? null;
  let created = false;
  let edited = false;

  if (message) {
    try {
      await message.edit(payload);
      edited = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 10008) {
        message = null;
      } else {
        throw err;
      }
    }
  }

  if (!message) {
    const sent = await channel.send(payload);
    message = sent;
    created = true;
  }

  result.messageId = message.id;
  result.created = created;
  result.edited = edited;
  logPhase(ctx, "send_or_edit", {
    channelId: channel.id,
    messageId: message.id,
    created,
    edited,
  });

  ctx.step("maybe_pin");
  if (!hasManage) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: false,
      reason: "missing ManageMessages",
    });
    result.reason = "missing ManageMessages";
    return result;
  }

  try {
    if (!message.pinned) {
      await message.pin();
    }
    const pinnedMessages = await channel.messages.fetchPinned();
    const pinnedMatch = pinnedMessages.some((pinnedMessage) => pinnedMessage.id === message.id);
    result.pinned = pinnedMatch;
    if (!pinnedMatch) {
      result.reason = "pin verification failed";
    }
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      pinned: pinnedMatch,
    });
    return result;
  } catch (err) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
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
