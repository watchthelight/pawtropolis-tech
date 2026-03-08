import { error } from '@sveltejs/kit';
import { getAuditRunFindings, getAuditRunStats } from '$lib/server/queries/auditSystems';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const runId = params.runId;
	const findings = getAuditRunFindings(runId);
	if (findings.length === 0) error(404, 'Audit run not found');
	const stats = getAuditRunStats(runId);
	return { runId, findings, stats };
};
