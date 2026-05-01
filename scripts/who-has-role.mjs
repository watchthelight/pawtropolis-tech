#!/usr/bin/env node
import 'dotenv/config';
const GUILD_ID = '896070888594759740';
const TARGET   = process.argv[2];
if (!TARGET) { console.error('usage: who-has-role.mjs <roleId>'); process.exit(1); }

const ROLE_NAMES = {
	'896070888779317254': 'SERVER_OWNER',
	'1190093021170114680': 'COMMUNITY_MANAGER',
	'1382242769468260352': 'COMMUNITY_DEV_LEAD',
	'1420440472169746623': 'SENIOR_ADMIN',
	'896070888779317248':  'ADMINISTRATOR',
	'1095757038899953774': 'SENIOR_MOD',
	'896070888762535975':  'MODERATOR',
	'896070888762535966':  'JUNIOR_MOD',
	'896070888762535969':  'GATEKEEPER',
	'987662057069482024':  'MOD_TEAM',
	'1120074045883420753': 'SERVER_DEV'
};

const TOKEN = process.env.DISCORD_TOKEN;
const API = 'https://discord.com/api/v10';
async function api(p) {
	const r = await fetch(`${API}${p}`, { headers: { 'Authorization': `Bot ${TOKEN}` } });
	if (r.status === 429) { await new Promise(s=>setTimeout(s, 1500)); return api(p); }
	return r.json();
}

const out = [];
let after = '0';
while (true) {
	const batch = await api(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
	if (!batch.length) break;
	out.push(...batch);
	after = batch[batch.length-1].user.id;
	if (batch.length < 1000) break;
}
const matches = out.filter(m => (m.roles ?? []).includes(TARGET));
console.log(`${matches.length} members have role ${TARGET}:`);
for (const m of matches) {
	const tierRoles = (m.roles ?? []).filter(r => ROLE_NAMES[r]).map(r => ROLE_NAMES[r]);
	console.log(`  ${m.user.username.padEnd(22)} ${m.user.id.padEnd(20)} [${tierRoles.join(', ') || 'NONE'}]`);
}
