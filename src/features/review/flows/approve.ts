/**
 * Pawtropolis Tech -- src/features/review/flows/approve.ts
 * WHAT: Approval transaction and flow logic for application review.
 * WHY: Grants verified role and sends welcome DM when an application is approved.
 * FLOWS:
 *  - approveTx: Database transaction to mark application as approved
 *  - approveFlow: Discord-side role assignment
 *  - deliverApprovalDm: Best-effort DM notification to applicant
 * DOCS:
 *  - GuildMember roles: https://discord.js.org/#/docs/discord.js/main/class/GuildMember
 *  - Permission errors (50013): Missing Permissions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { EmbedBuilder, type Guild, type GuildMember } from "discord.js";
import { db } from "../../../db/db.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import type { GuildConfig } from "../../../lib/config.js";
import { nowUtc } from "../../../lib/time.js";
import type { ApplicationRow, TxResult, ApproveFlowResult } from "../types.js";
import { canManageRole } from "../../roleAutomation.js";

// ===== Constants =====

const FLOW_TIMEOUT_MS = 30000;
const ROLE_GRANT_RETRIES = 2;
const ROLE_GRANT_RETRY_DELAY_MS = 2000;

// ===== Helpers =====

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isMissingPermissionError(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 50013;
}

// ===== Transaction =====

/**
 * approveTx
 * WHAT: Database transaction to approve an application.
 * WHY: Atomic update ensures application state and audit trail are consistent.
 * @param appId - Application ID
 * @param moderatorId - Moderator performing the action
 * @param reason - Optional approval reason/note
 * @returns TxResult indicating success or current state
 */
export function approveTx(appId: string, moderatorId: string, reason?: string | null): TxResult {
  return db.transaction(() => {
    const row = db.prepare(`SELECT status FROM application WHERE id = ?`).get(appId) as
      | { status: ApplicationRow["status"] }
      | undefined;
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
        INSERT INTO review_action (app_id, moderator_id, action, created_at, reason, meta)
        VALUES (?, ?, 'approve', ?, ?, NULL)
      `
      )
      .run(appId, moderatorId, nowUtc(), reason ?? null);
    db.prepare(
      `
      UPDATE application
      SET status = 'approved',
          updated_at = datetime('now'),
          resolved_at = datetime('now'),
          resolver_id = ?,
          resolution_reason = ?
      WHERE id = ?
    `
    ).run(moderatorId, reason ?? null, appId);
    return { kind: "changed" as const, reviewActionId: Number(insert.lastInsertRowid) };
  })();
}

// ===== Flow =====

/**
 * approveFlow
 * WHAT: Discord-side approval actions (fetch member, grant role).
 * WHY: Role assignment is the primary effect of approval in Discord.
 * @param guild - Discord guild
 * @param memberId - User ID of the applicant
 * @param cfg - Guild configuration containing accepted_role_id
 * @returns ApproveFlowResult with role assignment status
 */
export async function approveFlow(
  guild: Guild,
  memberId: string,
  cfg: GuildConfig
): Promise<ApproveFlowResult> {
  const result: ApproveFlowResult = {
    roleApplied: false,
    member: null,
    roleError: null,
  };
  try {
    result.member = await withTimeout(
      guild.members.fetch(memberId),
      FLOW_TIMEOUT_MS,
      "approveFlow:fetchMember"
    );
  } catch (err) {
    logger.warn({ err, guildId: guild.id, memberId }, "Failed to fetch member for approval");
    captureException(err, { area: "approveFlow:fetchMember", guildId: guild.id, userId: memberId });
    return result;
  }

  const roleId = cfg.accepted_role_id;
  if (roleId && result.member) {
    const role =
      guild.roles.cache.get(roleId) ?? (await withTimeout(
        guild.roles.fetch(roleId),
        FLOW_TIMEOUT_MS,
        "approveFlow:fetchRole"
      ).catch(() => null));
    if (role) {
      if (!result.member.roles.cache.has(role.id)) {
        // Retry loop: transient failures (cache staleness, timeouts) are common
        for (let attempt = 0; attempt <= ROLE_GRANT_RETRIES; attempt++) {
          if (attempt > 0) {
            logger.info(
              { guildId: guild.id, memberId, roleId: role.id, attempt },
              "[approve] Retrying role grant"
            );
            await new Promise((r) => setTimeout(r, ROLE_GRANT_RETRY_DELAY_MS));
            // Re-fetch role to refresh cache on retry
            await guild.roles.fetch(role.id).catch(() => null);
          }

          const roleCheck = await canManageRole(guild, role.id);
          if (!roleCheck.canManage) {
            result.roleApplied = false;
            result.roleError = { message: roleCheck.reason };
            logger.warn(
              { guildId: guild.id, memberId, roleId: role.id, reason: roleCheck.reason, attempt },
              "[approve] Cannot manage accepted role - check role hierarchy"
            );
            continue; // retry — cache may be stale
          }

          try {
            await withTimeout(
              result.member.roles.add(role, "Gate approval"),
              FLOW_TIMEOUT_MS,
              "approveFlow:addRole"
            );
            result.roleApplied = true;
            break; // success
          } catch (err) {
            const code = (err as { code?: number }).code;
            const message = err instanceof Error ? err.message : undefined;
            result.roleError = { code, message };
            logger.warn(
              { err, guildId: guild.id, memberId, roleId, attempt },
              "[approve] Failed to grant approval role"
            );
            if (!isMissingPermissionError(err)) {
              captureException(err, {
                area: "approveFlow:grantRole",
                guildId: guild.id,
                userId: memberId,
                roleId,
                attempt,
              });
            }
            // continue to retry
          }
        }
      } else {
        result.roleApplied = true;
      }
    } else {
      result.roleError = { message: "Accepted role not found in guild" };
      logger.error(
        { guildId: guild.id, memberId, roleId },
        "[approve] Accepted role not found — check guild config"
      );
    }
  }

  return result;
}

// ===== DM Delivery =====

/**
 * deliverApprovalDm
 * WHAT: Sends a welcome DM to the approved applicant.
 * WHY: Provides immediate feedback that their application was approved.
 * NOTE: Best-effort; Discord users can disable DMs from server members.
 * @param member - GuildMember to DM
 * @param guildName - Server name for message personalization
 * @param reason - Optional note from reviewer
 * @returns true if DM was delivered, false otherwise
 */
export async function deliverApprovalDm(
  member: GuildMember,
  guildName: string,
  reason?: string | null
): Promise<boolean> {
  try {
    const embed = new EmbedBuilder()
      .setTitle("Application Approved!")
      .setColor(0x00cc00)
      .setDescription(
        `Hi, welcome to **${guildName}**! Your application has been approved.` +
        (reason ? `\n\n**Note from reviewer:** ${reason}` : "") +
        `\n\nEnjoy your stay!`
      );
    // DM may fail if recipient has privacy settings enabled; we fail-soft and do not block approval.
    await withTimeout(member.send({ embeds: [embed] }), FLOW_TIMEOUT_MS, "deliverApprovalDm");
    return true;
  } catch (err) {
    logger.warn({ err, userId: member.id }, "Failed to DM applicant after approval");
    return false;
  }
}
