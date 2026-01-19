/**
 * Pawtropolis Tech — src/commands/attendance.ts
 * WHAT: Event attendance overview and leaderboard
 * WHY: Allow users to view their own event attendance stats and see top attendees
 * FLOWS:
 *  - /attendance user [user] → show user's movie/game night stats
 *  - /attendance leaderboard [type] → show top event attendees
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { db } from "../db/db.js";
import { type CommandContext, withStep, withSql } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("attendance")
  .setDescription("View event attendance stats and leaderboards")
  .addSubcommand((sub) =>
    sub
      .setName("user")
      .setDescription("View a user's event attendance stats")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to view stats for (defaults to yourself)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("View the event attendance leaderboard")
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Filter by event type")
          .setRequired(false)
          .addChoices(
            { name: "All Events", value: "all" },
            { name: "Movie Nights", value: "movie" },
            { name: "Game Nights", value: "game" }
          )
      )
  );

export async function execute(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;

  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);

  switch (subcommand) {
    case "user":
      await handleUserStats(ctx);
      break;
    case "leaderboard":
      await handleLeaderboard(ctx);
      break;
    default:
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
  }
}

// ============================================================================
// User Stats Handler
// ============================================================================

async function handleUserStats(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const targetUser = interaction.options.getUser("user") ?? interaction.user;

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply();
  });

  // Get qualified counts for each event type
  const stats = withSql(ctx, "SELECT user event stats", () => {
    const movieCount = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM movie_attendance
        WHERE guild_id = ? AND user_id = ? AND qualified = 1
          AND (event_type IS NULL OR event_type = 'movie')
      `
      )
      .get(guild.id, targetUser.id) as { count: number };

    const gameCount = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM movie_attendance
        WHERE guild_id = ? AND user_id = ? AND qualified = 1
          AND event_type = 'game'
      `
      )
      .get(guild.id, targetUser.id) as { count: number };

    const totalMinutes = db
      .prepare(
        `
        SELECT COALESCE(SUM(duration_minutes), 0) as total
        FROM movie_attendance
        WHERE guild_id = ? AND user_id = ?
      `
      )
      .get(guild.id, targetUser.id) as { total: number };

    const firstEvent = db
      .prepare(
        `
        SELECT MIN(event_date) as first_date
        FROM movie_attendance
        WHERE guild_id = ? AND user_id = ? AND qualified = 1
      `
      )
      .get(guild.id, targetUser.id) as { first_date: string | null };

    const recentEvents = db
      .prepare(
        `
        SELECT event_date, event_type, duration_minutes, qualified
        FROM movie_attendance
        WHERE guild_id = ? AND user_id = ?
        ORDER BY event_date DESC
        LIMIT 5
      `
      )
      .all(guild.id, targetUser.id) as Array<{
      event_date: string;
      event_type: string | null;
      duration_minutes: number;
      qualified: number;
    }>;

    return {
      movieCount: movieCount.count,
      gameCount: gameCount.count,
      totalMinutes: totalMinutes.total,
      firstDate: firstEvent.first_date,
      recentEvents,
    };
  });

  await withStep(ctx, "reply", async () => {
    const totalEvents = stats.movieCount + stats.gameCount;
    const isSelf = targetUser.id === interaction.user.id;

    const embed = new EmbedBuilder()
      .setTitle(
        isSelf ? "Your Event Attendance" : `Event Attendance for ${targetUser.displayName}`
      )
      .setThumbnail(targetUser.displayAvatarURL())
      .setColor(0x9b59b6)
      .setTimestamp();

    // Main stats
    embed.addFields(
      {
        name: "🎬 Movie Nights",
        value: stats.movieCount.toString(),
        inline: true,
      },
      {
        name: "🎮 Game Nights",
        value: stats.gameCount.toString(),
        inline: true,
      },
      {
        name: "📊 Total Events",
        value: totalEvents.toString(),
        inline: true,
      }
    );

    // Time spent
    const hours = Math.floor(stats.totalMinutes / 60);
    const mins = stats.totalMinutes % 60;
    const timeStr =
      hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    embed.addFields({
      name: "⏱️ Total Time",
      value: timeStr,
      inline: true,
    });

    // First event
    if (stats.firstDate) {
      embed.addFields({
        name: "📅 First Event",
        value: stats.firstDate,
        inline: true,
      });
    }

    // Recent events
    if (stats.recentEvents.length > 0) {
      const recentLines = stats.recentEvents.map((e) => {
        const type = e.event_type === "game" ? "🎮" : "🎬";
        const status = e.qualified ? "✅" : "❌";
        return `${status} ${type} ${e.event_date} (${e.duration_minutes}min)`;
      });
      embed.addFields({
        name: "Recent Events",
        value: recentLines.join("\n"),
      });
    } else {
      embed.setDescription(
        isSelf
          ? "You haven't attended any events yet. Join a movie or game night to get started!"
          : "This user hasn't attended any events yet."
      );
    }

    await interaction.editReply({ embeds: [embed] });
  });
}

// ============================================================================
// Leaderboard Handler
// ============================================================================

interface LeaderboardEntry {
  user_id: string;
  qualified_count: number;
  total_minutes: number;
}

async function handleLeaderboard(
  ctx: CommandContext<ChatInputCommandInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild!;
  const eventType = interaction.options.getString("type") ?? "all";

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply();
  });

  const leaderboard = withSql(ctx, "SELECT leaderboard", () => {
    let query: string;

    if (eventType === "all") {
      query = `
        SELECT
          user_id,
          COUNT(*) as qualified_count,
          SUM(duration_minutes) as total_minutes
        FROM movie_attendance
        WHERE guild_id = ? AND qualified = 1
        GROUP BY user_id
        ORDER BY qualified_count DESC, total_minutes DESC
        LIMIT 15
      `;
    } else {
      // For specific event type
      const typeFilter =
        eventType === "movie"
          ? "(event_type IS NULL OR event_type = 'movie')"
          : "event_type = 'game'";
      query = `
        SELECT
          user_id,
          COUNT(*) as qualified_count,
          SUM(duration_minutes) as total_minutes
        FROM movie_attendance
        WHERE guild_id = ? AND qualified = 1 AND ${typeFilter}
        GROUP BY user_id
        ORDER BY qualified_count DESC, total_minutes DESC
        LIMIT 15
      `;
    }

    return db.prepare(query).all(guild.id) as LeaderboardEntry[];
  });

  // Get the user's rank if not on leaderboard
  const userRank = withSql(ctx, "SELECT user rank", () => {
    let query: string;

    if (eventType === "all") {
      query = `
        WITH ranked AS (
          SELECT
            user_id,
            COUNT(*) as qualified_count,
            RANK() OVER (ORDER BY COUNT(*) DESC) as rank
          FROM movie_attendance
          WHERE guild_id = ? AND qualified = 1
          GROUP BY user_id
        )
        SELECT rank, qualified_count FROM ranked WHERE user_id = ?
      `;
    } else {
      const typeFilter =
        eventType === "movie"
          ? "(event_type IS NULL OR event_type = 'movie')"
          : "event_type = 'game'";
      query = `
        WITH ranked AS (
          SELECT
            user_id,
            COUNT(*) as qualified_count,
            RANK() OVER (ORDER BY COUNT(*) DESC) as rank
          FROM movie_attendance
          WHERE guild_id = ? AND qualified = 1 AND ${typeFilter}
          GROUP BY user_id
        )
        SELECT rank, qualified_count FROM ranked WHERE user_id = ?
      `;
    }

    return db.prepare(query).get(guild.id, interaction.user.id) as {
      rank: number;
      qualified_count: number;
    } | undefined;
  });

  await withStep(ctx, "reply", async () => {
    const typeEmoji =
      eventType === "movie" ? "🎬" : eventType === "game" ? "🎮" : "🎉";
    const typeLabel =
      eventType === "movie"
        ? "Movie Night"
        : eventType === "game"
          ? "Game Night"
          : "Event";

    const embed = new EmbedBuilder()
      .setTitle(`${typeEmoji} ${typeLabel} Leaderboard`)
      .setColor(0x9b59b6)
      .setTimestamp();

    if (leaderboard.length === 0) {
      embed.setDescription("No attendance records yet. Be the first to attend an event!");
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build leaderboard display
    const lines: string[] = [];
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const medal =
        i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      const hours = Math.floor(entry.total_minutes / 60);
      const timeStr = hours > 0 ? `${hours}h+` : `${entry.total_minutes}m`;

      lines.push(
        `${medal} <@${entry.user_id}> — **${entry.qualified_count}** events (${timeStr})`
      );
    }

    embed.setDescription(lines.join("\n"));

    // Show user's rank if they're not on the leaderboard
    const userOnBoard = leaderboard.some(
      (e) => e.user_id === interaction.user.id
    );
    if (!userOnBoard && userRank) {
      embed.setFooter({
        text: `Your rank: #${userRank.rank} with ${userRank.qualified_count} qualified events`,
      });
    } else if (!userOnBoard) {
      embed.setFooter({
        text: "You haven't qualified for any events yet. Join the next one!",
      });
    }

    await interaction.editReply({ embeds: [embed] });
  });
}
