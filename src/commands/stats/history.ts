/**
 * Pawtropolis Tech -- src/commands/stats/history.ts
 * WHAT: Handler for /stats history - moderator action history.
 * WHY: Provides leadership with detailed moderator activity inspection.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  db,
  logger,
  isOwner,
  hasStaffPermissions,
  getConfig,
  isGuildMember,
  withStep,
  withSql,
  type CommandContext,
} from "./shared.js";
import { computePercentiles } from "../../lib/percentiles.js";
import { detectModeratorAnomalies } from "../../lib/anomaly.js";
import { generateModHistoryCsv } from "../../lib/csv.js";
import { logActionPretty } from "../../logging/pretty.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const MAX_PERCENTILE_ROWS = 30000;
const MAX_EXPORT_ROWS = 50000;

/**
 * Leadership permission check for moderator oversight.
 */
async function requireLeadership(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  if (isOwner(userId)) return true;

  const member = interaction.member;
  if (!member || typeof member.permissions === "string") return false;

  if (interaction.guild?.ownerId === userId) return true;

  if (hasStaffPermissions(member, guildId)) return true;

  const config = getConfig(guildId);
  if (
    config?.leadership_role_id &&
    isGuildMember(member) &&
    member.roles.cache.has(config.leadership_role_id)
  ) {
    return true;
  }

  return false;
}

/**
 * Handle /stats history subcommand.
 * Shows detailed moderator action history with optional CSV export.
 */
export async function handleHistory(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;

  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const isLeadership = await requireLeadership(interaction);
  if (!isLeadership) {
    await interaction.reply({
      content: "This command requires leadership role or admin permissions.",
      ephemeral: true,
    });
    return;
  }

  const moderator = interaction.options.getUser("moderator", true);
  const days = interaction.options.getInteger("days") || DEFAULT_DAYS;
  const exportCsv = interaction.options.getBoolean("export") || false;

  await withStep(ctx, "defer_reply", async () => {
    await interaction.deferReply({ ephemeral: true });
  });

  const guildId = interaction.guildId;
  const fromTimestamp = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  try {
    const { totalActions, counts, p50, p95, anomaly, rejectRate } = await withStep(ctx, "fetch_stats", () => {
      const totalRow = withSql(ctx, "SELECT COUNT(*) FROM action_log", () =>
        db.prepare(
          `SELECT COUNT(*) as total
           FROM action_log
           WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?`
        ).get(moderator.id, guildId, fromTimestamp) as { total: number } | undefined
      );

      const totalActions = totalRow?.total || 0;

      const countRows = withSql(ctx, "SELECT action, COUNT(*) GROUP BY action", () =>
        db.prepare(
          `SELECT action, COUNT(*) as cnt
           FROM action_log
           WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?
           GROUP BY action`
        ).all(moderator.id, guildId, fromTimestamp) as Array<{ action: string; cnt: number }>
      );

      const counts: Record<string, number> = {};
      for (const row of countRows) {
        counts[row.action] = row.cnt;
      }

      const responseRows = withSql(ctx, "SELECT response_ms FROM action_log", () =>
        db.prepare(
          `SELECT json_extract(meta_json, '$.response_ms') as ms
           FROM action_log
           WHERE actor_id = ? AND guild_id = ?
             AND created_at_s >= ?
             AND json_type(json_extract(meta_json, '$.response_ms')) = 'integer'
           LIMIT ?`
        ).all(moderator.id, guildId, fromTimestamp, MAX_PERCENTILE_ROWS) as Array<{ ms: number }>
      );

      const responseTimes = responseRows.map((r) => r.ms).filter((ms) => ms > 0);
      const percentiles = computePercentiles(responseTimes, [50, 95]);
      const p50 = percentiles.get(50);
      const p95 = percentiles.get(95);

      const approveCount = counts["approve"] || 0;
      const rejectCount = counts["reject"] || 0;
      const totalDecisions = approveCount + rejectCount;
      const rejectRate = totalDecisions > 0 ? ((rejectCount / totalDecisions) * 100).toFixed(1) : "0.0";

      const dailyRows = withSql(ctx, "SELECT daily action counts", () =>
        db.prepare(
          `SELECT DATE(created_at_s, 'unixepoch') as day, COUNT(*) as cnt
           FROM action_log
           WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?
           GROUP BY day
           ORDER BY day ASC`
        ).all(moderator.id, guildId, fromTimestamp) as Array<{ day: string; cnt: number }>
      );

      const dailyCounts = dailyRows.map((r) => r.cnt);
      const anomaly = detectModeratorAnomalies(dailyCounts);

      return { totalActions, counts, p50, p95, anomaly, rejectRate };
    });

    const embed = new EmbedBuilder()
      .setTitle(`Moderator History: ${moderator.tag}`)
      .setDescription(
        totalActions > 10000
          ? `Activity summary for the last ${days} days\nHigh volume (${totalActions.toLocaleString()} actions) - some statistics may be sampled`
          : `Activity summary for the last ${days} days`
      )
      .setColor(anomaly.isAnomaly ? 0xfaa61a : 0x5865f2)
      .addFields(
        { name: "Total Actions", value: totalActions.toLocaleString(), inline: true },
        { name: "Approvals", value: (counts["approve"] || 0).toLocaleString(), inline: true },
        { name: "Rejections", value: (counts["reject"] || 0).toLocaleString(), inline: true },
        { name: "Reject Rate", value: `${rejectRate}%`, inline: true },
        {
          name: "Response Time (p50)",
          value: p50 ? `${Math.round(p50 / 1000)}s` : "N/A",
          inline: true,
        },
        {
          name: "Response Time (p95)",
          value: p95 ? `${Math.round(p95 / 1000)}s` : "N/A",
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    if (anomaly.isAnomaly) {
      embed.addFields({
        name: "Anomaly Detected",
        value: `Z-score: ${anomaly.score.toFixed(2)} (${anomaly.reason})`,
      });
    }

    await logActionPretty(interaction.guild!, {
      action: "stats_history_view",
      actorId: interaction.user.id,
      meta: {
        moderatorId: moderator.id,
        guildId,
        periodDays: days,
        totalActions,
        exportRequested: exportCsv,
      },
    });

    if (exportCsv) {
      const exportResult = await withStep(ctx, "generate_export", () => {
        const countRow = withSql(ctx, "SELECT COUNT(*) for export check", () =>
          db.prepare(
            `SELECT COUNT(*) as total
             FROM action_log
             WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?`
          ).get(moderator.id, guildId, fromTimestamp) as { total: number } | undefined
        );

        const totalRows = countRow?.total || 0;

        if (totalRows > MAX_EXPORT_ROWS) {
          return { error: `Export too large: ${totalRows.toLocaleString()} rows exceeds limit of ${MAX_EXPORT_ROWS.toLocaleString()}. Please narrow your time range.` };
        }

        const rows = withSql(ctx, "SELECT action_log for export", () =>
          db.prepare(
            `SELECT id, action, actor_id, subject_id, created_at_s, reason, meta_json, guild_id
             FROM action_log
             WHERE actor_id = ? AND guild_id = ? AND created_at_s >= ?
             ORDER BY created_at_s DESC
             LIMIT ?`
          ).all(moderator.id, guildId, fromTimestamp, MAX_EXPORT_ROWS) as any[]
        );

        const csv = generateModHistoryCsv(rows);

        const exportsDir = join(process.cwd(), "data", "exports");
        try {
          mkdirSync(exportsDir, { recursive: true });
        } catch {
          // Directory may already exist
        }

        const timestamp = Date.now();
        const random = randomBytes(4).toString("hex");
        const filename = `stats-history-${moderator.id}-${timestamp}-${random}.csv`;
        const filepath = join(exportsDir, filename);

        writeFileSync(filepath, csv, "utf-8");

        return { filename, rowCount: rows.length };
      });

      if ("error" in exportResult) {
        await interaction.editReply({ content: exportResult.error });
        return;
      }

      await logActionPretty(interaction.guild!, {
        action: "stats_history_export",
        actorId: interaction.user.id,
        meta: {
          moderatorId: moderator.id,
          guildId,
          rowCount: exportResult.rowCount,
          filename: exportResult.filename,
        },
      });

      const downloadUrl = `${process.env.PUBLIC_URL || "https://pawtropolis.tech"}/exports/${exportResult.filename}`;

      embed.addFields({
        name: "CSV Export",
        value: `[Download CSV](${downloadUrl}) (${exportResult.rowCount} rows)\n*Link expires in 24 hours*`,
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { evt: "stats_history_view", moderatorId: moderator.id, guildId, days, exportCsv, actorId: interaction.user.id },
      "[stats:history] command executed"
    );
  } catch (err) {
    logger.error({ evt: "stats_history_error", err, moderatorId: moderator.id, guildId }, "[stats:history] command failed");
    await interaction.editReply({
      content: "Failed to fetch moderator history. Please try again later.",
    });
  }
}
