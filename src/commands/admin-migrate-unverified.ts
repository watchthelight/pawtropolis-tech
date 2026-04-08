/**
 * Pawtropolis Tech — src/commands/admin-migrate-unverified.ts
 * WHAT: One-shot migration command. Walks every current member with no
 *       accepted_role_id and creates a per-user private verify thread for
 *       them via the threadGate.handleMemberJoin path. After this command
 *       completes successfully, staff can safely deny `@everyone` View on
 *       the public lobby category — every existing unverified user will
 *       have their own thread to verify in.
 * WHY:  Without this migration, denying `@everyone` View on the lobby
 *       would lock out the ~50–500 unverified users currently sitting in
 *       the public lobby. They wouldn't see any channel and wouldn't know
 *       how to verify. This command creates a thread for each of them
 *       BEFORE the lockdown, so they receive Discord's standard "added to
 *       a thread" notification and can verify normally.
 * GATED TO: Server Dev / Community Manager / bot owner.
 *
 * USAGE: /admin-migrate-unverified
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
  type Message,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { type CommandContext, withStep, replyOrEdit } from "../lib/cmdWrap.js";
import { ROLE_IDS, shouldBypass, hasAnyRole } from "../lib/roles.js";
import { getConfig } from "../lib/config.js";
import { BRAND_COLOR } from "../features/gate.js";
import { handleMemberJoin } from "../features/gate/threadGate.js";

const ALLOWED_ROLES = [ROLE_IDS.COMMUNITY_MANAGER, ROLE_IDS.SERVER_DEV];

export const data = new SlashCommandBuilder()
  .setName("admin-migrate-unverified")
  .setDescription("Create per-user verify threads for all current unverified members (one-shot)")
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const { guildId, guild, user, channel } = interaction;
  const member = interaction.member as GuildMember | null;

  if (!guildId || !guild || !channel) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Acknowledge immediately
  await withStep(ctx, "defer", async () => {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Starting verify thread migration...")
          .setDescription("Loading config + fetching members.")
          .setColor(BRAND_COLOR),
      ],
    });
  });

  // Permission check: bot owner / server dev / community manager
  if (!shouldBypass(user.id, member) && !hasAnyRole(member, ALLOWED_ROLES)) {
    await interaction.editReply({
      content: "You do not have permission to use this command.",
    });
    return;
  }

  // Verify the feature is configured
  const cfg = await withStep(ctx, "load_config", async () => getConfig(guildId));
  if (!cfg?.verify_thread_parent_id) {
    await replyOrEdit(interaction, {
      content:
        "`verify_thread_parent_id` is not configured for this guild. Run `/gate set-verify-thread-parent <channel>` first.",
    });
    return;
  }
  if (!cfg.accepted_role_id) {
    await replyOrEdit(interaction, {
      content: "`accepted_role_id` is not configured. Run `/gate setup` first.",
    });
    return;
  }

  // Channel-bound progress message (avoids the 15-minute interaction token expiry)
  const textChannel = channel as TextChannel;
  let progressMsg: Message | null = null;
  try {
    progressMsg = await textChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Fetching members...")
          .setDescription("Scanning server membership for unverified users.")
          .setColor(BRAND_COLOR),
      ],
    });
  } catch {
    /* fall back to interaction.editReply */
  }

  async function updateProgress(embed: EmbedBuilder) {
    try {
      if (progressMsg) {
        await progressMsg.edit({ embeds: [embed] });
      } else {
        await interaction.editReply({ embeds: [embed] });
      }
    } catch {
      /* non-fatal */
    }
  }

  // Find unverified targets — paginated, filter by missing accepted_role_id
  const targets: GuildMember[] = [];
  await withStep(ctx, "fetch_members", async () => {
    let after: string | undefined;
    const PAGE_SIZE = 1000;
    let scanned = 0;
    while (true) {
      const page = await guild.members.list({ limit: PAGE_SIZE, after });
      if (page.size === 0) break;
      for (const [, m] of page) {
        if (m.user.bot) continue;
        if (m.roles.cache.has(cfg.accepted_role_id!)) continue;
        targets.push(m);
      }
      scanned += page.size;
      after = page.lastKey();
      await updateProgress(
        new EmbedBuilder()
          .setTitle("Fetching members...")
          .setDescription(
            `Scanned **${scanned.toLocaleString()}** members so far...\n` +
              `Unverified to migrate: **${targets.length}**`
          )
          .setColor(BRAND_COLOR)
      );
      if (page.size < PAGE_SIZE) break;
    }
  });

  const total = targets.length;
  if (total === 0) {
    await updateProgress(
      new EmbedBuilder()
        .setTitle("All Clear")
        .setDescription("No unverified members to migrate.")
        .setColor(BRAND_COLOR)
    );
    return;
  }

  // Iterate, paced 1 thread per second to respect Discord's per-channel
  // rate limit (5 threads / 5 seconds is the cap; we go well under).
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  await withStep(ctx, "create_threads", async () => {
    for (const target of targets) {
      try {
        await handleMemberJoin(target);
        created++;
      } catch (err) {
        failed++;
        logger.warn(
          { err, userId: target.id, guildId },
          "[admin-migrate-unverified] handleMemberJoin failed"
        );
      }

      const processed = created + skipped + failed;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = Math.round((processed / total) * 100);
      const bar = progressBar(pct);
      await updateProgress(
        new EmbedBuilder()
          .setTitle("Creating verify threads...")
          .setDescription(
            `${bar} **${pct}%**\n\n` +
              `**${processed.toLocaleString()}** / **${total.toLocaleString()}** members\n` +
              `Created: **${created}** · Failed: **${failed}**\n` +
              `${elapsed}s elapsed\n\n` +
              `Last: <@${target.id}>`
          )
          .setColor(BRAND_COLOR)
      );

      // Pace to ~1 per second to stay well under Discord's per-channel
      // thread-create rate limit (5 / 5s)
      await new Promise((res) => setTimeout(res, 1000));
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  await withStep(ctx, "summary", async () => {
    await updateProgress(
      new EmbedBuilder()
        .setTitle("Migration Complete")
        .setDescription(
          `Finished in **${elapsed}s**\n\n` +
            `Members processed: **${total.toLocaleString()}**\n` +
            `Threads created: **${created}**\n` +
            `Failed: **${failed}**\n\n` +
            `**Next step:** in Server Settings → Channels → \`[13] Unverified Area\` → ` +
            `set @everyone View Channel = ❌. Verified users keep access via the accepted role.`
        )
        .setColor(BRAND_COLOR)
        .setTimestamp()
    );
  });

  logger.info(
    { evt: "admin_migrate_unverified_complete", guildId, total, created, failed, elapsed },
    "[admin-migrate-unverified] complete"
  );
}

function progressBar(pct: number): string {
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}
