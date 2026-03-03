/**
 * Pawtropolis Tech — scripts/backfill-user-cache.ts
 * WHAT: One-time backfill of user_cache table for all current guild members.
 * WHY: Dashboard shows "Unknown" for users not yet cached. This fills in
 *      identity data (username, display name, avatar) for all existing members.
 *
 * USAGE:
 *   npx dotenvx run -- tsx scripts/backfill-user-cache.ts
 *   npx dotenvx run -- tsx scripts/backfill-user-cache.ts --dry-run
 *
 * SAFETY:
 *  - Uses UPSERT (idempotent, safe to re-run)
 *  - Batched in groups of 100 to avoid memory spikes
 *  - Logs progress every 100 members
 */

import { Client, GatewayIntentBits } from "discord.js";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();

const dryRun = process.argv.includes("--dry-run");
const dbPath = process.env.DB_PATH || "./data/data.db";
const guildId = process.env.GUILD_ID;

if (!guildId) {
  console.error("Error: GUILD_ID not set in environment");
  process.exit(1);
}

console.log("\n=== Pawtropolis User Cache Backfill ===\n");
console.log(`Database: ${dbPath}`);
console.log(`Guild: ${guildId}`);
console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "APPLY"}\n`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  try {
    const guild = await client.guilds.fetch(guildId);
    console.log(`Guild: ${guild.name} (${guild.memberCount} members)\n`);

    console.log("Fetching all members...");
    const members = await guild.members.fetch();
    console.log(`Fetched ${members.size} members\n`);

    if (dryRun) {
      console.log(`[DRY RUN] Would cache ${members.size} members`);
      console.log("\nSample (first 5):");
      let i = 0;
      for (const [, member] of members) {
        if (i >= 5) break;
        const avatarUrl = member.displayAvatarURL({ size: 128 });
        console.log(`  ${member.user.username} (${member.user.id}) -> ${member.displayName} [${avatarUrl}]`);
        i++;
      }
    } else {
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");

      const upsert = db.prepare(`
        INSERT INTO user_cache (user_id, guild_id, username, global_name, display_name, avatar_hash, avatar_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
          username = excluded.username,
          global_name = excluded.global_name,
          display_name = excluded.display_name,
          avatar_hash = excluded.avatar_hash,
          avatar_url = excluded.avatar_url,
          updated_at = datetime('now')
      `);

      let cached = 0;
      const batchSize = 100;
      const memberArray = [...members.values()];

      for (let i = 0; i < memberArray.length; i += batchSize) {
        const batch = memberArray.slice(i, i + batchSize);
        const insertBatch = db.transaction(() => {
          for (const member of batch) {
            const user = member.user;
            const avatarUrl = member.displayAvatarURL({ size: 128 });
            const displayName = member.displayName ?? user.globalName ?? user.username;
            upsert.run(
              user.id,
              guildId,
              user.username,
              user.globalName ?? null,
              displayName,
              user.avatar ?? null,
              avatarUrl,
            );
            cached++;
          }
        });
        insertBatch();

        if (cached % 100 === 0 || cached === memberArray.length) {
          console.log(`  Cached ${cached}/${memberArray.length} members...`);
        }
      }

      console.log(`\nDone! Cached ${cached} members into user_cache.`);

      // Verify
      const count = db.prepare("SELECT COUNT(*) as count FROM user_cache WHERE guild_id = ?").get(guildId) as { count: number };
      console.log(`Total user_cache rows for guild: ${count.count}`);

      db.close();
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN);
