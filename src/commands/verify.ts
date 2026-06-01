/**
 * Pawtropolis Tech — src/commands/verify.ts
 * WHAT: /verify command for first responder & military honor-system verification.
 * WHY: Lets users self-verify via DM and receive the Thin Line cosmetic role.
 * FLOWS:
 *  - Check if already verified → DM disclaimer + category select → optional doc upload → finalize → grant role → log embed
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type TextChannel,
  MessageFlags,
  ComponentType,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";

const VERIFIED_ROLE_ID = process.env.IDME_VERIFIED_ROLE_ID;
// Channel where uploaded badges/IDs are posted for staff review. Configurable via
// VERIFY_LOG_CHANNEL_ID so a deleted/moved channel can be repointed without a code
// change; falls back to the original hardcoded channel to preserve current behavior.
const DEFAULT_LOG_CHANNEL_ID = "1430015254053654599";
const LOG_CHANNEL_ID = env.VERIFY_LOG_CHANNEL_ID ?? DEFAULT_LOG_CHANNEL_ID;

const CATEGORIES = [
  { label: "Firefighter", value: "firefighter" },
  { label: "EMT", value: "emt" },
  { label: "Paramedic", value: "paramedic" },
  { label: "Military (Foreign and Domestic)", value: "military" },
  { label: "Law Enforcement", value: "law_enforcement" },
];

interface VerifiedRow {
  category: string;
  verified_at: number;
}

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify your first responder or military status")
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!VERIFIED_ROLE_ID) {
    await interaction.editReply({
      content: "Verification is not configured yet.",
    });
    return;
  }

  // Check if already verified
  const existing = await withStep(ctx, "check_existing", async () => {
    return db
      .prepare(
        "SELECT category, verified_at FROM verified_users WHERE guild_id = ? AND discord_user_id = ?"
      )
      .get(guildId, userId) as VerifiedRow | undefined;
  });

  if (existing) {
    const categoryLabel = CATEGORIES.find((c) => c.value === existing.category)?.label ?? existing.category;
    const verifiedDate = new Date(existing.verified_at * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // The DB row exists, but a prior run may have failed to grant the role.
    // Re-attempt the grant so the user can recover the role without being told
    // they already have it when they do not.
    let hasRole = true;
    try {
      const guild = interaction.guild!;
      const member = await guild.members.fetch(userId);
      if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
        await member.roles.add(VERIFIED_ROLE_ID, `Thin Line verification: ${categoryLabel}`);
      }
    } catch (err) {
      hasRole = false;
      logger.error({ err, userId }, "[verify] failed to re-grant Thin Line role on re-run");
    }

    await interaction.editReply({
      content: hasRole
        ? `You're already verified as **${categoryLabel}** (${verifiedDate}). You have the Thin Line role.`
        : `You're already verified as **${categoryLabel}** (${verifiedDate}), but I couldn't grant the Thin Line role. Please contact staff.`,
    });
    return;
  }

  // Try to DM the user
  let dmChannel;
  try {
    dmChannel = await interaction.user.createDM();
  } catch {
    await interaction.editReply({
      content: "I couldn't DM you. Please enable DMs from server members and try again.",
    });
    return;
  }

  // ── Step 1: Disclaimer + category select ──

  const disclaimer =
    "The following questions will not determine your verification, they are simply for internal records.\n\n" +
    "**Please do not apply for this role if you are not a Firefighter, EMT, Paramedic, Military (Foreign and Domestic), or Law Enforcement.**\n\n" +
    "Misuse of the honor system will result in two warns up to a ban.";

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("verify_category")
      .setPlaceholder("Which field of work applies to you?")
      .addOptions(CATEGORIES)
  );

  let dmMessage;
  try {
    dmMessage = await dmChannel.send({
      content: disclaimer,
      components: [selectRow],
    });
  } catch {
    await interaction.editReply({
      content: "I couldn't send you a DM. Please enable DMs from server members and try again.",
    });
    return;
  }

  await interaction.editReply({ content: "Check your DMs!" });

  // Await the select menu response (5 minute timeout)
  let categoryInteraction;
  try {
    categoryInteraction = await dmMessage.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.customId === "verify_category" && i.user.id === userId,
      time: 5 * 60 * 1000,
    });
  } catch {
    await dmMessage.edit({ content: `${disclaimer}\n\n*Verification timed out. Run /verify again to restart.*`, components: [] });
    return;
  }

  const category = categoryInteraction.values[0]!;
  const categoryLabel = CATEGORIES.find((c) => c.value === category)?.label ?? category;

  // ── Step 2: Optional document upload ──

  const uploadPrompt =
    `You selected **${categoryLabel}**.\n\n` +
    "If you'd like, you can upload verification documents (badge, ID, etc.) for our records. " +
    "**This is completely optional.** If you do upload, please **redact any personally identifying information** (name, address, DOB, etc.).\n\n" +
    "Send any images here now, or click **Finalize** when you're done.";

  const finalizeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_finalize")
      .setLabel("Finalize")
      .setStyle(ButtonStyle.Success)
  );

  await categoryInteraction.update({ content: disclaimer + `\n\n> Selected: **${categoryLabel}**`, components: [] });
  const uploadMessage = await dmChannel.send({ content: uploadPrompt, components: [finalizeRow] });

  // Collect uploaded images until the user clicks Finalize (5 minute window)
  const uploadedImages: { url: string; name: string }[] = [];

  const messageCollector = dmChannel.createMessageCollector({
    filter: (m) => m.author.id === userId && m.attachments.size > 0,
    time: 5 * 60 * 1000,
  });

  messageCollector.on("collect", async (msg) => {
    for (const [, attachment] of msg.attachments) {
      if (attachment.contentType?.startsWith("image/")) {
        uploadedImages.push({ url: attachment.url, name: attachment.name ?? "document" });
      }
    }
    const count = uploadedImages.length;
    try {
      await msg.reply({ content: `Received ${count} document${count !== 1 ? "s" : ""} so far. Send more or click **Finalize** when done.` });
    } catch { /* best effort */ }
  });

  // Wait for Finalize button
  try {
    const finalizeInteraction = await uploadMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "verify_finalize" && i.user.id === userId,
      time: 5 * 60 * 1000,
    });
    // Every component interaction must be acknowledged within 3s or the user sees
    // a red "This interaction failed", even though we still finalize server-side.
    await finalizeInteraction.deferUpdate().catch(() => undefined);
  } catch {
    messageCollector.stop();
    await uploadMessage.edit({ content: `${uploadPrompt}\n\n*Verification timed out. Run /verify again to restart.*`, components: [] });
    return;
  }

  messageCollector.stop();
  await uploadMessage.edit({ content: uploadPrompt, components: [] });

  // ── Step 3: Grant role, then insert record ──

  // Grant the role FIRST. If the grant fails (missing Manage Roles, role above
  // the bot, transient API error), abort before writing the DB row so the user
  // is not permanently recorded as verified without ever receiving the role.
  let roleGranted = false;
  try {
    const guild = interaction.guild!;
    const member = await guild.members.fetch(userId);
    if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
      await member.roles.add(VERIFIED_ROLE_ID, `Thin Line verification: ${categoryLabel}`);
    }
    roleGranted = true;
  } catch (err) {
    logger.error({ err, userId, category }, "[verify] failed to grant Thin Line role");
  }

  if (!roleGranted) {
    await dmChannel.send(
      "I couldn't grant the **Thin Line** role right now. Verification was not completed. Please try again later or contact staff."
    );
    return;
  }

  try {
    db
      .prepare("INSERT INTO verified_users (guild_id, discord_user_id, category) VALUES (?, ?, ?)")
      .run(guildId, userId, category);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const isDuplicate =
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      (err instanceof Error && err.message.includes("UNIQUE constraint failed"));
    if (isDuplicate) {
      logger.warn({ err, userId, category }, "[verify] duplicate verification attempt");
      await dmChannel.send("You're already verified!");
      return;
    }
    logger.error({ err, userId, category }, "[verify] failed to record verification");
    await dmChannel.send(
      "Something went wrong recording your verification. Please try again later or contact staff."
    );
    return;
  }

  await dmChannel.send("Thank you for your service. You have been given the **Thin Line** role.");

  // ── Step 4: Log embed to channel ──

  try {
    const guild = interaction.guild!;
    const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID) as TextChannel | null;
    if (!logChannel) {
      logger.warn(
        { userId, channelId: LOG_CHANNEL_ID, docs: uploadedImages.length },
        "[verify] verification log channel not found; review embed not posted (set VERIFY_LOG_CHANNEL_ID to repoint)"
      );
    }
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setTitle("Thin Line Verification")
        .setColor(0x2b5797)
        .addFields(
          { name: "User", value: `<@${userId}> (${interaction.user.username})`, inline: true },
          { name: "Category", value: categoryLabel, inline: true },
          { name: "Role Granted", value: roleGranted ? "Yes" : "Failed", inline: true },
          { name: "Documents", value: uploadedImages.length > 0 ? `${uploadedImages.length} uploaded` : "None provided", inline: true },
        )
        .setThumbnail(interaction.user.displayAvatarURL({ size: 64 }))
        .setTimestamp();

      // Attach first uploaded image as the embed image if provided
      if (uploadedImages.length > 0) {
        embed.setImage(uploadedImages[0]!.url);
      }

      await logChannel.send({ embeds: [embed] });

      // Send additional images as follow-up embeds (Discord limits 1 image per embed)
      for (let i = 1; i < uploadedImages.length; i++) {
        const extraEmbed = new EmbedBuilder()
          .setTitle(`Document ${i + 1} — ${interaction.user.username}`)
          .setColor(0x2b5797)
          .setImage(uploadedImages[i]!.url);
        await logChannel.send({ embeds: [extraEmbed] });
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, "[verify] failed to send log embed");
  }

  logger.info(
    { evt: "thin_line_verify", userId, category: categoryLabel, roleGranted, docs: uploadedImages.length },
    "[verify] verification completed"
  );
}
