<script lang="ts">
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { invalidateAll } from '$app/navigation';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import type { SSEEvent } from '$lib/types/events';

	let { data } = $props();
	let activeMember = $derived(data.activeMember);
	let activeNsfw = $derived(data.activeNsfw);
	let sessions = $derived(data.sessions);

	// SSE: live progress updates
	function onScanEvent(_e: SSEEvent) { invalidateAll(); }
	$effect(() => {
		subscribe('audit:scan_started', onScanEvent);
		subscribe('audit:scan_progress', onScanEvent);
		subscribe('audit:scan_completed', onScanEvent);
		subscribe('audit:scan_cancelled', onScanEvent);
		return () => {
			unsubscribe('audit:scan_started', onScanEvent);
			unsubscribe('audit:scan_progress', onScanEvent);
			unsubscribe('audit:scan_completed', onScanEvent);
			unsubscribe('audit:scan_cancelled', onScanEvent);
		};
	});

	function progressPct(scanned: number, total: number): number {
		return total > 0 ? Math.round((scanned / total) * 100) : 0;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'in_progress': return 'var(--status-warning)';
			case 'completed': return 'var(--status-success)';
			case 'cancelled': return 'var(--text-muted)';
			default: return 'var(--text-secondary)';
		}
	}

	function typeLabel(type: string, scope: string | null): string {
		if (type === 'nsfw') return scope === 'flagged' ? 'NSFW (flagged)' : 'NSFW (all)';
		return 'Member';
	}

	let scanStarting = $state(false);
	let scanError = $state<string | null>(null);

	async function startScan(auditType: 'members' | 'nsfw', scope?: 'all' | 'flagged') {
		const label = auditType === 'nsfw' ? `NSFW avatar scan (${scope})` : 'Member scan';
		if (!confirm(`Start ${label}? This runs in the background.`)) return;
		scanStarting = true;
		scanError = null;
		try {
			const res = await fetch('/api/audit/scan/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ auditType, scope })
			});
			const result = await res.json();
			if (!result.success) scanError = result.error ?? 'Failed to start scan';
			else invalidateAll();
		} catch {
			scanError = 'Network error';
		} finally {
			scanStarting = false;
		}
	}

	async function cancelScan(auditType: 'members' | 'nsfw') {
		if (!confirm('Cancel the running scan?')) return;
		try {
			const res = await fetch('/api/audit/scan/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ auditType })
			});
			if (res.ok) invalidateAll();
		} catch { /* ignore */ }
	}
</script>

<SpringReveal stagger={30}>
	<!-- Active scans -->
	{#if activeMember || activeNsfw}
		<div class="section-heading">Active Scans</div>
		<div class="active-grid">
			{#each [activeMember, activeNsfw].filter((s): s is NonNullable<typeof s> => s != null) as session}
				{@const pct = progressPct(session.scannedCount, session.totalToScan)}
				<DataCard accent>
					<div class="scan-type">{typeLabel(session.auditType, session.scope)}</div>
					<div class="progress-bar-container">
						<div class="progress-bar-fill" style:width="{pct}%"></div>
					</div>
					<div class="scan-stats">
						<span>{session.scannedCount} / {session.totalToScan} scanned</span>
						<span class="scan-pct">{pct}%</span>
					</div>
					<div class="scan-stats">
						<span>{session.flaggedCount} flagged</span>
						{#if session.apiCalls > 0}
							<span>{session.apiCalls} API calls</span>
						{/if}
					</div>
					<div class="scan-meta">Started {relativeTime(session.startedAt)}</div>
					<button class="cancel-btn" onclick={() => cancelScan(session.auditType as 'members' | 'nsfw')}>Cancel</button>
				</DataCard>
			{/each}
		</div>
	{/if}

	<!-- Action buttons -->
	<div class="section-heading">{activeMember || activeNsfw ? 'Start New Scan' : 'Scans'}</div>
	<div class="action-grid">
		<button class="scan-btn" disabled={!!activeMember || scanStarting} onclick={() => startScan('members')}>
			Start Member Scan
		</button>
		<button class="scan-btn" disabled={!!activeNsfw || scanStarting} onclick={() => startScan('nsfw', 'all')}>
			Start NSFW Scan (All)
		</button>
		<button class="scan-btn" disabled={!!activeNsfw || scanStarting} onclick={() => startScan('nsfw', 'flagged')}>
			Start NSFW Scan (Flagged)
		</button>
	</div>
	{#if scanError}
		<p class="scan-error">{scanError}</p>
	{/if}

	<!-- Session history -->
	<div class="section-heading" style="margin-top: 2rem">Session History</div>
	{#if sessions.length === 0}
		<EmptyState message="No scan history" subtitle="Run a scan to see results here" />
	{:else}
		<div class="sessions-table">
			<div class="sessions-header">
				<span>Type</span>
				<span>Status</span>
				<span>Scanned</span>
				<span>Flagged</span>
				<span>Started</span>
			</div>
			{#each sessions as session (session.id)}
				<div class="sessions-row">
					<span class="session-type">{typeLabel(session.auditType, session.scope)}</span>
					<span class="session-status" style:color={statusColor(session.status)}>
						{session.status}
					</span>
					<span>{session.scannedCount} / {session.totalToScan}</span>
					<span>{session.flaggedCount}</span>
					<span class="session-time">{session.startedAt ? relativeTime(session.startedAt) : '—'}</span>
				</div>
			{/each}
		</div>
	{/if}
</SpringReveal>

<style>
	.section-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-holdfast);
	}

	.section-heading::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}

	.active-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.scan-type {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.progress-bar-container {
		width: 100%;
		height: 6px;
		background: var(--border);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.scan-stats {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.scan-pct {
		font-weight: 600;
		color: var(--accent);
	}

	.scan-meta {
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-top: 0.25rem;
	}

	.cancel-btn {
		margin-top: 0.5rem;
		padding: 0.3rem 0.75rem;
		font-size: 0.7rem;
		font-weight: 500;
		background: none;
		border: 1px solid var(--status-danger);
		border-radius: var(--radius-sm);
		color: var(--status-danger);
		cursor: pointer;
		transition: all var(--duration-fast);
	}

	.cancel-btn:hover {
		background: var(--status-danger);
		color: var(--bg);
	}

	.action-grid {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.scan-btn {
		padding: 0.5rem 1rem;
		font-size: 0.8rem;
		font-weight: 500;
		background: var(--surface-raised);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		cursor: pointer;
		transition: all var(--duration-fast);
	}

	.scan-btn:hover:not(:disabled) {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}

	.scan-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.scan-error {
		font-size: 0.75rem;
		color: var(--status-danger);
		margin-top: 0.5rem;
	}

	.sessions-table {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.sessions-header, .sessions-row {
		display: grid;
		grid-template-columns: 1.5fr 1fr 1.5fr 0.8fr 1.5fr;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		align-items: center;
	}

	.sessions-header {
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 0.65rem;
	}

	.sessions-row {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
	}

	.session-type {
		font-weight: 500;
	}

	.session-status {
		font-weight: 500;
		text-transform: capitalize;
	}

	.session-time {
		color: var(--text-muted);
	}

	@media (max-width: 640px) {
		.sessions-header, .sessions-row {
			grid-template-columns: 1.5fr 1fr 1fr;
		}

		.sessions-header span:nth-child(4),
		.sessions-header span:nth-child(5),
		.sessions-row span:nth-child(4),
		.sessions-row span:nth-child(5) {
			display: none;
		}
	}
</style>
