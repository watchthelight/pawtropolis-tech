import { listTickets, listTicketTypeKeys, type TicketStatus } from '$lib/server/queries/tickets';
import { hasMinTier } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;
	// Mod Team / Senior Mod+ see reports. Ambassador-only viewers don't.
	const restrictReports = !hasMinTier(user.tier, 'mod');

	const typeKey = url.searchParams.get('type') || undefined;
	const statusRaw = url.searchParams.get('status');
	const status: TicketStatus | undefined =
		statusRaw === 'open' ? 'open' : statusRaw === 'closed' ? 'closed' : undefined;
	const search = url.searchParams.get('search') || undefined;
	const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);

	const result = listTickets(
		{
			typeKey,
			status,
			search,
			restrictReports
		},
		page
	);

	const typeKeys = listTicketTypeKeys(restrictReports);

	return {
		...result,
		typeKeys,
		filters: { typeKey, status, search },
		restrictReports
	};
};
