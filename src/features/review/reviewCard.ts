// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { db } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import type { AvatarScanRow } from "../avatarScan/repo.js";
import { getScan } from "../avatarScan/repo.js";

export type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "needs_info" | "kicked";

export type ReviewAnswer = {
  q_index: number;
  question: string;
  answer: string;
};

export type ReviewActionMeta = {
  dmDelivered?: boolean;
  dmError?: string;
  threadId?: string;
  threadUrl?: string;
  threadError?: string;
  roleApplied?: boolean;
  kickSucceeded?: boolean;
  kickError?: string;
} | null;

export type ReviewActionSnapshot = {
  action: "approve" | "reject" | "need_info" | "kick";
  moderator_id: string;
  moderatorTag?: string;
  reason?: string | null;
  created_at: string;
  meta: ReviewActionMeta;
};

export type ReviewCardApplication = {
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

type ReviewEmbedFlags = string[];

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

export function renderReviewEmbed(
  app: ReviewCardApplication,
  answers: ReviewAnswer[],
  flags: ReviewEmbedFlags = [],
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

type ReviewCardRow = {
  channel_id: string;
  message_id: string;
};

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

function buildThreadUrl(guildId: string, channelId: string, threadId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}/${threadId}`;
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
      threadUrl: buildThreadUrl(appRow.guild_id, appRow.review_channel_id, openThread.thread_id),
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
