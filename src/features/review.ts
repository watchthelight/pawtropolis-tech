// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type Message,
  type TextChannel,
  type ThreadAutoArchiveDuration,
  type ThreadChannel,
  type User,
} from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/sentry.js";
import { getConfig, hasManageGuild, isReviewer } from "../lib/config.js";
import { buildReverseImageUrl, getScan } from "./avatarScan.js";
import type { GuildConfig } from "../lib/config.js";

type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";

type ApplicationRow = {
  id: string;
  guild_id: string;
  user_id: string;
  status: ApplicationStatus;
};

type ReviewAnswer = {
  q_index: number;
  question: string;
  answer: string;
};

type ReviewActionMeta = {
  dmDelivered?: boolean;
  dmError?: string;
  threadId?: string;
  threadUrl?: string;
  threadError?: string;
  roleApplied?: boolean;
  kickSucceeded?: boolean;
  kickError?: string;
} | null;

type ReviewActionSnapshot = {
  action: "approve" | "reject" | "need_info" | "kick";
  moderator_id: string;
  moderatorTag?: string;
  reason?: string | null;
  created_at: string;
  meta: ReviewActionMeta;
};

type ReviewCardApplication = {
  id: string;
  guild_id: string;
  user_id: string;
  status: ApplicationStatus;
  created_at: string;
  submitted_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  resolver_id: string | null;
  resolution_reason: string | null;
  userTag: string;
  avatarUrl?: string | null;
  lastAction?: ReviewActionSnapshot | null;
};

type AvatarScanRow = {
  application_id: string;
  avatar_url: string;
  nsfw_score: number | null;
  skin_edge_score: number | null;
  flagged: number;
  reason: string;
  scanned_at: string;
};

type ReviewCardRow = {
  channel_id: string;
  message_id: string;
};

type TxResult =
  | { kind: "changed"; reviewActionId: number }
  | { kind: "already"; status: string }
  | { kind: "terminal"; status: string }
  | { kind: "invalid"; status: string };

const BUTTON_RE = /^v1:decide:(approve|reject|needinfo|kick):app(.+)$/;
const MODAL_RE = /^v1:modal:reject:app(.+)$/;
const VIEW_SRC_BUTTON_RE = /^v1:avatar:viewsrc:app(.+)$/;
const VIEW_SRC_MODAL_RE = /^v1:avatar:confirm18:app(.+)$/;

function isStaff(guildId: string, member: GuildMember | null) {
  return hasManageGuild(member) || isReviewer(guildId, member);
}

function loadApplication(appId: string): ApplicationRow | undefined {
  return db
    .prepare(
      `
    SELECT id, guild_id, user_id, status
    FROM application
    WHERE id = ?
  `
    )
    .get(appId) as ApplicationRow | undefined;
}

function requireInteractionStaff(interaction: ButtonInteraction | ModalSubmitInteraction) {
  if (!interaction.inGuild() || !interaction.guildId) {
    interaction
      .reply({ ephemeral: true, content: "Guild only." })
      .catch(() => undefined);
    return false;
  }
  const member = interaction.member as GuildMember | null;
  if (!isStaff(interaction.guildId, member)) {
    interaction
      .reply({ ephemeral: true, content: "You do not have permission for this." })
      .catch(() => undefined);
    return false;
  }
  return true;
}

function updateReviewActionMeta(id: number, meta: unknown) {
  db.prepare(`UPDATE review_action SET meta = json(?) WHERE id = ?`).run(JSON.stringify(meta), id);
}

function buildThreadLink(guildId: string, channelId: string, threadId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}/${threadId}`;
}

function approveTx(appId: string, moderatorId: string): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "approved") return { kind: "already" as const, status: row.status };
    if (row.status === "rejected" || row.status === "kicked") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status !== "submitted" && row.status !== "needs_info") {
      return { kind: "invalid" as const, status: row.status };
    }
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, reason, meta)
        VALUES (?, ?, 'approve', NULL, NULL)
      `
      )
      .run(appId, moderatorId);
    db.prepare(
      `
      UPDATE application
      SET status = 'approved',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = NULL
      WHERE id = ?
    `
    ).run(moderatorId, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

function rejectTx(appId: string, moderatorId: string, reason: string): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "rejected") return { kind: "already" as const, status: row.status };
    if (row.status === "approved" || row.status === "kicked") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid" as const, status: row.status };
    }
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, reason, meta)
        VALUES (?, ?, 'reject', ?, NULL)
      `
      )
      .run(appId, moderatorId, reason);
    db.prepare(
      `
      UPDATE application
      SET status = 'rejected',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = ?
      WHERE id = ?
    `
    ).run(moderatorId, reason, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

function needInfoTx(appId: string, moderatorId: string): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "needs_info") return { kind: "already" as const, status: row.status };
    if (row.status === "approved" || row.status === "rejected" || row.status === "kicked") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status !== "submitted") {
      return { kind: "invalid" as const, status: row.status };
    }
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, reason, meta)
        VALUES (?, ?, 'need_info', NULL, NULL)
      `
      )
      .run(appId, moderatorId);
    db.prepare(
      `
      UPDATE application
      SET status = 'needs_info',
          updated_at = datetime('now'),
          resolver_id = NULL,
          resolution_reason = NULL,
          resolved_at = NULL
      WHERE id = ?
    `
    ).run(appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

function kickTx(appId: string, moderatorId: string, reason: string | null): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "kicked") return { kind: "already" as const, status: row.status };
    if (row.status === "approved" || row.status === "rejected") {
      return { kind: "terminal" as const, status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid" as const, status: row.status };
    }
    const insert = db
      .prepare(
        `
        INSERT INTO review_action (app_id, moderator_id, action, reason, meta)
        VALUES (?, ?, 'kick', ?, NULL)
      `
      )
      .run(appId, moderatorId, reason);
    db.prepare(
      `
      UPDATE application
      SET status = 'kicked',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = ?
      WHERE id = ?
    `
    ).run(moderatorId, reason, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

async function approveFlow(guild: Guild, memberId: string, cfg: GuildConfig) {
  const result = { roleApplied: false, dmDelivered: false };
  let member: GuildMember | null = null;
  try {
    member = await guild.members.fetch(memberId);
  } catch (err) {
    logger.warn({ err, guildId: guild.id, memberId }, "Failed to fetch member for approval");
    captureException(err, { area: "approveFlow:fetchMember", guildId: guild.id, userId: memberId });
    return result;
  }

  const roleId = cfg.accepted_role_id;
  if (roleId) {
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (role) {
      if (!member.roles.cache.has(role.id)) {
        try {
          await member.roles.add(role, "Gate approval");
          result.roleApplied = true;
        } catch (err) {
          logger.warn({ err, guildId: guild.id, memberId, roleId }, "Failed to grant approval role");
          captureException(err, {
            area: "approveFlow:grantRole",
            guildId: guild.id,
            userId: memberId,
            roleId,
          });
        }
      } else {
        result.roleApplied = true;
      }
    }
  }

  try {
    await member.send({ content: `Hi — welcome to ${guild.name}! Your application has been approved.` });
    result.dmDelivered = true;
  } catch (err) {
    logger.warn({ err, userId: memberId }, "Failed to DM applicant after approval");
  }

  return result;
}

async function rejectFlow(user: User, options: { guildName: string; reason: string }) {
  const result = { dmDelivered: false };
  const lines = [
    `Hi — thanks for applying to ${options.guildName}. We're not able to approve this application.`,
    `Reason: ${options.reason}.`,
  ];
  try {
    await user.send({ content: lines.join("\n") });
    result.dmDelivered = true;
  } catch (err) {
    logger.warn({ err, userId: user.id }, "Failed to DM applicant about rejection");
  }
  return result;
}

async function needInfoFlow(guild: Guild, memberId: string, options: { appId: string; reviewChannel: TextChannel }) {
  const existing = db
    .prepare(
      `
    SELECT thread_id
    FROM modmail_bridge
    WHERE guild_id = ? AND user_id = ? AND state = 'open'
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get(guild.id, memberId) as { thread_id: string } | undefined;
  if (existing) {
    return { threadId: existing.thread_id, created: false };
  }

  let thread: ThreadChannel | null = null;
  try {
    thread = await options.reviewChannel.threads.create({
      name: `need-info-${options.appId}`,
      autoArchiveDuration: 1440 as ThreadAutoArchiveDuration,
      reason: `Need info requested for application ${options.appId}`,
    });
  } catch (err) {
    logger.warn(
      { err, channelId: options.reviewChannel.id, guildId: guild.id },
      "Failed to create need-info thread"
    );
    captureException(err, {
      area: "needInfoFlow:createThread",
      guildId: guild.id,
      channelId: options.reviewChannel.id,
      userId: memberId,
    });
    throw err;
  }

  db.prepare(
    `
    INSERT INTO modmail_bridge (guild_id, user_id, thread_id, state)
    VALUES (?, ?, ?, 'open')
  `
  ).run(guild.id, memberId, thread.id);

  return { threadId: thread.id, created: true };
}

async function kickFlow(guild: Guild, memberId: string, reason?: string | null) {
  const result = { dmDelivered: false, kickSucceeded: false, error: undefined as string | undefined };
  let member: GuildMember | null = null;
  try {
    member = await guild.members.fetch(memberId);
  } catch (err) {
    logger.warn({ err, guildId: guild.id, memberId }, "Failed to fetch member for kick");
    captureException(err, { area: "kickFlow:fetchMember", guildId: guild.id, userId: memberId });
    return result;
  }

  const dmLines = [
    `Hi — your application with ${guild.name} was reviewed and we need to remove you from the server.`,
    reason ? `Reason: ${reason}.` : null,
  ].filter(Boolean);

  try {
    await member.send({ content: dmLines.join("\n") });
    result.dmDelivered = true;
  } catch (err) {
    logger.warn({ err, userId: memberId }, "Failed to DM applicant before kick");
  }

  try {
    await member.kick(reason ?? undefined);
    result.kickSucceeded = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    result.error = message;
    logger.warn({ err, guildId: guild.id, memberId }, "Failed to kick member");
    captureException(err, { area: "kickFlow:kick", guildId: guild.id, userId: memberId });
  }

  return result;
}

async function handleApprove(interaction: ButtonInteraction, app: ApplicationRow) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await interaction.reply({ ephemeral: true, content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const result = approveTx(app.id, interaction.user.id);
  if (result.kind === "already") {
    await interaction.reply({ ephemeral: true, content: "Already approved." }).catch(() => undefined);
    return;
  }
  if (result.kind === "terminal") {
    await interaction
      .reply({ ephemeral: true, content: `Already resolved (${result.status}).` })
      .catch(() => undefined);
    return;
  }
  if (result.kind === "invalid") {
    await interaction.reply({ ephemeral: true, content: "Application is not ready for approval." }).catch(() => undefined);
    return;
  }

  const cfg = getConfig(guild.id);
  const flow = cfg
    ? await approveFlow(guild, app.user_id, cfg)
    : { roleApplied: false, dmDelivered: false };
  updateReviewActionMeta(result.reviewActionId, flow);

  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after approval");
    captureException(err, { area: "approve:ensureReviewMessage", appId: app.id });
  }

  await interaction.reply({ ephemeral: true, content: "Application approved." }).catch(() => undefined);
}

async function handleReject(interaction: ButtonInteraction, app: ApplicationRow) {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:reject:app${app.id}`)
    .setTitle("Reject application");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:reject:reason")
    .setLabel("Reason (max 500 chars)")
    .setRequired(true)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await interaction.reply({ ephemeral: true, content: "This application is already resolved." }).catch(() => undefined);
    return;
  }

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId: app.id }, "Failed to show reject modal");
  });
}

async function handleNeedInfo(interaction: ButtonInteraction, app: ApplicationRow) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await interaction.reply({ ephemeral: true, content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const cfg = getConfig(guild.id);
  if (!cfg?.review_channel_id) {
    await interaction.reply({ ephemeral: true, content: "Review channel not configured." }).catch(() => undefined);
    return;
  }
  const reviewChannel = (await guild.channels
    .fetch(cfg.review_channel_id)
    .catch(() => null)) as TextChannel | null;
  if (!reviewChannel) {
    await interaction.reply({ ephemeral: true, content: "Review channel unavailable." }).catch(() => undefined);
    return;
  }

  const tx = needInfoTx(app.id, interaction.user.id);
  if (tx.kind === "terminal") {
    await interaction
      .reply({ ephemeral: true, content: `Already resolved (${tx.status}).` })
      .catch(() => undefined);
    return;
  }
  if (tx.kind === "invalid") {
    await interaction.reply({ ephemeral: true, content: "Application not submitted yet." }).catch(() => undefined);
    return;
  }

  let flow;
  try {
    flow = await needInfoFlow(guild, app.user_id, {
      appId: app.id,
      reviewChannel,
    });
  } catch (err) {
    if (tx.kind === "changed") {
      updateReviewActionMeta(tx.reviewActionId, { threadError: "create_failed" });
    }
    logger.warn({ err, appId: app.id }, "Need info thread creation failed");
    captureException(err, { area: "needInfo:createThread", appId: app.id });
    try {
      await ensureReviewMessage(interaction.client, app.id);
    } catch (refreshErr) {
      captureException(refreshErr, { area: "needInfo:ensureReviewMessage", appId: app.id });
    }
    await interaction
      .reply({
        ephemeral: true,
        content: "Failed to open a need-info thread. Check permissions and try again.",
      })
      .catch(() => undefined);
    return;
  }

  const threadUrl = buildThreadLink(guild.id, reviewChannel.id, flow.threadId);

  if (tx.kind === "changed") {
    updateReviewActionMeta(tx.reviewActionId, { threadId: flow.threadId, threadUrl });
  }

  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after need info");
    captureException(err, { area: "needInfo:ensureReviewMessage", appId: app.id });
  }

  await interaction
    .reply({
      ephemeral: true,
      content: flow.created
        ? `Need info thread started: <#${flow.threadId}>`
        : `Need info thread already open: <#${flow.threadId}>`,
    })
    .catch(() => undefined);
}

async function handleKick(interaction: ButtonInteraction, app: ApplicationRow) {
  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await interaction.reply({ ephemeral: true, content: "Guild not found." }).catch(() => undefined);
    return;
  }
  const tx = kickTx(app.id, interaction.user.id, null);
  if (tx.kind === "already") {
    await interaction.reply({ ephemeral: true, content: "Already kicked." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await interaction
      .reply({ ephemeral: true, content: `Already resolved (${tx.status}).` })
      .catch(() => undefined);
    return;
  }
  if (tx.kind === "invalid") {
    await interaction.reply({ ephemeral: true, content: "Application not in a kickable state." }).catch(() => undefined);
    return;
  }

  const flow = await kickFlow(guild, app.user_id, null);
  updateReviewActionMeta(tx.reviewActionId, flow);

  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after kick");
    captureException(err, { area: "kick:ensureReviewMessage", appId: app.id });
  }

  const message = flow.kickSucceeded
    ? "Member kicked."
    : "Kick attempted; check logs for details.";

  await interaction.reply({ ephemeral: true, content: message }).catch(() => undefined);
}

export async function handleReviewButton(interaction: ButtonInteraction) {
  const match = BUTTON_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const [, action, appId] = match;
  const app = loadApplication(appId);
  if (!app) {
    await interaction.reply({ ephemeral: true, content: "Application not found." }).catch(() => undefined);
    return;
  }
  if (interaction.guildId && app.guild_id !== interaction.guildId) {
    await interaction.reply({ ephemeral: true, content: "Guild mismatch for application." }).catch(() => undefined);
    return;
  }

  try {
    if (action === "approve") {
      await handleApprove(interaction, app);
    } else if (action === "reject") {
      await handleReject(interaction, app);
    } else if (action === "needinfo") {
      await handleNeedInfo(interaction, app);
    } else if (action === "kick") {
      await handleKick(interaction, app);
    }
  } catch (err) {
    logger.error({ err, action, appId }, "Review button handling failed");
    captureException(err, { area: "handleReviewButton", action, appId });
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ ephemeral: true, content: "Failed to process action." })
        .catch(() => undefined);
    }
  }
}

export async function handleRejectModal(interaction: ModalSubmitInteraction) {
  const match = MODAL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const appId = match[1];
  const app = loadApplication(appId);
  if (!app) {
    await interaction.reply({ ephemeral: true, content: "This application is already resolved." }).catch(() => undefined);
    return;
  }
  if (interaction.guildId && app.guild_id !== interaction.guildId) {
    await interaction
      .reply({ ephemeral: true, content: "Guild mismatch for application." })
      .catch(() => undefined);
    return;
  }

  const reasonRaw = interaction.fields.getTextInputValue("v1:modal:reject:reason") ?? "";
  const reason = reasonRaw.trim().slice(0, 500);
  if (reason.length === 0) {
    await interaction
      .reply({ ephemeral: true, content: "Reason is required." })
      .catch(() => undefined);
    return;
  }

  const guild = interaction.guild as Guild | null;
  if (!guild) {
    await interaction.reply({ ephemeral: true, content: "Guild not found." }).catch(() => undefined);
    return;
  }

  const tx = rejectTx(app.id, interaction.user.id, reason);
  if (tx.kind === "already") {
    await interaction.reply({ ephemeral: true, content: "Already rejected." }).catch(() => undefined);
    return;
  }
  if (tx.kind === "terminal") {
    await interaction
      .reply({ ephemeral: true, content: `Already resolved (${tx.status}).` })
      .catch(() => undefined);
    return;
  }
  if (tx.kind === "invalid") {
    await interaction.reply({ ephemeral: true, content: "Application not submitted yet." }).catch(() => undefined);
    return;
  }

  const user = await interaction.client.users.fetch(app.user_id).catch(() => null);
  let dmDelivered = false;
  if (user) {
    const dmResult = await rejectFlow(user, { guildName: guild.name, reason });
    dmDelivered = dmResult.dmDelivered;
    updateReviewActionMeta(tx.reviewActionId, dmResult);
  } else {
    logger.warn({ userId: app.user_id }, "Failed to fetch user for rejection DM");
    updateReviewActionMeta(tx.reviewActionId, { dmDelivered });
  }

  try {
    await ensureReviewMessage(interaction.client, app.id);
  } catch (err) {
    logger.warn({ err, appId: app.id }, "Failed to refresh review card after rejection");
    captureException(err, { area: "reject:ensureReviewMessage", appId: app.id });
  }

  await interaction
    .reply({
      ephemeral: true,
      content: dmDelivered ? "Application rejected." : "Application rejected. DM failed.",
    })
    .catch(() => undefined);
}

export async function handleAvatarViewSourceButton(interaction: ButtonInteraction) {
  const match = VIEW_SRC_BUTTON_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const appId = match[1];
  const app = loadApplication(appId);
  if (!app) {
    await interaction.reply({ ephemeral: true, content: "Application not found." }).catch(() => undefined);
    return;
  }
  if (interaction.guildId && app.guild_id !== interaction.guildId) {
    await interaction.reply({ ephemeral: true, content: "Guild mismatch for application." }).catch(() => undefined);
    return;
  }

  const scan = getScan(appId);
  if (!scan || !scan.flagged) {
    await interaction.reply({ ephemeral: true, content: "Avatar scan not available." }).catch(() => undefined);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`v1:avatar:confirm18:app${appId}`)
    .setTitle("Confirm 18+");
  const input = new TextInputBuilder()
    .setCustomId("v1:avatar:confirm18:text")
    .setLabel("Type I AM 18+")
    .setPlaceholder("I AM 18+")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(row);

  await interaction.showModal(modal).catch((err) => {
    logger.warn({ err, appId }, "Failed to show avatar view source modal");
  });
}

export async function handleAvatarConfirmModal(interaction: ModalSubmitInteraction) {
  const match = VIEW_SRC_MODAL_RE.exec(interaction.customId);
  if (!match) return;
  if (!requireInteractionStaff(interaction)) return;

  const appId = match[1];
  const confirmation = interaction.fields.getTextInputValue("v1:avatar:confirm18:text")?.trim();
  if (confirmation !== "I AM 18+") {
    await interaction.reply({ ephemeral: true, content: "No." }).catch(() => undefined);
    return;
  }

  const app = loadApplication(appId);
  if (!app) {
    await interaction.reply({ ephemeral: true, content: "Application not found." }).catch(() => undefined);
    return;
  }
  if (interaction.guildId && app.guild_id !== interaction.guildId) {
    await interaction.reply({ ephemeral: true, content: "Guild mismatch for application." }).catch(() => undefined);
    return;
  }

  const cfg = getConfig(app.guild_id);
  if (!cfg) {
    await interaction.reply({ ephemeral: true, content: "Configuration missing." }).catch(() => undefined);
    return;
  }

  const scan = getScan(appId);
  if (!scan) {
    await interaction.reply({ ephemeral: true, content: "Avatar scan not available." }).catch(() => undefined);
    return;
  }

  const link = buildReverseImageUrl(cfg, scan.avatar_url);
  await interaction
    .reply({
      ephemeral: true,
      content: link,
    })
    .catch(() => undefined);

  db.prepare(
    `
    INSERT INTO review_action (app_id, moderator_id, action, reason, message_link, meta)
    VALUES (?, ?, 'avatar_viewsrc', NULL, NULL, json(?))
  `
  ).run(appId, interaction.user.id, JSON.stringify({ viewed_at: new Date().toISOString() }));
}

function formatTimestamp(iso: string | null | undefined, style: "f" | "R" = "R") {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const epoch = Math.floor(date.getTime() / 1000);
  return `<t:${epoch}:${style}>`;
}

function truncate(value: string, max = 180) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function buildSummaryField(answers: ReviewAnswer[]) {
  if (answers.length === 0) return "- No responses recorded.";
  return answers
    .slice(0, 5)
    .map((row) => {
      const cleaned = row.answer.replace(/\s+/g, " ").trim();
      const display = cleaned.length === 0 ? "(no response)" : truncate(cleaned);
      return `- Q${row.q_index + 1}: ${display}`;
    })
    .join("\n");
}

function buildStatusField(app: ReviewCardApplication) {
  const action = app.lastAction ?? null;
  const actedAt = action?.created_at ?? app.updated_at ?? app.submitted_at ?? app.created_at;
  const reviewer =
    action?.moderatorTag ??
    (app.resolver_id ? `<@${app.resolver_id}>` : undefined);
  const actor = reviewer ?? "unknown reviewer";
  const when = formatTimestamp(actedAt);
  if (app.status === "submitted") {
    const submitted = formatTimestamp(app.submitted_at, "f");
    return `Pending review • Submitted ${submitted}`;
  }
  if (app.status === "needs_info") {
    const base = `Need info requested by ${actor} • ${when}`;
    const reason = action?.reason ?? app.resolution_reason;
    const details = [];
    if (reason) details.push(`Reason: ${truncate(reason, 200)}`);
    const meta = action?.meta;
    if (meta && meta.threadUrl) details.push(`Thread: ${meta.threadUrl}`);
    return [base, ...details].join("\n");
  }
  if (app.status === "approved") {
    const base = `Approved by ${actor} • ${when}`;
    const reason = action?.reason ?? app.resolution_reason;
    return reason ? `${base}\nNote: ${truncate(reason, 200)}` : base;
  }
  if (app.status === "rejected") {
    const dmStatus = action?.meta?.dmDelivered === false ? "❌" : "✅";
    const base = `Rejected by ${actor} • ${when} • DM: ${dmStatus}`;
    const reason = action?.reason ?? app.resolution_reason;
    return reason ? `${base}\nReason: ${truncate(reason, 300)}` : base;
  }
  if (app.status === "kicked") {
    const meta = action?.meta;
    const kickNote =
      meta && meta.kickSucceeded === false
        ? " • Kick failed"
        : meta?.kickSucceeded
          ? " • Kick completed"
          : "";
    const base = `Kicked by ${actor} • ${when}${kickNote}`;
    const reason = action?.reason ?? app.resolution_reason;
    return reason ? `${base}\nReason: ${truncate(reason, 200)}` : base;
  }
  return `${app.status} • ${when}`;
}

function statusColor(status: ApplicationStatus) {
  switch (status) {
    case "approved":
      return 0x57f287;
    case "rejected":
      return 0xed4245;
    case "kicked":
      return 0x992d22;
    case "needs_info":
      return 0xf1c40f;
    case "submitted":
      return 0x5865f2;
    default:
      return 0x2f3136;
  }
}

function renderReviewEmbed(
  app: ReviewCardApplication,
  answers: ReviewAnswer[],
  flags: string[] = [],
  avatarScan?: AvatarScanRow | null
) {
  const embed = new EmbedBuilder()
    .setTitle(`Application #${app.id} — ${app.userTag}`)
    .setColor(statusColor(app.status))
    .setFooter({
      text: `Submitted: ${formatTimestamp(app.submitted_at ?? app.created_at, "f")} • AppID: ${app.id}`,
    })
    .setTimestamp(new Date());

  if (app.avatarUrl) {
    embed.setThumbnail(app.avatarUrl);
  }

  embed.addFields(
    {
      name: "Summary",
      value: buildSummaryField(
        [...answers].sort((a, b) => a.q_index - b.q_index)
      ),
    },
    {
      name: "Status",
      value: buildStatusField(app),
    }
  );

  if (avatarScan?.flagged) {
    const nsfwDisplay =
      typeof avatarScan.nsfw_score === "number" ? avatarScan.nsfw_score.toFixed(2) : "-";
    const edgeDisplay =
      typeof avatarScan.skin_edge_score === "number" ? avatarScan.skin_edge_score.toFixed(2) : "-";
    const reasonLabel =
      avatarScan.reason === "both"
        ? "nsfw + edge"
        : avatarScan.reason === "skin_edge"
          ? "skin edge"
          : avatarScan.reason;
    embed.addFields({
      name: "Avatar Risk",
      value: `Reason: ${reasonLabel}\nNSFW ≈ ${nsfwDisplay} • Edge ≈ ${edgeDisplay}`,
    });
  }

  if (flags.length > 0) {
    embed.addFields({
      name: "Flags",
      value: flags.join("\n"),
    });
  }

  return embed;
}

function buildDecisionComponents(status: ApplicationStatus, appId: string, hasNeedInfoThread: boolean) {
  const approve = new ButtonBuilder()
    .setCustomId(`v1:decide:approve:app${appId}`)
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success);
  const reject = new ButtonBuilder()
    .setCustomId(`v1:decide:reject:app${appId}`)
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger);
  const needInfo = new ButtonBuilder()
    .setCustomId(`v1:decide:needinfo:app${appId}`)
    .setLabel("Need Info")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(hasNeedInfoThread);
  const kick = new ButtonBuilder()
    .setCustomId(`v1:decide:kick:app${appId}`)
    .setLabel("Kick")
    .setStyle(ButtonStyle.Danger);

  const terminal = status === "approved" || status === "rejected" || status === "kicked";
  if (terminal) {
    approve.setDisabled(true);
    reject.setDisabled(true);
    kick.setDisabled(true);
    needInfo.setDisabled(true);
  }

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(approve, reject, needInfo, kick)];
}

function parseMeta(raw: string | null | undefined): ReviewActionMeta {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed as ReviewActionMeta;
  } catch (err) {
    logger.warn({ err }, "Failed to parse review action meta");
    return null;
  }
}

function formatUserTag(username: string, discriminator?: string | null) {
  if (discriminator && discriminator !== "0") {
    return `${username}#${discriminator}`;
  }
  return username;
}

export async function ensureReviewMessage(client: Client, appId: string) {
  const appRow = db
    .prepare(
      `
    SELECT
      a.id,
      a.guild_id,
      a.user_id,
      a.status,
      a.created_at,
      a.submitted_at,
      a.updated_at,
      a.resolved_at,
      a.resolver_id,
      a.resolution_reason,
      g.review_channel_id
    FROM application a
    JOIN guild_config g ON g.guild_id = a.guild_id
    WHERE a.id = ?
  `
    )
    .get(appId) as (ReviewCardApplication & { review_channel_id: string | null }) | undefined;
  if (!appRow) {
    throw new Error(`Application ${appId} not found`);
  }
  if (!appRow.review_channel_id) {
    throw new Error(`Guild ${appRow.guild_id} has no review channel configured`);
  }

  const answers = db
    .prepare(
      `
    SELECT q_index, question, answer
    FROM application_response
    WHERE app_id = ?
    ORDER BY q_index ASC
  `
    )
    .all(appId) as ReviewAnswer[];

  const lastActionRow = db
    .prepare(
      `
    SELECT action, moderator_id, reason, message_link, meta, created_at
    FROM review_action
    WHERE app_id = ?
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get(appId) as
      | {
          action: "approve" | "reject" | "need_info" | "kick";
          moderator_id: string;
          reason: string | null;
          meta: string | null;
          created_at: string;
        }
      | undefined;

  const user = await client.users.fetch(appRow.user_id).catch((err) => {
    logger.warn({ err, userId: appRow.user_id }, "Failed to fetch applicant user");
    return null;
  });

  const reviewChannel = await client.channels
    .fetch(appRow.review_channel_id)
    .catch((err) => {
      logger.warn({ err, channelId: appRow.review_channel_id }, "Failed to fetch review channel");
      return null;
    });

  if (!reviewChannel || !reviewChannel.isTextBased() || reviewChannel.type === ChannelType.DM) {
    throw new Error(`Review channel ${appRow.review_channel_id} is unavailable`);
  }

  const lastAction: ReviewActionSnapshot | null = lastActionRow
    ? {
        action: lastActionRow.action,
        moderator_id: lastActionRow.moderator_id,
        reason: lastActionRow.reason,
        created_at: lastActionRow.created_at,
        meta: parseMeta(lastActionRow.meta),
      }
    : null;

  if (lastAction) {
    const modUser = await client.users.fetch(lastAction.moderator_id).catch((err) => {
      logger.warn({ err, moderatorId: lastAction.moderator_id }, "Failed to fetch reviewer user");
      return null;
    });
    if (modUser) {
      lastAction.moderatorTag = formatUserTag(modUser.username, modUser.discriminator);
    }
  }

  const avatarUrl = user?.displayAvatarURL({ size: 256 }) ?? undefined;
  const applicantTag = user ? formatUserTag(user.username, user.discriminator) : `Unknown (${appRow.user_id})`;

  const openThread = db
    .prepare(
      `
    SELECT thread_id, state
    FROM modmail_bridge
    WHERE guild_id = ? AND user_id = ?
      AND state = 'open'
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get(appRow.guild_id, appRow.user_id) as { thread_id: string; state: string } | undefined;

  if (lastAction?.action === "need_info" && lastAction.meta && !lastAction.meta.threadUrl && openThread) {
    lastAction.meta = {
      ...lastAction.meta,
      threadId: openThread.thread_id,
      threadUrl: buildThreadLink(appRow.guild_id, appRow.review_channel_id, openThread.thread_id),
    };
  }

  const flags: string[] = [];
  if (lastAction?.meta?.dmDelivered === false) {
    flags.push("Applicant DM failed — follow up manually.");
  }
  if (lastAction?.meta?.kickSucceeded === false && lastAction?.action === "kick") {
    flags.push("Kick failed — check permissions.");
  }
  if (lastAction?.meta && "threadError" in lastAction.meta) {
    flags.push("Need info thread creation failed previously.");
  }
  if (lastAction?.action === "need_info" && !openThread) {
    flags.push("Need Info requested but no open thread found.");
  }

  const app: ReviewCardApplication = {
    id: appRow.id,
    guild_id: appRow.guild_id,
    user_id: appRow.user_id,
    status: appRow.status,
    created_at: appRow.created_at,
    submitted_at: appRow.submitted_at,
    updated_at: appRow.updated_at,
    resolved_at: appRow.resolved_at,
    resolver_id: appRow.resolver_id,
    resolution_reason: appRow.resolution_reason,
    userTag: applicantTag,
    avatarUrl,
    lastAction,
  };

  const avatarScan = getScan(appId);
  const embed = renderReviewEmbed(app, answers, flags, avatarScan);
  const components = buildDecisionComponents(app.status, app.id, Boolean(openThread));
  if (avatarScan?.flagged) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`v1:avatar:viewsrc:app${app.id}`)
          .setLabel("View Source")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  const mapping = db
    .prepare(`SELECT channel_id, message_id FROM review_card WHERE app_id = ?`)
    .get(appId) as ReviewCardRow | undefined;

  const nowIso = new Date().toISOString();
  let message: Message | null = null;

  const channel = reviewChannel as GuildTextBasedChannel;

  if (mapping) {
    message = await channel.messages.fetch(mapping.message_id).catch(() => null);
  }

  if (message) {
    await message
      .edit({ embeds: [embed], components })
      .catch((err) => {
        logger.warn({ err, messageId: message?.id }, "Failed to edit review card message");
        throw err;
      });
  } else {
    message = await channel
      .send({ embeds: [embed], components })
      .catch((err) => {
        logger.warn({ err, channelId: channel.id }, "Failed to send review card message");
        throw err;
      });
  }

  const upsert = db.transaction((row: ReviewCardRow | undefined, msg: Message) => {
    if (row) {
      db.prepare(
        `
        UPDATE review_card
        SET channel_id = ?, message_id = ?, updated_at = ?
        WHERE app_id = ?
      `
      ).run(msg.channelId, msg.id, nowIso, appId);
    } else {
      db.prepare(
        `
        INSERT INTO review_card (app_id, channel_id, message_id, updated_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(appId, msg.channelId, msg.id, nowIso);
    }
  });

  upsert(mapping, message);
  return { channelId: message.channelId, messageId: message.id };
}
