import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getModmailThreadDetail } from '$lib/server/queries/modmail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'gk')) {
		error(403, "You don't have permission to view this page.");
	}
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const ticketId = parseInt(params.ticketId, 10);
	if (!Number.isFinite(ticketId)) error(400, 'Invalid ticket id');

	const detail = getModmailThreadDetail(process.env.GUILD_ID, ticketId);
	if (!detail) error(404, 'Modmail thread not found');

	return detail;
};
