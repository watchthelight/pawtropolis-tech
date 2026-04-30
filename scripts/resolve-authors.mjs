/**
 * scripts/resolve-authors.mjs
 *
 * Fetches Discord usernames + server nicknames for all authors with at
 * least MIN_MSGS messages in the corpus. Stores in user_names table.
 *
 * Lookup priority for the displayed name:
 *   guild member nickname → user.globalName → user.username → "(unknown)"
 *
 * Usage:
 *   node scripts/resolve-authors.mjs              # resolve missing only
 *   node scripts/resolve-authors.mjs --min 200    # threshold (default 200)
 *   node scripts/resolve-authors.mjs --refresh    # re-fetch even resolved authors
 */

import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';
import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
const GUILD_ID = '896070888594759740';

const args = process.argv.slice(2);
function argN(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? parseInt(args[i + 1], 10) : dflt;
}
const MIN_MSGS = argN('--min', 200);
const REFRESH = args.includes('--refresh');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS user_names (
    id           TEXT PRIMARY KEY,
    username     TEXT,
    global_name  TEXT,
    nickname     TEXT,
    display      TEXT NOT NULL,
    in_guild     INTEGER NOT NULL,
    fetched_at_s INTEGER NOT NULL
  );
`);

// authors meeting threshold, optionally limited to those not yet resolved
const baseSql = `
  SELECT author_id, COUNT(*) AS n
  FROM general_messages_raw
  WHERE is_bot = 0
  GROUP BY author_id
  HAVING n >= ?
`;
const candidates = db.prepare(baseSql).all(MIN_MSGS);

const todo = REFRESH
  ? candidates
  : candidates.filter((c) => !db.prepare(`SELECT 1 FROM user_names WHERE id = ?`).get(c.author_id));

console.log(`[candidates] ${candidates.length} authors with ≥${MIN_MSGS} msgs`);
console.log(`[todo] ${todo.length} to resolve${REFRESH ? ' (refresh)' : ''}`);
if (todo.length === 0) { console.log('[done] nothing to do'); process.exit(0); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const insert = db.prepare(`
  INSERT OR REPLACE INTO user_names
    (id, username, global_name, nickname, display, in_guild, fetched_at_s)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

client.once('ready', async () => {
  console.log(`[ready] logged in as ${client.user?.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  console.log(`[guild] ${guild.name}`);

  let resolved = 0, missing = 0;
  const t0 = Date.now();

  for (const c of todo) {
    let username = null, globalName = null, nickname = null, display = null, inGuild = 0;

    // Try guild member first (gets nickname + ensures presence)
    try {
      const member = await guild.members.fetch(c.author_id);
      username = member.user.username;
      globalName = member.user.globalName;
      nickname = member.nickname;
      display = member.nickname || member.user.globalName || member.user.username;
      inGuild = 1;
    } catch {
      // not in guild — try global user
      try {
        const user = await client.users.fetch(c.author_id);
        username = user.username;
        globalName = user.globalName;
        display = user.globalName || user.username;
      } catch {
        missing++;
      }
    }

    if (!display) display = '(unknown)';

    insert.run(c.author_id, username, globalName, nickname, display, inGuild, Math.floor(Date.now() / 1000));
    resolved++;

    if (resolved % 25 === 0 || resolved === todo.length) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = resolved / elapsed;
      const eta = (todo.length - resolved) / rate;
      process.stdout.write(`\r[resolve] ${resolved}/${todo.length}  missing=${missing}  ${rate.toFixed(1)}/s  ETA ${Math.round(eta)}s    `);
    }
  }
  process.stdout.write('\n');

  const stats = db.prepare(`SELECT COUNT(*) c, SUM(in_guild) ig FROM user_names`).get();
  console.log(`[stats] resolved total=${stats.c}  in-guild=${stats.ig}  unknown=${missing}`);

  await client.destroy();
  db.close();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
