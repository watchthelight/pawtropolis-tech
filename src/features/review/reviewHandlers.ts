// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type TextChannel,
} from "discord.js";
import { db } from "../../db/connection.js";
import { hasManageGuild, isReviewer } from "../../lib/permissions.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { ensureReviewMessage } from "./reviewCard.js";
import { approveFlow, kickFlow, needInfoFlow, rejectFlow } from "./dmAndRoleOps.js";
import { getConfig } from "../../lib/config.js";
import { buildReverseImageUrl } from "../avatarScan/reverseLink.js";
import { getScan } from "../avatarScan/repo.js";

type ApplicationRow = {
  id: string;
  guild_id: string;
  user_id: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";
};

const BUTTON_RE = /^v1:decide:(approve|reject|needinfo|kick):app(.+)$/;
const MODAL_RE = /^v1:modal:reject:app(.+)$/;
const VIEW_SRC_BUTTON_RE = /^v1:avatar:viewsrc:app(.+)$/;
const VIEW_SRC_MODAL_RE = /^v1:avatar:confirm18:app(.+)$/;

function isStaff(guildId: string, member: GuildMember | null) {
  return hasManageGuild(member) || isReviewer(guildId, member);
}

async function replyAlreadyResolved(interaction: ButtonInteraction | ModalSubmitInteraction) {
  if (interaction.replied || interaction.deferred) return;
  await interaction.reply({ ephemeral: true, content: "This application is already resolved." }).catch(() => undefined);
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

type TxResult =
  | { kind: "changed"; reviewActionId: number }
  | { kind: "already"; status: string }
  | { kind: "terminal"; status: string }
  | { kind: "invalid"; status: string };

function approveTx(appId: string, moderatorId: string): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "approved") return { kind: "already", status: row.status };
    if (row.status === "rejected" || row.status === "kicked") {
      return { kind: "terminal", status: row.status };
    }
    if (row.status !== "submitted" && row.status !== "needs_info") {
      return { kind: "invalid", status: row.status };
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
    return { kind: "changed", reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

function rejectTx(appId: string, moderatorId: string, reason: string): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "rejected") return { kind: "already", status: row.status };
    if (row.status === "approved" || row.status === "kicked") {
      return { kind: "terminal", status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid", status: row.status };
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
    return { kind: "changed", reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

function needInfoTx(appId: string, moderatorId: string): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "needs_info") return { kind: "already", status: row.status };
    if (row.status === "approved" || row.status === "rejected" || row.status === "kicked") {
      return { kind: "terminal", status: row.status };
    }
    if (row.status !== "submitted") {
      return { kind: "invalid", status: row.status };
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
    return { kind: "changed", reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

function kickTx(appId: string, moderatorId: string, reason: string | null): TxResult {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM application WHERE id = ?`)
      .get(appId) as { status: ApplicationRow["status"] } | undefined;
    if (!row) throw new Error("Application not found");
    if (row.status === "kicked") return { kind: "already", status: row.status };
    if (row.status === "approved" || row.status === "rejected") {
      return { kind: "terminal", status: row.status };
    }
    if (row.status === "draft") {
      return { kind: "invalid", status: row.status };
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
    return { kind: "changed", reviewActionId: Number(insert.lastInsertRowid) };
  })();
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
  if (!cfg) {
    logger.warn({ guildId: guild.id }, "Guild configuration missing during approve");
  }
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
    const latest = db
      .prepare(
        `
        SELECT id
        FROM review_action
        WHERE app_id = ? AND action = 'need_info'
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get(app.id) as { id: number } | undefined;
    if (tx.kind === "changed") {
      updateReviewActionMeta(tx.reviewActionId, { threadError: "create_failed" });
    } else if (latest) {
      updateReviewActionMeta(latest.id, { threadError: "create_failed" });
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
  } else if (tx.kind === "already") {
    const latest = db
      .prepare(
        `
        SELECT id
        FROM review_action
        WHERE app_id = ? AND action = 'need_info'
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get(app.id) as { id: number } | undefined;
    if (latest) {
      updateReviewActionMeta(latest.id, { threadId: flow.threadId, threadUrl });
    }
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
    await replyAlreadyResolved(interaction);
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
