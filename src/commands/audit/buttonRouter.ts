/**
 * Pawtropolis Tech -- src/commands/audit/buttonRouter.ts
 * WHAT: Routes /audit confirmation button clicks (confirm/cancel/resume/fresh)
 *       to the members or nsfw background audit runners.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ButtonInteraction,
  EmbedBuilder,
  MessageFlags,
  type TextChannel,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { postPermissionDenied } from "../../lib/permissionCard.js";
import { shouldBypass } from "../../lib/roles.js";
import { ALLOWED_ROLES } from "./shared.js";
import { checkCooldown, formatCooldown, COOLDOWNS } from "../../lib/rateLimiter.js";
import { getActiveSession, cancelSession } from "../../store/auditSessionStore.js";
import { runMembersAudit } from "./members.js";
import { runNsfwAudit } from "./nsfw.js";

/**
 * Handle audit button interactions (Confirm/Cancel/Resume/Fresh)
 *
 * This function handles a horrifying number of button ID formats. I tried to
 * consolidate them but the different audit types need different metadata
 * (scope for NSFW, session IDs for resume). The regex parsing below is the
 * least-bad solution I could come up with.
 */
export async function handleAuditButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guild, channel } = interaction;

  // Parse custom ID formats:
  // - audit:members:confirm:nonce (new audit)
  // - audit:nsfw:all:confirm:nonce (new audit)
  // - audit:nsfw:flagged:confirm:nonce (new audit)
  // - audit:members:none:resume:sessionId:nonce (resume)
  // - audit:nsfw:all:resume:sessionId:nonce (resume)
  // - audit:nsfw:all:fresh:sessionId:nonce (start fresh, cancel old)
  // - audit:nsfw:all:cancel:0:nonce (cancel without starting)
  // These regexes look like line noise but they're pretty straightforward:
  // - membersMatch: audit:members:{action}:{nonce}
  // - nsfwMatch: audit:nsfw:{scope}:{action}:{nonce}
  // - resumeMatch: audit:{type}:{scope}:{action}:{sessionId}:{nonce}
  // If you're adding a new button format, update the parsing below too.
  const membersMatch = customId.match(/^audit:members:(confirm|cancel):([a-f0-9]{8})$/);
  const nsfwMatch = customId.match(/^audit:nsfw:(all|flagged):(confirm|cancel):([a-f0-9]{8})$/);
  const resumeMatch = customId.match(/^audit:(members|nsfw):(all|flagged|none):(resume|fresh|cancel):(\d+):([a-f0-9]{8})$/);

  if (!membersMatch && !nsfwMatch && !resumeMatch) {
    logger.warn({ customId }, "[audit] Invalid button custom ID format");
    await interaction.reply({
      content: "❌ Invalid button ID format.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let subcommand: string;
  let action: string;
  let nonce: string;
  let scope: string | null = null;
  let sessionId: number | null = null;

  if (membersMatch) {
    subcommand = "members";
    action = membersMatch[1];
    nonce = membersMatch[2];
  } else if (nsfwMatch) {
    subcommand = "nsfw";
    scope = nsfwMatch[1];
    action = nsfwMatch[2];
    nonce = nsfwMatch[3];
  } else {
    // Resume/fresh/cancel format
    // The non-null assertions (!) are safe here because we already checked
    // that resumeMatch exists in the if/else chain above. TypeScript just
    // can't track that through the conditional logic.
    subcommand = resumeMatch![1];
    scope = resumeMatch![2] === "none" ? null : resumeMatch![2];
    action = resumeMatch![3];
    sessionId = parseInt(resumeMatch![4], 10);
    nonce = resumeMatch![5];
  }

  if (!guild) {
    await interaction.reply({
      content: "❌ This button can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check permissions again - yes, we already checked in execute(), but buttons
  // can be clicked by anyone who sees the message. Re-checking is paranoid but correct.
  const member = await guild.members.fetch(user.id);
  const hasAllowedRole = member.roles.cache.some((role) => (ALLOWED_ROLES as readonly string[]).includes(role.id));
  const canBypass = shouldBypass(user.id, member);

  if (!hasAllowedRole && !canBypass) {
    await postPermissionDenied(interaction, {
      command: `audit ${subcommand}`,
      description: subcommand === "nsfw"
        ? "Scans member avatars for NSFW content using Google Vision API."
        : "Scans for bot-like accounts using multiple heuristics.",
      requirements: [{ type: "roles", roleIds: ALLOWED_ROLES }],
    });
    return;
  }

  if (action === "cancel") {
    // Disable buttons and update message
    await interaction.update({
      content: "❌ Audit cancelled.",
      embeds: [],
      components: [],
    });
    logger.info({ userId: user.id, guildId: guild.id, subcommand }, "[audit] Audit cancelled by user");
    return;
  }

  // Security: Rate limit expensive audit operations per guild
  // Skip rate limit check for resume (user is continuing existing work)
  // WHY: NSFW audits hit Google Vision API ($$$ and quotas). Member audits
  // just churn CPU, but could still DoS the bot if spammed. One audit per
  // guild per cooldown period keeps things sane.
  if (action !== "resume") {
    const cooldownMs = subcommand === "nsfw" ? COOLDOWNS.AUDIT_NSFW_MS : COOLDOWNS.AUDIT_MEMBERS_MS;
    const cooldownKey = `audit:${subcommand}`;
    const cooldownResult = checkCooldown(cooldownKey, guild.id, cooldownMs);

    if (!cooldownResult.allowed) {
      const remaining = formatCooldown(cooldownResult.remainingMs!);
      await interaction.reply({
        content: `This guild is on cooldown for ${subcommand} audits. Please wait ${remaining} before running another audit.`,
        flags: MessageFlags.Ephemeral,
      });
      logger.info(
        { guildId: guild.id, subcommand, remainingMs: cooldownResult.remainingMs },
        "[audit] Rate limited"
      );
      return;
    }
  }

  // Handle "fresh" - cancel old session and start new
  if (action === "fresh" && sessionId) {
    cancelSession(sessionId);
    logger.info({ sessionId }, "[audit] Cancelled old session for fresh start");
  }

  // For resume, use the existing session
  const resumeSession = action === "resume" && sessionId ? getActiveSession(guild.id, subcommand as "members" | "nsfw") : null;

  logger.info(
    { userId: user.id, guildId: guild.id, nonce, subcommand, scope, action, sessionId, resuming: !!resumeSession },
    "[audit] Audit confirmed, starting scan"
  );

  // Update to show starting message with proper progress bar
  const scopeLabel = scope === "flagged" ? " (flagged only)" : "";
  const resumeLabel = resumeSession ? " (resuming)" : "";
  const startTitle = subcommand === "nsfw"
    ? `🔞 Scanning avatars for NSFW content${scopeLabel}${resumeLabel}...`
    : `🔍 Auditing members${resumeLabel}...`;

  const initialProgress = resumeSession
    ? `Resuming from ${resumeSession.scanned_count.toLocaleString()}/${resumeSession.total_to_scan.toLocaleString()}...`
    : "Starting scan...";

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(startTitle)
        .setDescription(initialProgress)
        .setColor(subcommand === "nsfw" ? 0xE74C3C : 0x3B82F6),
    ],
    components: [],
  });

  // Run the appropriate audit in background (don't await - would timeout with large member counts)
  // CRITICAL: We intentionally fire-and-forget here. Discord interactions expire
  // after 15 minutes, but these audits can run for 30+ minutes on large servers.
  // The .catch() handles failures gracefully without crashing the event loop.
  if (subcommand === "nsfw") {
    runNsfwAudit(interaction, guild, channel as TextChannel, (scope as "all" | "flagged") ?? "all", resumeSession).catch(async (err) => {
      logger.error({ err, guildId: guild.id, scope }, "[audit:nsfw] Background audit failed");

      // Notify user of catastrophic failure
      try {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Audit Failed")
              .setDescription("The NSFW audit encountered a critical error and could not complete. Check logs for details.")
              .setColor(0xE74C3C)
              .setTimestamp()
          ]
        });
      } catch (notifyErr) {
        logger.debug({ err: notifyErr }, "[audit:nsfw] Failed to notify user of audit failure");
      }
    });
  } else {
    runMembersAudit(interaction, guild, channel as TextChannel, resumeSession).catch(async (err) => {
      logger.error({ err, guildId: guild.id }, "[audit:members] Background audit failed");

      // Notify user of catastrophic failure
      try {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Audit Failed")
              .setDescription("The member audit encountered a critical error and could not complete. Check logs for details.")
              .setColor(0xE74C3C)
              .setTimestamp()
          ]
        });
      } catch (notifyErr) {
        logger.debug({ err: notifyErr }, "[audit:members] Failed to notify user of audit failure");
      }
    });
  }
}
