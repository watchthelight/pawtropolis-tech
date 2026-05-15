/**
 * Pawtropolis Tech — src/commands/testidea.ts
 * WHAT: /testidea is a bot-dev-only mass-action toggle. The slash command is
 *       a stable harness; the body of "what gets toggled" lives in
 *       ./testidea/currentAction.ts and is rewritten as new experiments come
 *       and go.
 * WHY: Lets the bot dev trial server-wide changes (today: flatten the staff
 *      sidebar) without coding a fresh slash command each time. The same ON/OFF
 *      switch and snapshot-restore semantics apply to whatever the current
 *      action does.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { isOwner } from "../lib/owner.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import * as currentAction from "./testidea/currentAction.js";
import type { Snapshot } from "./testidea/currentAction.js";

type StateRow = {
  enabled: number;
  snapshot: string | null;
  action_id: string | null;
};

export const data = new SlashCommandBuilder()
  .setName("testidea")
  .setDescription("Toggle the current bot-dev experiment (owner-only)")
  .setDMPermission(false);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "This command can only be used in a server.",
    });
    return;
  }

  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "This command is restricted to the bot developer.",
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const guildId = interaction.guildId;

  const current = db
    .prepare<[string], StateRow>(
      `SELECT enabled, snapshot, action_id FROM testidea_state WHERE guild_id = ?`
    )
    .get(guildId);

  const turningOn = !current || current.enabled === 0;
  const reason = `/testidea ${turningOn ? "on" : "off"} (${currentAction.ACTION_ID}) by ${interaction.user.tag}`;

  if (turningOn) {
    const { applied, failed, snapshot } = await currentAction.apply(guild, reason);
    db.prepare(
      `INSERT INTO testidea_state (guild_id, action_id, enabled, snapshot, updated_at)
       VALUES (?, ?, 1, ?, strftime('%s','now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         action_id = excluded.action_id,
         enabled = 1,
         snapshot = excluded.snapshot,
         updated_at = excluded.updated_at`
    ).run(guildId, currentAction.ACTION_ID, JSON.stringify(snapshot));

    logger.info(
      {
        evt: "testidea_on",
        guildId,
        actionId: currentAction.ACTION_ID,
        actorId: interaction.user.id,
        applied: applied.length,
        failed: failed.length,
        failedIds: failed.map((f) => f.id),
      },
      "[testidea] action applied"
    );

    await interaction.editReply({ content: formatResult("ON", applied, failed) });
    return;
  }

  if (current?.action_id && current.action_id !== currentAction.ACTION_ID) {
    logger.warn(
      {
        evt: "testidea_action_id_mismatch",
        guildId,
        storedActionId: current.action_id,
        currentActionId: currentAction.ACTION_ID,
      },
      "[testidea] cannot revert: snapshot was written by a different action"
    );
    await interaction.editReply({
      content:
        `Snapshot in DB was written by **${current.action_id}** but the current action is **${currentAction.ACTION_ID}**. ` +
        `Refusing to revert with mismatched shape. Restore the matching action file and run /testidea again, ` +
        `or clear \`testidea_state\` manually if the prior action is no longer wanted.`,
    });
    return;
  }

  let snapshot: Snapshot = {};
  if (current?.snapshot) {
    try {
      snapshot = JSON.parse(current.snapshot) as Snapshot;
    } catch (err) {
      logger.warn({ err, guildId }, "[testidea] snapshot parse failed; reverting to defaults");
    }
  }

  const { applied, failed } = await currentAction.revert(guild, snapshot, reason);
  db.prepare(
    `INSERT INTO testidea_state (guild_id, action_id, enabled, snapshot, updated_at)
     VALUES (?, NULL, 0, NULL, strftime('%s','now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       action_id = NULL,
       enabled = 0,
       snapshot = NULL,
       updated_at = excluded.updated_at`
  ).run(guildId);

  logger.info(
    {
      evt: "testidea_off",
      guildId,
      actionId: currentAction.ACTION_ID,
      actorId: interaction.user.id,
      applied: applied.length,
      failed: failed.length,
      failedIds: failed.map((f) => f.id),
    },
    "[testidea] action reverted"
  );

  await interaction.editReply({ content: formatResult("OFF", applied, failed) });
}

function formatResult(
  state: "ON" | "OFF",
  applied: string[],
  failed: Array<{ id: string; err: string }>
): string {
  const lines = [`Test idea is now **${state}**.`];
  lines.push(`Roles updated: **${applied.length}**`);
  if (failed.length > 0) {
    lines.push(`Failed: **${failed.length}**`);
    for (const f of failed.slice(0, 5)) {
      lines.push(`- <@&${f.id}>: ${f.err}`);
    }
    if (failed.length > 5) lines.push(`...and ${failed.length - 5} more`);
    lines.push(
      "_Failures usually mean the bot's role is not above the target role. Move the bot role higher and run /testidea again._"
    );
  }
  return lines.join("\n");
}
