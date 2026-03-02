import { error } from '@sveltejs/kit';
import { getApplicationDetail } from '$lib/server/queries/reviews';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const app = getApplicationDetail(params.appId);

	if (!app) {
		error(404, 'Application not found');
	}

	return { app };
};
