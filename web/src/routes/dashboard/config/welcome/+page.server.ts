import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'admin')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;

	const row = db()
		.prepare(`SELECT welcome_template FROM guild_config WHERE guild_id = ?`)
		.get(guildId) as { welcome_template: string | null } | undefined;

	return {
		template: row?.welcome_template ?? '',
		userTier: locals.user.tier
	};
};
