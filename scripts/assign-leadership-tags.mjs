#!/usr/bin/env node
// Assign Leadership / Below-Senior-Mod tag roles to every moderation team
// member based on tier. Default: dry-run (lists planned changes only).
// Pass --apply to actually write. Pass --one to test on a single member per group.
//
// Usage on EC2:
//   node scripts/assign-leadership-tags.mjs              # dry-run all
//   node scripts/assign-leadership-tags.mjs --one        # apply to one per group, verify
//   node scripts/assign-leadership-tags.mjs --apply      # full bulk apply

import 'dotenv/config';

const GUILD_ID    = '896070888594759740';
const ROLE_ABOVE  = '1499751169990590605'; // Leadership (Senior Mod and Above)
const ROLE_BELOW  = '1499751348567277690'; // Below-Senior-Mod (Senior Mod and Below)

const TIER_ROLES = {
	owner_server_owner:   '896070888779317254',
	community_manager:    '1190093021170114680',
	community_dev_lead:   '1382242769468260352',
	senior_admin:         '1420440472169746623',
	administrator:        '896070888779317248',
	senior_mod:           '1095757038899953774',
	moderator:            '896070888762535975',
	junior_mod:           '896070888762535966',
	gatekeeper:           '896070888762535969'
};

const ABOVE_ROLES = new Set([
	TIER_ROLES.owner_server_owner,
	TIER_ROLES.community_manager,
	TIER_ROLES.community_dev_lead,
	TIER_ROLES.senior_admin,
	TIER_ROLES.administrator,
	TIER_ROLES.senior_mod
]);

const BELOW_ROLES = new Set([
	TIER_ROLES.senior_mod,
	TIER_ROLES.moderator,
	TIER_ROLES.junior_mod,
	TIER_ROLES.gatekeeper
]);

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('DISCORD_TOKEN missing'); process.exit(1); }

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONE   = args.includes('--one');
const DRY   = !APPLY && !ONE;

const API = 'https://discord.com/api/v10';

async function api(path, opts = {}) {
	const url = `${API}${path}`;
	const res = await fetch(url, {
		...opts,
		headers: {
			'Authorization': `Bot ${TOKEN}`,
			'Content-Type': 'application/json',
			...(opts.headers || {})
		}
	});
	if (res.status === 429) {
		const retry = parseFloat(res.headers.get('retry-after') ?? '1');
		await new Promise((r) => setTimeout(r, retry * 1000 + 50));
		return api(path, opts);
	}
	if (!res.ok && res.status !== 204) {
		const text = await res.text();
		throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
	}
	if (res.status === 204) return null;
	return res.json();
}

async function fetchAllMembers() {
	const out = [];
	let after = '0';
	while (true) {
		const batch = await api(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
		if (!batch.length) break;
		out.push(...batch);
		after = batch[batch.length - 1].user.id;
		if (batch.length < 1000) break;
		process.stderr.write(`\r[fetch] ${out.length} members ...`);
	}
	process.stderr.write(`\r[fetch] ${out.length} members total\n`);
	return out;
}

// Highest-tier classification: a user with both Admin and GK is treated as Admin,
// not as both. So they belong in Above only — not in Below.
function highestTier(member) {
	const r = new Set(member.roles ?? []);
	if (r.has(TIER_ROLES.owner_server_owner))   return 'owner';
	if (r.has(TIER_ROLES.community_manager))    return 'cm';
	if (r.has(TIER_ROLES.community_dev_lead))   return 'cdl';
	if (r.has(TIER_ROLES.senior_admin))         return 'sa';
	if (r.has(TIER_ROLES.administrator))        return 'admin';
	if (r.has(TIER_ROLES.senior_mod))           return 'sm';
	if (r.has(TIER_ROLES.moderator))            return 'mod';
	if (r.has(TIER_ROLES.junior_mod))           return 'jm';
	if (r.has(TIER_ROLES.gatekeeper))           return 'gk';
	return null;
}
const ABOVE_TIERS = new Set(['owner', 'cm', 'cdl', 'sa', 'admin', 'sm']);
const BELOW_TIERS = new Set(['sm', 'mod', 'jm', 'gk']);

function classify(member) {
	const tier = highestTier(member);
	if (!tier) return { above: false, below: false };
	return { above: ABOVE_TIERS.has(tier), below: BELOW_TIERS.has(tier) };
}

async function addRole(userId, roleId) {
	await api(`/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, { method: 'PUT' });
}
async function removeRole(userId, roleId) {
	await api(`/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, { method: 'DELETE' });
}

async function verifyHasRole(userId, roleId) {
	const m = await api(`/guilds/${GUILD_ID}/members/${userId}`);
	return (m.roles ?? []).includes(roleId);
}

async function main() {
	const members = await fetchAllMembers();

	const aboveAdd = [], aboveRemove = [];
	const belowAdd = [], belowRemove = [];
	for (const m of members) {
		if (m.user.bot) continue;
		const cls = classify(m);
		const roles = new Set(m.roles ?? []);
		if (cls.above && !roles.has(ROLE_ABOVE)) aboveAdd.push(m);
		if (!cls.above && roles.has(ROLE_ABOVE)) aboveRemove.push(m);
		if (cls.below && !roles.has(ROLE_BELOW)) belowAdd.push(m);
		if (!cls.below && roles.has(ROLE_BELOW)) belowRemove.push(m);
	}

	console.log(`\n[plan] Leadership ${ROLE_ABOVE}`);
	console.log(`  add (${aboveAdd.length}):`);    for (const m of aboveAdd)    console.log(`    + ${m.user.username} (${m.user.id})`);
	console.log(`  remove (${aboveRemove.length}):`); for (const m of aboveRemove) console.log(`    - ${m.user.username} (${m.user.id})`);

	console.log(`\n[plan] Below-Senior-Mod ${ROLE_BELOW}`);
	console.log(`  add (${belowAdd.length}):`);    for (const m of belowAdd)    console.log(`    + ${m.user.username} (${m.user.id})`);
	console.log(`  remove (${belowRemove.length}):`); for (const m of belowRemove) console.log(`    - ${m.user.username} (${m.user.id})`);

	if (DRY) {
		console.log('\n[dry-run] no changes. Pass --one to test on one per change-type, or --apply for full sync.');
		return;
	}

	const lists = ONE
		? { aA: aboveAdd.slice(0,1), aR: aboveRemove.slice(0,1), bA: belowAdd.slice(0,1), bR: belowRemove.slice(0,1) }
		: { aA: aboveAdd, aR: aboveRemove, bA: belowAdd, bR: belowRemove };

	async function exec(kind, list, action, roleId, expectedAfter) {
		for (const m of list) {
			console.log(`[apply] ${kind} → ${m.user.username} (${m.user.id})`);
			await action(m.user.id, roleId);
			const has = await verifyHasRole(m.user.id, roleId);
			const ok = has === expectedAfter;
			console.log(`        verified hasRole=${has} (expected ${expectedAfter}): ${ok}`);
			if (!ok) { console.error('FAIL — stopping'); process.exit(2); }
		}
	}
	await exec('+Leadership',         lists.aA, addRole,    ROLE_ABOVE, true);
	await exec('-Leadership',         lists.aR, removeRole, ROLE_ABOVE, false);
	await exec('+Below-Senior-Mod',   lists.bA, addRole,    ROLE_BELOW, true);
	await exec('-Below-Senior-Mod',   lists.bR, removeRole, ROLE_BELOW, false);

	if (ONE) console.log('\n[one] verified. Re-run with --apply for full sync.');
	else console.log('\n[done] all synced.');
}

main().catch((e) => { console.error(e); process.exit(1); });
