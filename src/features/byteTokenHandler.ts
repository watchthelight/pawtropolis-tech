/**
 * Pawtropolis Tech — src/features/byteTokenHandler.ts
 * WHAT: Button and select menu handler for byte token redemption
 * WHY: Process confirm/cancel buttons and token selection from /usebyte command
 * FLOWS:
 *  - usebyte:HASH:confirm:USER:RARITY → verify → remove token → add multiplier → track
 *  - usebyte:HASH:cancel:USER → dismiss embed
 *  - usebyte:HASH:select:USER (select menu) → show confirmation for selected token
 * DOCS:
 *  - Discord.js ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 *  - Discord.js StringSelectMenuInteraction: https://discord.js.org/#/docs/discord.js/main/class/StringSelectMenuInteraction
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ButtonInteraction, StringSelectMenuInteraction, GuildMember } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { isPanicMode } from "./panicStore.js";
import { canManageRole } from "./roleAutomation.js";
import { logActionPretty } from "../logging/pretty.js";
import {
  upsertActiveMultiplier,
  getActiveMultiplier,
  checkWouldReplace,
  type TokenRarity,
} from "../store/byteMultiplierStore.js";
import { BYTE_TOKEN_CONFIG } from "../commands/usebyte.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * All possible multiplier role IDs that could be on a user.
 * We need this list to remove ALL multiplier roles before adding a new one,
 * not just the one tracked in the database. This prevents stacking where
 * a user could end up with multiple multiplier roles.
 */
const ALL_MULTIPLIER_ROLE_IDS = [
  ...new Set(Object.values(BYTE_TOKEN_CONFIG).map((c) => c.multiplierRoleId)),
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format duration for display (e.g., "12 hours", "7 days")
 */
function formatDuration(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "1 day" : `${days} days`;
  }
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

// ============================================================================
// Types
// ============================================================================

interface ParsedByteButton {
  confirmId: string;
  action: "confirm" | "cancel";
  userId: string;
  rarity?: TokenRarity;
}

// ============================================================================
// Button Parser
// ============================================================================

/**
 * Parse a usebyte button customId.
 * Format: usebyte:HASH:ACTION:USER_ID[:RARITY]
 */
function parseByteButton(customId: string): ParsedByteButton | null {
  const parts = customId.split(":");

  if (parts.length < 4 || parts[0] !== "usebyte") {
    return null;
  }

  const [, confirmId, action, userId, rarity] = parts;

  if (action !== "confirm" && action !== "cancel") {
    return null;
  }

  return {
    confirmId,
    action,
    userId,
    rarity: rarity as TokenRarity | undefined,
  };
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle usebyte button interactions.
 */
export async function handleUseByteButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseByteButton(interaction.customId);

  if (!parsed) {
    logger.warn(
      { customId: interaction.customId },
      "[byteToken] Failed to parse button customId"
    );
    await interaction.reply({
      content: "Invalid button data. Please try running `/usebyte` again.",
      ephemeral: true,
    });
    return;
  }

  // SECURITY: Verify the user clicking is the one who initiated
  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({
      content: "This button isn't for you.",
      ephemeral: true,
    });
    return;
  }

  if (parsed.action === "cancel") {
    await handleCancel(interaction);
    return;
  }

  if (parsed.action === "confirm") {
    await handleConfirm(interaction, parsed);
    return;
  }
}

// ============================================================================
// Cancel Handler
// ============================================================================

async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("Redemption Cancelled")
        .setDescription("No changes were made. Your byte token is still available.")
        .setColor(0x808080),
    ],
    components: [],
  });

  logger.info(
    { userId: interaction.user.id, guildId: interaction.guildId },
    "[byteToken] Redemption cancelled by user"
  );
}

// ============================================================================
// Confirm Handler
// ============================================================================

async function handleConfirm(
  interaction: ButtonInteraction,
  parsed: ParsedByteButton
): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild || !member) {
    await interaction.reply({
      content: "This command must be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Defer update immediately (gives us 15 minutes to respond)
  await interaction.deferUpdate();

  // Get token configuration
  if (!parsed.rarity || !BYTE_TOKEN_CONFIG[parsed.rarity]) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Error")
          .setDescription("Invalid token rarity. Please try running `/usebyte` again.")
          .setColor(0xff0000),
      ],
      components: [],
    });
    return;
  }

  const tokenConfig = BYTE_TOKEN_CONFIG[parsed.rarity];

  // SECURITY: Check panic mode
  if (isPanicMode(guild.id)) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Temporarily Unavailable")
          .setDescription(
            "Role automation is currently paused. " +
              "Please try again later or contact staff."
          )
          .setColor(0xff0000),
      ],
      components: [],
    });

    logger.warn(
      { guildId: guild.id, userId: interaction.user.id },
      "[byteToken] Redemption blocked by panic mode"
    );
    return;
  }

  // SECURITY: Pre-flight permission checks
  const tokenRoleCheck = await canManageRole(guild, tokenConfig.tokenRoleId);
  if (!tokenRoleCheck.canManage) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Permission Error")
          .setDescription(
            `Cannot manage token role: ${tokenRoleCheck.reason}\n\n` +
              "Please contact staff to resolve this issue."
          )
          .setColor(0xff0000),
      ],
      components: [],
    });

    logger.error(
      { guildId: guild.id, roleId: tokenConfig.tokenRoleId, reason: tokenRoleCheck.reason },
      "[byteToken] Cannot manage token role"
    );
    return;
  }

  const multiplierRoleCheck = await canManageRole(guild, tokenConfig.multiplierRoleId);
  if (!multiplierRoleCheck.canManage) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Permission Error")
          .setDescription(
            `Cannot manage multiplier role: ${multiplierRoleCheck.reason}\n\n` +
              "Please contact staff to resolve this issue."
          )
          .setColor(0xff0000),
      ],
      components: [],
    });

    logger.error(
      { guildId: guild.id, roleId: tokenConfig.multiplierRoleId, reason: multiplierRoleCheck.reason },
      "[byteToken] Cannot manage multiplier role"
    );
    return;
  }

  // Fetch fresh member data to verify they still have the token
  const guildMember = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!guildMember) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Error")
          .setDescription("Could not verify your membership. Please try again.")
          .setColor(0xff0000),
      ],
      components: [],
    });
    return;
  }

  // Verify user still has the token role
  if (!guildMember.roles.cache.has(tokenConfig.tokenRoleId)) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Token Not Found")
          .setDescription(
            `You no longer have the ${tokenConfig.tokenRoleName} role.\n\n` +
              "It may have been removed or already redeemed."
          )
          .setColor(0xffaa00),
      ],
      components: [],
    });

    logger.warn(
      { guildId: guild.id, userId: interaction.user.id, rarity: parsed.rarity },
      "[byteToken] User no longer has token role"
    );
    return;
  }

  // Check for existing active multiplier (for logging purposes)
  const existingMultiplier = getActiveMultiplier(guild.id, interaction.user.id);
  const isUpgrade = existingMultiplier !== null;

  // Calculate expiration time
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + tokenConfig.durationHours * 60 * 60;

  try {
    // Step 1: Remove token role
    await guildMember.roles.remove(
      tokenConfig.tokenRoleId,
      `Byte token redeemed for ${tokenConfig.multiplierRoleName}`
    );

    // Step 2: Remove ALL existing multiplier roles to prevent stacking
    // This removes any multiplier roles the user has, whether from DB or manual grants
    const rolesToRemove = ALL_MULTIPLIER_ROLE_IDS.filter(
      (roleId) =>
        roleId !== tokenConfig.multiplierRoleId && // Don't remove the one we're about to add
        guildMember.roles.cache.has(roleId)
    );

    if (rolesToRemove.length > 0) {
      logger.info(
        {
          guildId: guild.id,
          userId: interaction.user.id,
          rolesToRemove,
        },
        "[byteToken] Removing existing multiplier roles to prevent stacking"
      );

      for (const roleId of rolesToRemove) {
        await guildMember.roles.remove(roleId, "Replaced by new byte multiplier").catch((err) => {
          logger.warn(
            { err, guildId: guild.id, roleId },
            "[byteToken] Failed to remove existing multiplier role"
          );
        });
      }
    }

    // Step 3: Add multiplier role
    await guildMember.roles.add(
      tokenConfig.multiplierRoleId,
      `${tokenConfig.tokenRoleName} redeemed - expires in ${tokenConfig.durationHours}h`
    );

    // Step 3.5: Post-add cleanup for race conditions
    // If user clicked multiple confirm buttons rapidly, another request might have added
    // a different multiplier role between our "remove" check and "add". Clean up now.
    // Refetch member to see current roles
    const freshMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (freshMember) {
      const staleRoles = ALL_MULTIPLIER_ROLE_IDS.filter(
        (roleId) =>
          roleId !== tokenConfig.multiplierRoleId &&
          freshMember.roles.cache.has(roleId)
      );
      if (staleRoles.length > 0) {
        logger.warn(
          {
            guildId: guild.id,
            userId: interaction.user.id,
            staleRoles,
          },
          "[byteToken] Race condition detected - removing stale multiplier roles"
        );
        for (const roleId of staleRoles) {
          await freshMember.roles.remove(roleId, "Race condition cleanup").catch((err) => {
            logger.warn(
              { err, guildId: guild.id, roleId },
              "[byteToken] Failed to remove stale multiplier role"
            );
          });
        }
      }
    }

    // Step 4: Track in database
    upsertActiveMultiplier({
      guildId: guild.id,
      userId: interaction.user.id,
      multiplierRoleId: tokenConfig.multiplierRoleId,
      multiplierName: tokenConfig.multiplierRoleName,
      multiplierValue: tokenConfig.multiplierValue,
      expiresAt,
      tokenRarity: tokenConfig.rarity,
      redeemedBy: interaction.user.id,
    });

    // Step 5: Log to audit trail
    await logActionPretty(guild, {
      actorId: interaction.user.id,
      subjectId: interaction.user.id,
      action: "role_grant", // Will update to byte_token_redeemed once action type is added
      reason: `Redeemed ${tokenConfig.tokenRoleName} for ${tokenConfig.multiplierRoleName}`,
      meta: {
        tokenRarity: tokenConfig.rarity,
        multiplierValue: tokenConfig.multiplierValue,
        durationHours: tokenConfig.durationHours,
        expiresAt,
        wasUpgrade: isUpgrade,
        previousMultiplier: existingMultiplier?.multiplier_name ?? null,
      },
    }).catch((err) => {
      logger.warn({ err, guildId: guild.id }, "[byteToken] Failed to log redemption");
    });

    // Success!
    const embed = new EmbedBuilder()
      .setTitle("Byte Token Redeemed!")
      .setColor(0x00cc00)
      .setDescription(
        [
          `**Multiplier:** ${tokenConfig.multiplierValue}x XP`,
          `**Duration:** ${tokenConfig.durationHours} hours`,
          `**Expires:** <t:${expiresAt}:R>`,
          "",
          "Enjoy your XP boost!",
        ].join("\n")
      );

    if (isUpgrade) {
      embed.setFooter({ text: "Note: Your previous multiplier was replaced." });
    }

    await interaction.editReply({
      embeds: [embed],
      components: [],
    });

    logger.info(
      {
        guildId: guild.id,
        userId: interaction.user.id,
        rarity: tokenConfig.rarity,
        multiplierValue: tokenConfig.multiplierValue,
        durationHours: tokenConfig.durationHours,
        expiresAt,
        wasUpgrade: isUpgrade,
      },
      "[byteToken] Token redeemed successfully"
    );
  } catch (err) {
    logger.error(
      { err, guildId: guild.id, userId: interaction.user.id, rarity: parsed.rarity },
      "[byteToken] Failed to redeem token"
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Redemption Failed")
          .setDescription(
            "An error occurred while processing your redemption.\n\n" +
              "Please try again or contact staff if the problem persists."
          )
          .setColor(0xff0000),
      ],
      components: [],
    });
  }
}

// ============================================================================
// Select Menu Handler
// ============================================================================

/**
 * Handle usebyte select menu interactions.
 * Shows confirmation embed for the selected token.
 */
export async function handleUseByteSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const customId = interaction.customId;
  const parts = customId.split(":");

  // Format: usebyte:HASH:select:USER_ID
  if (parts.length < 4 || parts[0] !== "usebyte" || parts[2] !== "select") {
    logger.warn({ customId }, "[byteToken] Invalid select menu customId");
    await interaction.reply({
      content: "Invalid selection. Please try running `/usebyte` again.",
      ephemeral: true,
    });
    return;
  }

  const userId = parts[3];

  // SECURITY: Verify the user interacting is the one who initiated
  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: "This selection isn't for you.",
      ephemeral: true,
    });
    return;
  }

  // Get selected rarity from the menu
  const selectedRarity = interaction.values[0] as TokenRarity;

  if (!selectedRarity || !BYTE_TOKEN_CONFIG[selectedRarity]) {
    await interaction.reply({
      content: "Invalid token selection. Please try running `/usebyte` again.",
      ephemeral: true,
    });
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member as GuildMember | null;

  if (!guild || !member) {
    await interaction.reply({
      content: "This must be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const tokenConfig = BYTE_TOKEN_CONFIG[selectedRarity];

  // Verify user still has the selected token role
  const guildMember = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!guildMember || !guildMember.roles.cache.has(tokenConfig.tokenRoleId)) {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Token Not Found")
          .setDescription(
            `You don't have the **${tokenConfig.tokenRoleName}** role.\n\n` +
              "It may have been removed or already redeemed."
          )
          .setColor(0xffaa00),
      ],
      components: [],
    });
    return;
  }

  // Check if user has an active multiplier that would be replaced
  const { wouldReplace, current } = checkWouldReplace(guild.id, member.id);

  // Build confirmation embed
  const confirmId = randomUUID().slice(0, 8);
  const expiresAt = Math.floor(Date.now() / 1000) + tokenConfig.durationHours * 60 * 60;

  const embed = new EmbedBuilder()
    .setTitle("Byte Token Redemption")
    .setColor(wouldReplace ? 0xffaa00 : 0x00cc00)
    .setThumbnail(guildMember.displayAvatarURL({ size: 64 }));

  const descLines: string[] = [
    `**Token:** ${tokenConfig.tokenRoleName}`,
    `**Multiplier:** ${tokenConfig.multiplierValue}x XP`,
    `**Duration:** ${formatDuration(tokenConfig.durationHours)}`,
    `**Expires:** <t:${expiresAt}:R>`,
    "",
  ];

  // Warning if replacing active multiplier
  if (wouldReplace && current) {
    descLines.push(
      `**Warning:** You have an active ${current.multiplier_name} ` +
        `(expires <t:${current.expires_at}:R>). ` +
        `Redeeming this token will **replace** your current multiplier.`
    );
  }

  embed.setDescription(descLines.join("\n"));

  // Build confirm/cancel buttons
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`usebyte:${confirmId}:confirm:${member.id}:${selectedRarity}`)
      .setLabel(`Redeem ${tokenConfig.multiplierValue}x Multiplier`)
      .setStyle(wouldReplace ? ButtonStyle.Primary : ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`usebyte:${confirmId}:cancel:${member.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("❌")
  );

  await interaction.update({
    embeds: [embed],
    components: [buttons],
  });

  logger.info(
    {
      guildId: guild.id,
      userId: member.id,
      selectedRarity,
      wouldReplace,
      confirmId,
    },
    "[byteToken] Token selected, showing confirmation"
  );
}
