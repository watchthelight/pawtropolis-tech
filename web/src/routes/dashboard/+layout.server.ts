import { redirect } from '@sveltejs/kit';
import { ROLE_IDS } from '$lib/server/roles';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/auth/login');
	}

	return {
		user: locals.user,
		isArtist: (locals.user.roles ?? []).includes(ROLE_IDS.SERVER_ARTIST)
	};
};
