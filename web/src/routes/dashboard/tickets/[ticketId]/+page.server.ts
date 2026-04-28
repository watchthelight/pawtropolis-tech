import { error } from '@sveltejs/kit';
import { getTicketDetail } from '$lib/server/queries/tickets';
import { hasMinTier } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user!;
	const detail = getTicketDetail(params.ticketId);
	if (!detail) throw error(404, 'Ticket not found');

	// Privacy: report tickets require Mod Team (mod tier or higher).
	if (
		(detail.ticket.typeKey === 'report-user' || detail.ticket.typeKey === 'report-staff') &&
		!hasMinTier(user.tier, 'mod')
	) {
		throw error(403, 'Mod Team role required to view report tickets');
	}

	const canSeeStaffNotes = hasMinTier(user.tier, 'viewer');

	return { ...detail, canSeeStaffNotes };
};
