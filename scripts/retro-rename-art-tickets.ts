/**
 * Pawtropolis Tech — scripts/retro-rename-art-tickets.ts
 * WHAT: One-shot retro-rename pass over open new-system art tickets that
 *       were created BEFORE the /redeemreward integration shipped (P8a),
 *       so their channel names still reflect the current artist.
 * WHY: Belt-and-suspenders. Ongoing rename happens at /redeemreward
 *      confirm and /assignticket reassign, but if a ticket sat through a
 *      bot deploy with the old code, the channel name might lag.
 *      Idempotent: TicketService.renameForArtist no-ops when the desired
 *      name already matches.
 *
 * USAGE:
 *   npx dotenvx run -- tsx scripts/retro-rename-art-tickets.ts [--dry-run]
 *
 * SAFETY:
 *  - Sequential with a 3-second sleep between calls (Discord channel-rename
 *    rate limit is 2 per 10 minutes per channel, so per-channel headroom is
 *    fine, but we throttle global pace for politeness).
 *  - Skips legacy_source != NULL channels (Ticket Tool tickets stay).
 *  - Skips closed tickets.
 *  - Logs every action; --dry-run prints intended renames without calling
 *    setName.
 */

import {
  Client,
  GatewayIntentBits,
  type Guild,
  type TextChannel,
} from "discord.js";
import { db } from "../src/db/db.js";
import { logger } from "../src/lib/logger.js";
import { getTicketsCategoryId } from "../src/features/tickets/config.js";
import { TicketService } from "../src/features/tickets/service.js";
import { formatChannelName, resolveMemberIdentity } from "../src/features/tickets/rendering.js";
import { getTicketType } from "../src/features/tickets/registry.js";

const dryRun = process.argv.includes("--dry-run");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

interface Row {
  id: string;
  type_key: string;
  number: number;
  channel_id: string;
  guild_id: string;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(dryRun ? "DRY RUN — no setName calls" : "APPLYING renames");

  const rows = db
    .prepare(
      `SELECT id, type_key, number, channel_id, guild_id
         FROM ticket
        WHERE status = 'open'
          AND legacy_source IS NULL
          AND type_key = 'art-redeem'`
    )
    .all() as Row[];

  console.log(`Found ${rows.length} open new-system art-redeem tickets`);

  let renamed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id) as Guild | undefined;
    if (!guild) {
      console.log(`SKIP ${row.type_key}-${row.number}: guild ${row.guild_id} not in cache`);
      skipped++;
      continue;
    }

    if (!getTicketsCategoryId(guild.id)) {
      console.log(`SKIP ${row.type_key}-${row.number}: no tickets category configured`);
      skipped++;
      continue;
    }

    const type = getTicketType(row.type_key);
    if (!type || !type.channelNameTemplate.includes("{artist?}")) {
      skipped++;
      continue;
    }

    const artistId = TicketService.getCurrentArtistId(row.id);
    let identity: string | null = null;
    if (artistId) {
      try {
        const member = await guild.members.fetch(artistId);
        identity = resolveMemberIdentity(member);
      } catch {
        // member may have left; rename anyway with no artist suffix
      }
    }

    const desired = formatChannelName(type.channelNameTemplate, row.number, identity);

    let channel: TextChannel | null = null;
    try {
      channel = (await guild.channels.fetch(row.channel_id)) as TextChannel | null;
    } catch (err) {
      console.log(`SKIP ${row.type_key}-${row.number}: could not fetch channel`, err);
      skipped++;
      continue;
    }
    if (!channel) {
      skipped++;
      continue;
    }

    if (channel.name === desired) {
      console.log(`SKIP ${row.type_key}-${row.number}: already ${desired}`);
      skipped++;
      continue;
    }

    console.log(
      `${dryRun ? "DRY" : "APPLY"} ${row.type_key}-${row.number}: ${channel.name} -> ${desired}` +
        (artistId ? ` (artist=${artistId})` : "")
    );
    if (!dryRun) {
      try {
        await TicketService.renameForArtist(row.id, artistId, guild);
        renamed++;
      } catch (err) {
        console.log(`FAIL ${row.type_key}-${row.number}:`, err);
        failed++;
      }
      await sleep(3000); // pace politely
    }
  }

  console.log(
    `\nDone. renamed=${renamed} skipped=${skipped} failed=${failed} total=${rows.length}`
  );
  await client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
