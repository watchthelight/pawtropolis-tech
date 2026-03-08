import { error } from '@sveltejs/kit';
import { getApplicationDetail, getCachedProfile, getUserPriorDecisions } from '$lib/server/queries/reviews';
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

	return {
		app,
		modmail,
		cachedProfile,
		priorDecisions,
		sessionUserId: locals.user?.id ?? null,
		canAdminUnclaim: hasMinTier(locals.user?.tier ?? 'none', 'admin')
	};
};
