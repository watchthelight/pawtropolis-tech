/**
 * Pawtropolis Tech — src/commands/testidea.ts
 * WHAT: /testidea toggles a staff-display experiment. ON unhoists every staff
 *       hierarchy role and hoists only "Community Staff" (MOD_TEAM); OFF restores
 *       the prior hoist flags captured when the experiment was turned on.
 * WHY: Lets staff trial the "flat sidebar" idea proposed in chat (unhoist all
 *      ranks, hoist a single Community Staff role) without manually editing roles.
 * FLOWS:
 *  - Permission check (SENIOR_ADMIN+) → read testidea_state row →
 *    if enabled: restore snapshot, clear row → reply
 *    else: snapshot current hoist flags, set hierarchy hoist=false +
 *          MOD_TEAM hoist=true, persist snapshot → reply
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type Role,
} from "discord.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { ROLE_IDS } from "../lib/config.js";
import { ROLE_HIERARCHY } from "../lib/roles.js";
import { isOwner } from "../lib/owner.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

const HOIST_ROLE = ROLE_IDS.MOD_TEAM;
const UNHOIST_ROLES = ROLE_HIERARCHY.filter((id) => id !== HOIST_ROLE);

type StateRow = { enabled: number; snapshot: string | null };
type Snapshot = Record<string, boolean>;

export const data = new SlashCommandBuilder()
  .setName("testidea")
  .setDescription("Toggle the flat-sidebar staff hoist experiment")
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
      `SELECT enabled, snapshot FROM testidea_state WHERE guild_id = ?`
    )
    .get(guildId);

  const turningOn = !current || current.enabled === 0;
  const reason = `/testidea ${turningOn ? "on" : "off"} by ${interaction.user.tag}`;

  if (turningOn) {
    const { applied, failed, snapshot } = await applyExperiment(guild, reason);
    db.prepare(
      `INSERT INTO testidea_state (guild_id, enabled, snapshot, updated_at)
       VALUES (?, 1, ?, strftime('%s','now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         enabled = 1,
         snapshot = excluded.snapshot,
         updated_at = excluded.updated_at`
    ).run(guildId, JSON.stringify(snapshot));

    logger.info(
      { evt: "testidea_on", guildId, applied: applied.length, failed: failed.length },
      "[testidea] experiment enabled"
    );

    await interaction.editReply({
      content: formatResult("ON", applied, failed),
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

  const { applied, failed } = await revertExperiment(guild, snapshot, reason);
  db.prepare(
    `INSERT INTO testidea_state (guild_id, enabled, snapshot, updated_at)
     VALUES (?, 0, NULL, strftime('%s','now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       enabled = 0,
       snapshot = NULL,
       updated_at = excluded.updated_at`
  ).run(guildId);

  logger.info(
    { evt: "testidea_off", guildId, applied: applied.length, failed: failed.length },
    "[testidea] experiment disabled"
  );

  await interaction.editReply({
    content: formatResult("OFF", applied, failed),
  });
}

async function applyExperiment(guild: Guild, reason: string) {
  const applied: string[] = [];
  const failed: Array<{ id: string; err: string }> = [];
  const snapshot: Snapshot = {};

  for (const roleId of UNHOIST_ROLES) {
    const role = await fetchRole(guild, roleId);
    if (!role) {
      failed.push({ id: roleId, err: "role not found" });
      continue;
    }
    snapshot[roleId] = role.hoist;
    if (!role.hoist) {
      applied.push(roleId);
      continue;
    }
    try {
      await role.edit({ hoist: false, reason });
      applied.push(roleId);
    } catch (err) {
      failed.push({ id: roleId, err: err instanceof Error ? err.message : String(err) });
    }
  }

  const hoistRole = await fetchRole(guild, HOIST_ROLE);
  if (!hoistRole) {
    failed.push({ id: HOIST_ROLE, err: "role not found" });
  } else {
    snapshot[HOIST_ROLE] = hoistRole.hoist;
    if (hoistRole.hoist) {
      applied.push(HOIST_ROLE);
    } else {
      try {
        await hoistRole.edit({ hoist: true, reason });
        applied.push(HOIST_ROLE);
      } catch (err) {
        failed.push({ id: HOIST_ROLE, err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return { applied, failed, snapshot };
}

async function revertExperiment(guild: Guild, snapshot: Snapshot, reason: string) {
  const applied: string[] = [];
  const failed: Array<{ id: string; err: string }> = [];

  const targets = new Set<string>([...UNHOIST_ROLES, HOIST_ROLE, ...Object.keys(snapshot)]);

  for (const roleId of targets) {
    const role = await fetchRole(guild, roleId);
    if (!role) {
      failed.push({ id: roleId, err: "role not found" });
      continue;
    }
    const target = roleId in snapshot ? snapshot[roleId] : roleId !== HOIST_ROLE;
    if (role.hoist === target) {
      applied.push(roleId);
      continue;
    }
    try {
      await role.edit({ hoist: target, reason });
      applied.push(roleId);
    } catch (err) {
      failed.push({ id: roleId, err: err instanceof Error ? err.message : String(err) });
    }
  }

  return { applied, failed };
}

async function fetchRole(guild: Guild, roleId: string): Promise<Role | null> {
  try {
    return (await guild.roles.fetch(roleId)) ?? null;
  } catch {
    return null;
  }
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
