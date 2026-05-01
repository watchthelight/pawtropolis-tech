import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import { getRecentHealthAlerts } from '$lib/server/queries/system';
import { callBotApi } from '$lib/server/botApi';
import { cached, cacheKey, CACHE_TTL } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export interface SystemHealth {
	uptime: number;
	uptimeFormatted: string;
	wsPingMs: number;
	memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
	disk: { usedGB: number; totalGB: number; percentUsed: number };
	activeAlertCount: number;
	pm2: Array<{ name: string; status: string; cpuPercent?: number; memoryBytes?: number; uptimeSeconds?: number }>;
	dbIntegrity: { ok: boolean; message: string; checkedAt: number };
	host?: {
		loadavg: [number, number, number];
		cpuCount: number;
		totalMemMB: number;
		freeMemMB: number;
		usedMemPct: number;
		uptimeS: number;
	};
	cost?: {
		hourlyUsd: number;
		dailyUsd: number;
		monthlyUsd: number;
		note: string;
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !hasMinTier(locals.user.tier, 'owner')) {
		error(403, "You don't have permission to view this page.");
	}

	const alerts = getRecentHealthAlerts(20);

	// Cache the bot health snapshot for 10s — multiple tabs polling every 5s
	// share one upstream request to the bot. The bot is event-loop-bound and
	// can take 10-60s to respond cold, so we also bump the per-call timeout
	// to 25s and tolerate a fail-soft null.
	const userId = locals.user.id;
	const tier = locals.user.tier;
	let health: SystemHealth | null = null;
	try {
		health = await cached(
			cacheKey(['system:health']),
			20_000,
			async () => {
				// Bot's getSummary() can take 30-90s on this box (DB scan +
				// pm2 jlist fork + queue metrics aggregate). Be patient — the
				// 20s cache means we only pay this cost once per cache window.
				const res = await callBotApi<SystemHealth>(
					'/api/dashboard/health',
					{ userId, tier },
					120_000
				);
				if (!res.success) throw new Error(res.error);
				return res.data;
			}
		);
	} catch {
		health = null;
	}

	void CACHE_TTL; // future: tier the cache once host metrics come from a separate fast endpoint
	return { alerts, health };
};
