import { error } from '@sveltejs/kit';
import { getApplicationDetail, getCachedProfile, getUserPriorDecisions, getVoteOutInfo } from '$lib/server/queries/reviews';
import { getModmailForApplication } from '$lib/server/queries/modmail';
import { hasMinTier } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

const GUILD_ID = process.env.GUILD_ID!;

export const load: PageServerLoad = async ({ params, locals }) => {
	const app = getApplicationDetail(params.appId, GUILD_ID);

	if (!app) {
		error(404, 'Application not found');
	}

	const modmail = getModmailForApplication(app.userId, GUILD_ID);
	const cachedProfile = getCachedProfile(app.userId, GUILD_ID);
	const priorDecisions = getUserPriorDecisions(app.userId, GUILD_ID, app.id);
	const voteOutInfo = getVoteOutInfo(app.id, GUILD_ID);

	return {
		app,
		modmail,
		cachedProfile,
		priorDecisions,
		voteOutInfo,
		sessionUserId: locals.user?.id ?? null,
		canAdminUnclaim: hasMinTier(locals.user?.tier ?? 'none', 'admin')
	};
};
