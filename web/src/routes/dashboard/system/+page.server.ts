import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getRecentHealthAlerts } from '$lib/server/queries/system';
import { callBotApi } from '$lib/server/botApi';
import type { PageServerLoad } from './$types';

export interface SystemHealth {
	uptime: number;
	uptimeFormatted: string;
	wsPingMs: number;
	memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
	disk: { usedGB: number; totalGB: number; percentUsed: number };
	activeAlertCount: number;
	pm2: Array<{ name: string; status: string; cpu?: number; memory?: number }>;
	dbIntegrity: { ok: boolean; message: string; checkedAt: number };
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'owner')) {
		error(403, "You don't have permission to view this page.");
	}

	const alerts = getRecentHealthAlerts(20);

	// Bot API call — may fail if bot is offline
	let health: SystemHealth | null = null;
	const res = await callBotApi<SystemHealth>('/api/dashboard/health', {
		userId: locals.user.id,
		tier: locals.user.tier
	});
	if (res.success) {
		health = res.data;
	}

	return { alerts, health };
};
