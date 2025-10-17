// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type {
  Guild,
  GuildMember,
  TextChannel,
  ThreadAutoArchiveDuration,
  ThreadChannel,
  User,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import type { GuildConfig } from "../../lib/config.js";
import { db } from "../../db/connection.js";

export type ApproveFlowResult = {
  roleApplied: boolean;
  dmDelivered: boolean;
};

export async function approveFlow(guild: Guild, memberId: string, cfg: GuildConfig): Promise<ApproveFlowResult> {
  const result: ApproveFlowResult = { roleApplied: false, dmDelivered: false };
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
    } else {
      logger.warn({ guildId: guild.id, roleId }, "Approval role missing");
    }
  } else {
    logger.warn({ guildId: guild.id }, "No approval role configured");
  }

  const dmContent = `Hi — welcome to ${guild.name}! Your application has been approved.`;
  try {
    await member.send({ content: dmContent });
    result.dmDelivered = true;
  } catch (err) {
    logger.warn({ err, userId: memberId }, "Failed to DM applicant after approval");
  }

  return result;
}

export type RejectFlowOptions = {
  guildName: string;
  reason: string;
};

export type RejectFlowResult = {
  dmDelivered: boolean;
};

export async function rejectFlow(user: User, options: RejectFlowOptions): Promise<RejectFlowResult> {
  const result: RejectFlowResult = { dmDelivered: false };
  const lines = [
    `Hi — thanks for applying to ${options.guildName}. We’re not able to approve this application.`,
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

export type NeedInfoFlowOptions = {
  appId: string;
  reviewChannel: TextChannel;
  reason?: string | null;
};

export type NeedInfoFlowResult = {
  threadId: string;
  created: boolean;
};

export async function needInfoFlow(
  guild: Guild,
  memberId: string,
  options: NeedInfoFlowOptions
): Promise<NeedInfoFlowResult> {
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
      reason: options.reason ?? `Need info requested for application ${options.appId}`,
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

  const insert = db.prepare(
    `
    INSERT INTO modmail_bridge (guild_id, user_id, thread_id, state)
    VALUES (?, ?, ?, 'open')
  `
  );
  insert.run(guild.id, memberId, thread.id);

  return { threadId: thread.id, created: true };
}

export type KickFlowResult = {
  dmDelivered: boolean;
  kickSucceeded: boolean;
  error?: string;
};

export async function kickFlow(
  guild: Guild,
  memberId: string,
  reason?: string | null
): Promise<KickFlowResult> {
  const result: KickFlowResult = { dmDelivered: false, kickSucceeded: false };
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
