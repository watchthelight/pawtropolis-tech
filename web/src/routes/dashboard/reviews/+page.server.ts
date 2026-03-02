// Queue data is loaded by +layout.server.ts (shared with [appId] child route).
// This page has no additional data to load.
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
};
