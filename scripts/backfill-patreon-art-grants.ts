/**
 * Backfill patreon_art_granted for existing Patreon members.
 *
 * Sets their grant quantities to match their current tier's entitlements
 * WITHOUT assigning any roles (assumes tickets were already given manually).
 * Does NOT write to patreon_art_log (not retrospectively filled).
 *
 * Run once after migration 062, before enabling the feature toggle.
 * Usage: npx dotenvx run -- tsx scripts/backfill-patreon-art-grants.ts
 */

import Database from "better-sqlite3";
import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const PATREON_ART_ENTITLEMENTS = [
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
] as const;

async function main() {
  const dbPath = process.env.DB_PATH || "./data/data.db";
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    console.error("GUILD_ID not set");
    process.exit(1);
  }

  console.log("Connecting to Discord to fetch member roles...");

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  await client.login(process.env.DISCORD_TOKEN);
  await new Promise((r) => client.once("ready", r));

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`Guild ${guildId} not found`);
    process.exit(1);
  }

  const upsert = db.prepare(`
    INSERT INTO patreon_art_granted (guild_id, user_id, art_type, quantity_granted, last_granted_at_s)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(guild_id, user_id, art_type) DO UPDATE SET
      quantity_granted = MAX(excluded.quantity_granted, patreon_art_granted.quantity_granted),
      last_granted_at_s = excluded.last_granted_at_s
  `);

  let totalMembers = 0;
  let totalGrants = 0;

  // Process each tier's members
  for (const tier of PATREON_ART_ENTITLEMENTS) {
    const ticketEntries = Object.entries(tier.tickets);
    if (ticketEntries.length === 0) continue;

    const role = guild.roles.cache.get(tier.roleId);
    if (!role) {
      console.log(`  Skipping ${tier.name} — role not found`);
      continue;
    }

    console.log(`\nProcessing ${tier.name} (${role.members.size} members)...`);

    for (const [, member] of role.members) {
      // Find their HIGHEST tier (not just this one)
      const highestTier = PATREON_ART_ENTITLEMENTS.find((t) =>
        member.roles.cache.has(t.roleId)
      );
      if (!highestTier || highestTier.roleId !== tier.roleId) {
        // This member has a higher tier — skip, they'll be processed under that tier
        continue;
      }

      for (const [artType, quantity] of ticketEntries) {
        upsert.run(guildId, member.id, artType, quantity);
        totalGrants++;
      }
      totalMembers++;
      console.log(`  ✓ ${member.user.username} — ${ticketEntries.map(([t, q]) => `${q}x ${t}`).join(", ")}`);
    }
  }

  console.log(`\nBackfill complete: ${totalMembers} members, ${totalGrants} grant records.`);
  console.log("No roles were assigned. No audit log entries created.");
  console.log("\nNext step: /config set patreon_art_rewards_enabled true");

  client.destroy();
  db.close();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
