/**
 * Pawtropolis Tech — scripts/backfill-user-cache.mjs
 * WHAT: One-time backfill of user_cache for all guild members.
 * WHY: Dashboard shows "Unknown" for users not yet cached.
 * USAGE: node --env-file=.env scripts/backfill-user-cache.mjs
 */

import { Client, GatewayIntentBits } from "discord.js";
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "./data/data.db";
const guildId = process.env.GUILD_ID;
const token = process.env.DISCORD_TOKEN;

if (!guildId || !token) {
  console.error("Error: GUILD_ID and DISCORD_TOKEN required");
  process.exit(1);
}

console.log("\n=== User Cache Backfill ===\n");
console.log(`Database: ${dbPath}`);
console.log(`Guild: ${guildId}\n`);

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
    const memberArray = [...members.values()];
    const batchSize = 100;

    for (let i = 0; i < memberArray.length; i += batchSize) {
      const batch = memberArray.slice(i, i + batchSize);
      db.transaction(() => {
        for (const member of batch) {
          const user = member.user;
          const avatarUrl = member.displayAvatarURL({ size: 128 });
          const displayName = member.displayName ?? user.globalName ?? user.username;
          upsert.run(
            user.id, guildId, user.username,
            user.globalName ?? null, displayName,
            user.avatar ?? null, avatarUrl
          );
          cached++;
        }
      })();
      if (cached % 100 === 0 || cached === memberArray.length) {
        console.log(`  Cached ${cached}/${memberArray.length}...`);
      }
    }

    const count = db.prepare("SELECT COUNT(*) as c FROM user_cache WHERE guild_id = ?").get(guildId);
    console.log(`\nDone! Total user_cache rows: ${count.c}`);
    db.close();
  } catch (err) {
    console.error("Error:", err);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(token);
