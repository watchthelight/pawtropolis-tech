/**
 * Pawtropolis Tech — src/commands/usebyte.ts
 * WHAT: /usebyte command for self-service byte token redemption
 * WHY: Let users redeem their byte tokens for XP multipliers without staff tickets
 * FLOWS:
 *  - User runs /usebyte → bot checks for byte token roles → shows confirmation
 *  - User clicks Confirm → bot removes token role, adds multiplier role, tracks expiry
 *  - Scheduler auto-removes multiplier when time expires
 * DOCS:
 *  - Discord.js SlashCommandBuilder: https://discord.js.org/#/docs/discord.js/main/class/SlashCommandBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type GuildMember,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "node:crypto";
import {
  getActiveMultiplier,
  checkWouldReplace,
  type TokenRarity,
} from "../store/byteMultiplierStore.js";

// ============================================================================
// Byte Token Configuration
// ============================================================================

/*
 * Role mappings for the byte token system.
 *
 * TOKEN ROLES: What users receive from giveaways/shop (entitlement)
 * MULTIPLIER ROLES: What gives them the XP boost (activated state)
 *
 * Flow: User has Token Role → /usebyte → Token removed, Multiplier granted
 *
 * Duration values from the Reward System channel:
 * - Common: 2x for 12 hours
 * - Rare: 3x for 24 hours
 * - Epic: 5x for 48 hours
 * - Legendary: 5x for 72 hours
 * - Mythic: 10x for 168 hours (1 week)
 */

interface ByteTokenConfig {
  tokenRoleId: string;
  tokenRoleName: string;
  multiplierRoleId: string;
  multiplierRoleName: string;
  multiplierValue: number; // e.g., 2 for 2x
  durationHours: number;
  rarity: TokenRarity;
}

// IMPORTANT: These role IDs are specific to the Pawtropolis server.
// If deploying to other servers, these would need to be configurable.
export const BYTE_TOKEN_CONFIG: Record<TokenRarity, ByteTokenConfig> = {
  common: {
    tokenRoleId: "1385194063841722439",
    tokenRoleName: "Byte Token [Common]",
    multiplierRoleId: "1407484898910011443",
    multiplierRoleName: "[2x] Byte",
    multiplierValue: 2,
    durationHours: 12,
    rarity: "common",
  },
  rare: {
    tokenRoleId: "1385194838890119229",
    tokenRoleName: "Byte Token [Rare]",
    multiplierRoleId: "1408385868414193744",
    multiplierRoleName: "[3x] Byte",
    multiplierValue: 3,
    durationHours: 24,
    rarity: "rare",
  },
  epic: {
    tokenRoleId: "1385195081065173033",
    tokenRoleName: "Byte Token [Epic]",
    multiplierRoleId: "1405369052829974543",
    multiplierRoleName: "[5x] Byte",
    multiplierValue: 5,
    durationHours: 48,
    rarity: "epic",
  },
  legendary: {
    tokenRoleId: "1385054324295733278",
    tokenRoleName: "Byte Token [Legendary]",
    multiplierRoleId: "1405369052829974543", // Same as Epic (5x)
    multiplierRoleName: "[5x] Byte",
    multiplierValue: 5,
    durationHours: 72,
    rarity: "legendary",
  },
  mythic: {
    tokenRoleId: "1385195450856112198",
    tokenRoleName: "Byte Token [Mythic]",
    multiplierRoleId: "1269171052836294787",
    multiplierRoleName: "[x10] Byte",
    multiplierValue: 10,
    durationHours: 168, // 7 days
    rarity: "mythic",
  },
};

// Rarity order from lowest to highest value
const RARITY_ORDER: TokenRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

// ============================================================================
// Command Definition
// ============================================================================

export const data = new SlashCommandBuilder()
  .setName("usebyte")
  .setDescription("Redeem a byte token for an XP multiplier")
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName("rarity")
      .setDescription("Which token to redeem (leave empty to see your options)")
      .setRequired(false)
      .addChoices(
        { name: "Common (2x for 12h)", value: "common" },
        { name: "Rare (3x for 24h)", value: "rare" },
        { name: "Epic (5x for 48h)", value: "epic" },
        { name: "Legendary (5x for 72h)", value: "legendary" },
        { name: "Mythic (10x for 7 days)", value: "mythic" }
      )
  );

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find all byte token roles the member currently has.
 * Returns them sorted by rarity (highest first).
 */
function findMemberByteTokens(member: GuildMember): ByteTokenConfig[] {
  const tokens: ByteTokenConfig[] = [];

  for (const rarity of RARITY_ORDER) {
    const config = BYTE_TOKEN_CONFIG[rarity];
    if (member.roles.cache.has(config.tokenRoleId)) {
      tokens.push(config);
    }
  }

  // Sort by rarity (highest first) for display
  return tokens.reverse();
}

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
// Command Executor
// ============================================================================

/**
 * Get emoji for rarity tier
 */
function getRarityEmoji(rarity: TokenRarity): string {
  const emojis: Record<TokenRarity, string> = {
    common: "⚪",
    rare: "🔵",
    epic: "🟣",
    legendary: "🟡",
    mythic: "🔴",
  };
  return emojis[rarity];
}

/**
 * Build confirmation embed and buttons for a selected token
 */
async function showConfirmation(
  interaction: ChatInputCommandInteraction,
  member: GuildMember,
  selectedToken: ByteTokenConfig,
  userTokens: ByteTokenConfig[],
  wouldReplace: boolean,
  current: { multiplier_name: string; expires_at: number } | null
): Promise<void> {
  const confirmId = randomUUID().slice(0, 8);
  const expiresAt = Math.floor(Date.now() / 1000) + selectedToken.durationHours * 60 * 60;

  const embed = new EmbedBuilder()
    .setTitle("Byte Token Redemption")
    .setColor(wouldReplace ? 0xffaa00 : 0x00cc00)
    .setThumbnail(member.displayAvatarURL({ size: 64 }));

  const descLines: string[] = [
    `**Token:** ${selectedToken.tokenRoleName}`,
    `**Multiplier:** ${selectedToken.multiplierValue}x XP`,
    `**Duration:** ${formatDuration(selectedToken.durationHours)}`,
    `**Expires:** <t:${expiresAt}:R>`,
    "",
  ];

  // Show other tokens if user has multiple
  const otherTokens = userTokens.filter((t) => t.rarity !== selectedToken.rarity);
  if (otherTokens.length > 0) {
    const otherNames = otherTokens.map((t) => t.tokenRoleName).join(", ");
    descLines.push(`*You also have: ${otherNames}*`);
    descLines.push("");
  }

  // Warning if replacing active multiplier
  if (wouldReplace && current) {
    descLines.push(
      `**Warning:** You have an active ${current.multiplier_name} ` +
        `(expires <t:${current.expires_at}:R>). ` +
        `Redeeming this token will **replace** your current multiplier.`
    );
  }

  embed.setDescription(descLines.join("\n"));

  // Build buttons
  // Format: usebyte:CONFIRM_ID:ACTION:USER_ID:RARITY
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`usebyte:${confirmId}:confirm:${member.id}:${selectedToken.rarity}`)
      .setLabel(`Redeem ${selectedToken.multiplierValue}x Multiplier`)
      .setStyle(wouldReplace ? ButtonStyle.Primary : ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`usebyte:${confirmId}:cancel:${member.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("❌")
  );

  await interaction.reply({
    embeds: [embed],
    components: [buttons],
    ephemeral: true,
  });

  logger.info(
    {
      guildId: interaction.guildId,
      userId: member.id,
      tokenRarity: selectedToken.rarity,
      wouldReplace,
      confirmId,
    },
    "[usebyte] Confirmation shown"
  );
}

/**
 * Execute /usebyte command
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guild = interaction.guild;
  const member = interaction.member as GuildMember | null;

  if (!guild || !member) {
    await interaction.reply({
      content: "This command must be run in a server.",
      ephemeral: true,
    });
    return;
  }

  // Get optional rarity selection from command
  const selectedRarity = interaction.options.getString("rarity") as TokenRarity | null;

  // Find all byte tokens the user has
  const userTokens = await withStep(ctx, "find_tokens", () => {
    return findMemberByteTokens(member);
  });

  // If user specified a rarity, check if they have that token
  if (selectedRarity) {
    const requestedToken = BYTE_TOKEN_CONFIG[selectedRarity];
    const hasToken = userTokens.some((t) => t.rarity === selectedRarity);

    if (!hasToken) {
      await interaction.reply({
        content:
          `You don't have a **${requestedToken.tokenRoleName}** to redeem.\n\n` +
          (userTokens.length > 0
            ? `You currently have: ${userTokens.map((t) => t.tokenRoleName).join(", ")}`
            : "You don't have any byte tokens. Byte tokens can be earned from giveaways, events, level rewards, and the Paw Bank shop."),
        ephemeral: true,
      });
      return;
    }

    // User has the requested token - show confirmation
    const { wouldReplace, current } = await withStep(ctx, "check_replace", () => {
      return checkWouldReplace(guild.id, member.id);
    });

    await withStep(ctx, "show_confirmation", async () => {
      await showConfirmation(interaction, member, requestedToken, userTokens, wouldReplace, current);
    });
    return;
  }

  // No rarity specified - check what tokens user has
  if (userTokens.length === 0) {
    await interaction.reply({
      content:
        "You don't have any byte tokens to redeem.\n\n" +
        "Byte tokens can be earned from:\n" +
        "• Giveaways\n" +
        "• Event rewards\n" +
        "• Level up rewards\n" +
        "• The Paw Bank shop",
      ephemeral: true,
    });
    return;
  }

  // If user has exactly one token, go straight to confirmation
  if (userTokens.length === 1) {
    const { wouldReplace, current } = await withStep(ctx, "check_replace", () => {
      return checkWouldReplace(guild.id, member.id);
    });

    await withStep(ctx, "show_confirmation", async () => {
      await showConfirmation(interaction, member, userTokens[0], userTokens, wouldReplace, current);
    });
    return;
  }

  // Multiple tokens - show select menu
  await withStep(ctx, "show_select_menu", async () => {
    const selectId = randomUUID().slice(0, 8);

    const embed = new EmbedBuilder()
      .setTitle("Select a Byte Token")
      .setColor(0x5865f2)
      .setDescription(
        "You have multiple byte tokens! Choose which one to redeem.\n\n" +
          "**Your tokens:**\n" +
          userTokens
            .map(
              (t) =>
                `${getRarityEmoji(t.rarity)} **${t.tokenRoleName}** — ${t.multiplierValue}x XP for ${formatDuration(t.durationHours)}`
            )
            .join("\n")
      );

    // Build select menu with user's available tokens
    // Format: usebyte:SELECT_ID:select:USER_ID
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`usebyte:${selectId}:select:${member.id}`)
      .setPlaceholder("Choose a token to redeem...")
      .addOptions(
        userTokens.map((t) => ({
          label: t.tokenRoleName,
          description: `${t.multiplierValue}x XP for ${formatDuration(t.durationHours)}`,
          value: t.rarity,
          emoji: getRarityEmoji(t.rarity),
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });

    logger.info(
      {
        guildId: guild.id,
        userId: member.id,
        availableTokens: userTokens.map((t) => t.rarity),
        selectId,
      },
      "[usebyte] Token selection menu shown"
    );
  });
}
