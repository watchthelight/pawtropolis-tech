import { error } from '@sveltejs/kit';
import { hasMinTier } from '$lib/server/roles';
import {
	getLatestSecuritySnapshot,
	getSecuritySnapshots,
	getSecurityIssueTrends,
	getAcknowledgedIssuesList,
	getSecuritySnapshotFull
} from '$lib/server/queries/auditSystems';
import type { PageServerLoad } from './$types';

const GUILD_ID = process.env.GUILD_ID!;

export const load: PageServerLoad = async ({ parent }) => {
	const { userTier } = await parent();
	if (!hasMinTier(userTier, 'sa')) {
		error(403, "You don't have permission to view this page.");
	}

	const latest = getLatestSecuritySnapshot(GUILD_ID);
	const snapshots = getSecuritySnapshots(GUILD_ID, 20);
	const trends = getSecurityIssueTrends(GUILD_ID, 30);
	const acknowledged = getAcknowledgedIssuesList(GUILD_ID);

	// Load full issues from the latest snapshot
	let issues: unknown[] = [];
	if (latest) {
		const full = getSecuritySnapshotFull(GUILD_ID, latest.id);
		if (full) issues = full.issuesSnapshot;
	}

	return { latest, snapshots, trends, acknowledged, issues };
};
