/**
 * Pawtropolis Tech — src/commands/testidea/currentAction.ts
 * WHAT: The active /testidea body. Implements one mass-server-action with
 *       symmetric apply() and revert() functions, plus an ACTION_ID and a
 *       Snapshot type so testidea.ts can persist + restore state safely.
 * WHY: /testidea is a rotating "cookie cutter" — the slash command surface
 *      stays stable, but the action behind it gets rewritten frequently.
 *      Isolating the body here keeps testidea.ts almost-never-changing and
 *      lets git history of new ideas live in this one file (or in sibling
 *      files swapped in via the import in testidea.ts).
 *
 * ROTATION PROTOCOL:
 *  1. Create a new sibling, e.g. currentAction-v2.ts, exporting the same shape.
 *  2. Bump ACTION_ID (must be globally unique; matches the snapshot version).
 *  3. Update the import in src/commands/testidea.ts to point at the new file.
 *  4. Leave the old file in-repo for reference and so existing snapshots in
 *     other guilds can still be reverted by manually swapping the import back.
 *
 * Current action: "hoist_staff_flat_v1" — unhoists every staff hierarchy role
 *      and hoists only MOD_TEAM ("Community Staff") so the sidebar collapses
 *      every staff rank into a single group. Proposed by Entropy 2026-05-15.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Guild, Role } from "discord.js";
import { ROLE_IDS, ROLE_HIERARCHY } from "../../lib/roles.js";

export const ACTION_ID = "hoist_staff_flat_v1";

export type Snapshot = Record<string, boolean>;

export type ActionResult = {
  applied: string[];
  failed: Array<{ id: string; err: string }>;
};

const HOIST_ROLE = ROLE_IDS.MOD_TEAM;
const UNHOIST_ROLES = ROLE_HIERARCHY.filter((id) => id !== HOIST_ROLE);

export async function apply(
  guild: Guild,
  reason: string
): Promise<ActionResult & { snapshot: Snapshot }> {
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
      failed.push({ id: roleId, err: errMsg(err) });
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
        failed.push({ id: HOIST_ROLE, err: errMsg(err) });
      }
    }
  }

  return { applied, failed, snapshot };
}

export async function revert(
  guild: Guild,
  snapshot: Snapshot,
  reason: string
): Promise<ActionResult> {
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
      failed.push({ id: roleId, err: errMsg(err) });
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

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
