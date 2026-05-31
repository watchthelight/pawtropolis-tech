// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/patreonArtRewards.ts
 * WHAT: Automated Patreon → art ticket grant system
 * WHY: Patreon tiers include one-time art ticket rewards. This automates
 *      granting the correct ticket roles on subscribe/upgrade/downgrade/resub,
 *      using a delta-based algorithm that never over- or under-grants.
 * FLOWS:
 *  - guildMemberUpdate detects Patreon role → (after dedup) → compute delta → grant tickets
 *  - Perks do NOT stack: each tier defines its own complete reward set
 *  - Grants are tracked per-user per-art-type, never decremented
 */

import type { GuildMember } from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/db.js";
import { getConfig } from "../lib/config.js";
import { assignRole } from "./roleAutomation.js";
import { isPanicMode } from "./panicStore.js";
import { logActionPretty } from "../logging/pretty.js";
import { getTicketRoles, ART_TYPE_DISPLAY } from "./artistRotation/constants.js";
import type { ArtType } from "./artistRotation/constants.js";

// ---------------------------------------------------------------------------
// Patreon tier → art ticket entitlements
// ---------------------------------------------------------------------------

// Tier role IDs from patreonRoleDedup.ts, ordered highest → lowest.
// Each tier defines the COMPLETE set of art tickets for that tier (non-cumulative).
const PATREON_ART_ENTITLEMENTS: Array<{
  name: string;
  roleId: string;
  tickets: Partial<Record<ArtType, number>>;
}> = [
  {
    name: "[Patreon] Legendary Fiona",
    roleId: "1246000607383257118",
    tickets: { headshot: 1, fullbody: 1, emoji: 2 },
  },
  {
    name: "[Patreon] City Benefactor",
    roleId: "1385490737142960188",
    tickets: { headshot: 1, halfbody: 1, emoji: 1 },
  },
  {
    name: "[Patreon] Mayor",
    roleId: "1201053392076820592",
    tickets: { headshot: 1, halfbody: 1 },
  },
  {
    name: "[Patreon] Council Member",
    roleId: "1385565132767232124",
    tickets: { headshot: 1 },
  },
  // City Worker and Citizen have no art tickets
  {
    name: "[Patreon] City Worker",
    roleId: "1201053311336448040",
    tickets: {},
  },
  {
    name: "[Patreon] Citizen",
    roleId: "1201048785565012028",
    tickets: {},
  },
];

// ---------------------------------------------------------------------------
// Feature toggle
// ---------------------------------------------------------------------------

function isEnabled(guildId: string): boolean {
  const cfg = getConfig(guildId);
  return cfg?.patreon_art_rewards_enabled === "true";
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

interface ArtGrantRow {
  guild_id: string;
  user_id: string;
  art_type: string;
  quantity_granted: number;
  quantity_redeemed: number;
  last_granted_at_s: number | null;
}

function getGrantedQuantity(guildId: string, userId: string, artType: string): number {
  const row = db.prepare(
    `SELECT quantity_granted FROM patreon_art_granted WHERE guild_id = ? AND user_id = ? AND art_type = ?`
  ).get(guildId, userId, artType) as { quantity_granted: number } | undefined;
  return row?.quantity_granted ?? 0;
}

function getRedeemedQuantity(guildId: string, userId: string, artType: string): number {
  const row = db.prepare(
    `SELECT quantity_redeemed FROM patreon_art_granted WHERE guild_id = ? AND user_id = ? AND art_type = ?`
  ).get(guildId, userId, artType) as { quantity_redeemed: number } | undefined;
  return row?.quantity_redeemed ?? 0;
}

/**
 * Record that a Patreon-granted art ticket was redeemed.
 * WHAT: Increments quantity_redeemed (capped at quantity_granted so remaining
 *       never goes negative) for an existing grant row only.
 * WHY: The ticket role is a single binary marker, so quantity > 1 tiers need a
 *      redeemed counter for the sweep to know whether to re-grant the role
 *      (re-grant while granted - redeemed > 0). A redemption of a ticket that was
 *      not Patreon-granted updates no row and is a no-op.
 * RETURNS: rows updated (0 when the ticket was not Patreon-granted).
 */
export function recordArtTicketRedemption(guildId: string, userId: string, artType: string): number {
  const res = db.prepare(`
    UPDATE patreon_art_granted
       SET quantity_redeemed = MIN(quantity_redeemed + 1, quantity_granted)
     WHERE guild_id = ? AND user_id = ? AND art_type = ?
  `).run(guildId, userId, artType);
  return res.changes;
}

function upsertGrant(guildId: string, userId: string, artType: string, newQuantity: number): void {
  db.prepare(`
    INSERT INTO patreon_art_granted (guild_id, user_id, art_type, quantity_granted, last_granted_at_s)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(guild_id, user_id, art_type) DO UPDATE SET
      quantity_granted = MAX(excluded.quantity_granted, patreon_art_granted.quantity_granted),
      last_granted_at_s = excluded.last_granted_at_s
  `).run(guildId, userId, artType, newQuantity);
}

function logGrant(
  guildId: string, userId: string, artType: string,
  quantity: number, tierName: string, reason: string
): void {
  db.prepare(`
    INSERT INTO patreon_art_log (guild_id, user_id, art_type, quantity, patreon_tier, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, artType, quantity, tierName, reason);
}

/** Get all grants for a user (for debug command). */
export function getArtGrantsForUser(guildId: string, userId: string): ArtGrantRow[] {
  return db.prepare(
    `SELECT * FROM patreon_art_granted WHERE guild_id = ? AND user_id = ?`
  ).all(guildId, userId) as ArtGrantRow[];
}

/** Get recent audit log entries for a user (for debug command). */
export function getArtLogForUser(guildId: string, userId: string, limit = 10): Array<{
  art_type: string; quantity: number; patreon_tier: string; reason: string; created_at_s: number;
}> {
  return db.prepare(
    `SELECT art_type, quantity, patreon_tier, reason, created_at_s
     FROM patreon_art_log WHERE guild_id = ? AND user_id = ?
     ORDER BY created_at_s DESC LIMIT ?`
  ).all(guildId, userId, limit) as any[];
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

/**
 * Grant art ticket roles based on the user's current Patreon tier.
 * Call AFTER patreon dedup has run (so the user has only their highest tier).
 */
export async function handlePatreonArtRewards(member: GuildMember): Promise<void> {
  const guild = member.guild;

  // Scoped feature toggle
  if (!isEnabled(guild.id)) return;

  // Global safety net
  if (isPanicMode(guild.id)) {
    logger.warn({
      evt: "patreon_art_blocked_panic",
      guildId: guild.id,
      userId: member.id,
    }, "Patreon art rewards blocked — panic mode active");
    return;
  }

  // Re-fetch member for fresh role data (dedup may have just removed roles)
  const fresh = await guild.members.fetch(member.id).catch(() => null);
  if (!fresh) return;

  // Find highest Patreon tier
  const tier = PATREON_ART_ENTITLEMENTS.find((t) => fresh.roles.cache.has(t.roleId));
  if (!tier) return; // No Patreon tier

  const ticketEntitlements = tier.tickets;
  const artTypes = Object.keys(ticketEntitlements) as ArtType[];
  if (artTypes.length === 0) return; // Tier has no art rewards

  const ticketRoles = getTicketRoles(guild.id);
  const botId = guild.client.user?.id ?? "system";
  const granted: string[] = [];
  const ROLE_ASSIGN_DELAY_MS = 1100;

  for (let i = 0; i < artTypes.length; i++) {
    const artType = artTypes[i]!;
    const entitlement = ticketEntitlements[artType]!;
    const alreadyGranted = getGrantedQuantity(guild.id, fresh.id, artType);
    const redeemed = getRedeemedQuantity(guild.id, fresh.id, artType);

    const roleId = ticketRoles[artType];
    if (!roleId) continue; // No ticket role configured for this art type

    // Credit any newly-entitled tickets. quantity_granted is a high-water mark:
    // a tier promising N tickets credits up to N total, ever (never decremented,
    // never re-credited on resub/downgrade).
    const newGranted = Math.max(entitlement, alreadyGranted);
    const newlyCredited = newGranted - alreadyGranted;
    if (newlyCredited > 0) {
      upsertGrant(guild.id, fresh.id, artType, newGranted);
      logGrant(
        guild.id, fresh.id, artType, newlyCredited, tier.name,
        `Tier ${tier.name}: ${alreadyGranted} -> ${newGranted} (credited +${newlyCredited})`
      );
    }

    // The ticket role is a single binary "you hold an unredeemed ticket" marker.
    // Re-grant it whenever tickets remain (granted - redeemed > 0) and the user
    // lacks it. This is what lets a quantity > 1 tier re-issue the role after each
    // redemption instead of permanently under-granting the second+ ticket.
    const remaining = newGranted - redeemed;
    if (remaining <= 0) continue;
    if (fresh.roles.cache.has(roleId)) continue; // Already holds the ticket

    const result = await assignRole(
      guild,
      fresh.id,
      roleId,
      `patreon_art_reward: ${tier.name} -> ${remaining}x ${ART_TYPE_DISPLAY[artType]} remaining`,
      botId
    );

    if (result.action === "add") {
      granted.push(`${remaining}x ${ART_TYPE_DISPLAY[artType]}`);
      // Space out role adds so we do not trip Discord's per-guild rate limit.
      await new Promise((resolve) => setTimeout(resolve, ROLE_ASSIGN_DELAY_MS));
    }
  }

  if (granted.length > 0) {
    logger.info({
      evt: "patreon_art_granted",
      guildId: guild.id,
      userId: fresh.id,
      username: fresh.user.username,
      tier: tier.name,
      granted,
    }, `Granted Patreon art tickets: ${granted.join(", ")}`);

    await logActionPretty(guild, {
      actorId: botId,
      subjectId: fresh.id,
      action: "role_grant",
      reason: `Patreon art ticket grant (${tier.name})`,
      meta: {
        tier: tier.name,
        granted,
      },
    }).catch((err) => {
      logger.warn({ err, guildId: guild.id, userId: fresh.id },
        "[patreonArtRewards] Failed to log action");
    });

    // DM the user about their new art tickets
    try {
      await fresh.send({
        content: `🎨 **Patreon Art Tickets Granted!**\n\n` +
          `Thanks to your **${tier.name.replace("[Patreon] ", "")}** tier, ` +
          `you've received:\n${granted.map((g) => `• ${g}`).join("\n")}\n\n` +
          `A staff member can redeem these for you with \`/redeemreward\`.`,
      });
    } catch {
      // DMs closed — not critical
    }
  }
}
