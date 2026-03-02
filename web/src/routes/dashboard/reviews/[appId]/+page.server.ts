import { error } from '@sveltejs/kit';
import { getApplicationDetail } from '$lib/server/queries/reviews';
import type { PageServerLoad } from './$types';

const GUILD_ID = process.env.GUILD_ID!;

export const load: PageServerLoad = async ({ params }) => {
	const app = getApplicationDetail(params.appId, GUILD_ID);

	if (!app) {
		error(404, 'Application not found');
	}

	return { app };
};
