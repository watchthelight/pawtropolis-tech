/**
 * Pawtropolis Tech -- src/commands/config/invite.ts
 * WHAT: Handlers for /config invite label/unlabel/list
 * WHY: Allows admins to label invite links with friendly source names
 *      (e.g. "Disboard", "TikTok") that appear on review cards.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  withStep,
  logger,
  db,
} from "./shared.js";

/** Extract invite code from a link or raw code. */
function parseInviteCode(input: string): string {
  // Strip common URL prefixes
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?discord\.(gg|com\/invite)\//i, "")
    .replace(/\s+.*$/, ""); // Remove anything after whitespace
}

/** /config invite label <link> <name> */
export async function executeInviteLabel(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const rawLink = interaction.options.getString("link", true);
  const label = interaction.options.getString("name", true).trim();
  const code = parseInviteCode(rawLink);

  if (!code || code.length < 2) {
    await replyOrEdit(interaction, { content: "Invalid invite link or code." });
    return;
  }

  if (label.length > 50) {
    await replyOrEdit(interaction, { content: "Label must be 50 characters or less." });
    return;
  }

  await withStep(ctx, "upsert_label", async () => {
    db.prepare(
      `INSERT OR REPLACE INTO invite_label (guild_id, invite_code, label) VALUES (?, ?, ?)`
    ).run(interaction.guildId!, code, label);
  });

  logger.info(
    { guildId: interaction.guildId, code, label, userId: interaction.user.id },
    "[config] invite label set"
  );

  await replyOrEdit(interaction, {
    content: `Labeled \`discord.gg/${code}\` as **${label}**. This will appear on review cards for members who joined via this invite.`,
  });
}

/** /config invite unlabel <link> */
export async function executeInviteUnlabel(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const rawLink = interaction.options.getString("link", true);
  const code = parseInviteCode(rawLink);

  if (!code || code.length < 2) {
    await replyOrEdit(interaction, { content: "Invalid invite link or code." });
    return;
  }

  await withStep(ctx, "delete_label", async () => {
    const result = db.prepare(
      `DELETE FROM invite_label WHERE guild_id = ? AND invite_code = ?`
    ).run(interaction.guildId!, code);

    if (result.changes === 0) {
      await replyOrEdit(interaction, { content: `No label found for \`discord.gg/${code}\`.` });
      return;
    }

    logger.info(
      { guildId: interaction.guildId, code, userId: interaction.user.id },
      "[config] invite label removed"
    );

    await replyOrEdit(interaction, {
      content: `Removed label from \`discord.gg/${code}\`.`,
    });
  });
}

/** /config invite list */
export async function executeInviteList(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const rows = db.prepare(
    `SELECT invite_code, label FROM invite_label WHERE guild_id = ? ORDER BY label`
  ).all(interaction.guildId!) as Array<{ invite_code: string; label: string }>;

  if (rows.length === 0) {
    await replyOrEdit(interaction, {
      content: "No invite labels configured. Use `/config invite label` to add one.",
    });
    return;
  }

  const lines = rows.map(r => `**${r.label}**: \`discord.gg/${r.invite_code}\``);
  await replyOrEdit(interaction, {
    content: `**Labeled Invites (${rows.length})**\n${lines.join("\n")}`,
  });
}
