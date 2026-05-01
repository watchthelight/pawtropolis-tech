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

function classify(member) {
	const roles = new Set(member.roles ?? []);
	const above = [...ABOVE_ROLES].some((r) => roles.has(r));
	const below = [...BELOW_ROLES].some((r) => roles.has(r));
	return { above, below };
}

async function addRole(userId, roleId) {
	await api(`/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, { method: 'PUT' });
}

async function verifyHasRole(userId, roleId) {
	const m = await api(`/guilds/${GUILD_ID}/members/${userId}`);
	return (m.roles ?? []).includes(roleId);
}

async function main() {
	const members = await fetchAllMembers();

	const aboveTargets = []; // need ROLE_ABOVE
	const belowTargets = []; // need ROLE_BELOW
	for (const m of members) {
		if (m.user.bot) continue;
		const cls = classify(m);
		const roles = new Set(m.roles ?? []);
		if (cls.above && !roles.has(ROLE_ABOVE)) aboveTargets.push(m);
		if (cls.below && !roles.has(ROLE_BELOW)) belowTargets.push(m);
	}

	console.log(`\n[plan] Senior Mod and Above (Leadership ${ROLE_ABOVE}): ${aboveTargets.length} need it`);
	for (const m of aboveTargets) console.log(`        - ${m.user.username} (${m.user.id})`);
	console.log(`\n[plan] Senior Mod and Below (${ROLE_BELOW}): ${belowTargets.length} need it`);
	for (const m of belowTargets) console.log(`        - ${m.user.username} (${m.user.id})`);

	if (DRY) {
		console.log('\n[dry-run] no changes. Pass --one to test on one each, or --apply for bulk.');
		return;
	}

	const list = ONE ? { above: aboveTargets.slice(0, 1), below: belowTargets.slice(0, 1) } : { above: aboveTargets, below: belowTargets };

	for (const m of list.above) {
		console.log(`[apply] +Leadership → ${m.user.username} (${m.user.id})`);
		await addRole(m.user.id, ROLE_ABOVE);
		const ok = await verifyHasRole(m.user.id, ROLE_ABOVE);
		console.log(`        verified: ${ok}`);
		if (!ok) { console.error('FAIL — stopping'); process.exit(2); }
	}
	for (const m of list.below) {
		console.log(`[apply] +Below-Senior-Mod → ${m.user.username} (${m.user.id})`);
		await addRole(m.user.id, ROLE_BELOW);
		const ok = await verifyHasRole(m.user.id, ROLE_BELOW);
		console.log(`        verified: ${ok}`);
		if (!ok) { console.error('FAIL — stopping'); process.exit(2); }
	}

	if (ONE) console.log('\n[one] verified. Re-run with --apply for full rollout.');
	else console.log('\n[done] all assigned.');
}

main().catch((e) => { console.error(e); process.exit(1); });
