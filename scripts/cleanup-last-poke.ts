/**
 * Pawtropolis Tech — scripts/cleanup-last-poke.ts
 * WHAT: Deletes the most recent bot-authored `<@id> *poke*` message in each
 *       /poke target channel for the primary guild.
 * USAGE: npx dotenvx run -- tsx scripts/cleanup-last-poke.ts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { Client, GatewayIntentBits, ChannelType, type TextChannel } from "discord.js";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const FALLBACK_CATEGORY_IDS = [
  "896070891539169316",
  "1393461646718140436",
  "896070891174260765",
  "1432302478723911781",
  "1210760381946007632",
  "1212353807208685598",
  "899667519105814619",
  "1400346492321009816",
  "896070889462976607",
  "1438539749668425836",
];
const FALLBACK_EXCLUDED_CHANNEL_ID = "896958848009637929";

const POKE_RE = /^<@!?\d+>\s+\*poke\*\s*$/;

function loadGuildConfig(guildId: string): { categoryIds: string[]; excludedChannelIds: string[] } {
  const dbPath = process.env.DB_PATH || "./data/data.db";
  if (!existsSync(dbPath)) {
    return { categoryIds: FALLBACK_CATEGORY_IDS, excludedChannelIds: [FALLBACK_EXCLUDED_CHANNEL_ID] };
  }
  let categoryIds = FALLBACK_CATEGORY_IDS;
  let excludedChannelIds = [FALLBACK_EXCLUDED_CHANNEL_ID];
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(
        "SELECT poke_category_ids_json, poke_excluded_channel_ids_json FROM guild_config WHERE guild_id = ?"
      )
      .get(guildId) as
      | { poke_category_ids_json: string | null; poke_excluded_channel_ids_json: string | null }
      | undefined;
    db.close();
    if (row?.poke_category_ids_json) {
      const parsed = JSON.parse(row.poke_category_ids_json);
      if (Array.isArray(parsed) && parsed.length > 0) categoryIds = parsed;
    }
    if (row?.poke_excluded_channel_ids_json) {
      const parsed = JSON.parse(row.poke_excluded_channel_ids_json);
      if (Array.isArray(parsed)) excludedChannelIds = parsed;
    }
  } catch (err) {
    console.warn("[cleanup-poke] DB read failed, using fallback:", (err as Error).message);
  }
  return { categoryIds, excludedChannelIds };
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("Error: DISCORD_TOKEN not set");
    process.exit(1);
  }
  const guildId = process.env.GUILD_ID || "896070888594759740";

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("ready", async () => {
    const botId = client.user!.id;
    console.log(`Bot connected as ${client.user!.tag} (${botId})`);
    console.log(`Guild: ${guildId}`);

    try {
      const guild = await client.guilds.fetch(guildId);
      const { categoryIds, excludedChannelIds } = loadGuildConfig(guildId);
      console.log(`Categories: ${categoryIds.length}, excluded channels: ${excludedChannelIds.length}`);

      const channels = await guild.channels.fetch();
      const targets = [...channels.values()].filter(
        (c): c is TextChannel =>
          c !== null &&
          c.type === ChannelType.GuildText &&
          !!c.parentId &&
          categoryIds.includes(c.parentId) &&
          !excludedChannelIds.includes(c.id)
      );

      console.log(`Target channels: ${targets.length}\n`);

      let deleted = 0;
      let scanned = 0;
      let skipped = 0;
      const failures: Array<{ channel: string; error: string }> = [];

      for (const ch of targets) {
        scanned++;
        try {
          const msgs = await ch.messages.fetch({ limit: 20 });
          const match = msgs.find(
            (m) => m.author.id === botId && POKE_RE.test(m.content)
          );
          if (!match) {
            console.log(`  [skip] #${ch.name} — no poke message in last 20`);
            skipped++;
            continue;
          }
          await match.delete();
          console.log(`  [del]  #${ch.name} — ${match.id}`);
          deleted++;
        } catch (err) {
          const msg = (err as Error).message;
          console.warn(`  [fail] #${ch.name} — ${msg}`);
          failures.push({ channel: ch.name, error: msg });
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      console.log(`\n=== Summary ===`);
      console.log(`Scanned: ${scanned}`);
      console.log(`Deleted: ${deleted}`);
      console.log(`Skipped (no match): ${skipped}`);
      console.log(`Failed: ${failures.length}`);
      if (failures.length > 0) {
        console.log("\nFailures:");
        for (const f of failures) console.log(`  #${f.channel}: ${f.error}`);
      }

      process.exit(0);
    } catch (err) {
      console.error("Fatal:", (err as Error).message);
      process.exit(1);
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
