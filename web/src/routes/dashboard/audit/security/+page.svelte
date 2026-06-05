<script lang="ts">
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { invalidateAll } from '$app/navigation';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import type { SSEEvent } from '$lib/types/events';
	import { onMount } from 'svelte';

	let { data } = $props();
	let latest = $derived(data.latest);
	let snapshots = $derived(data.snapshots);
	let issues = $derived(data.issues as Array<{ severity?: string; title?: string; category?: string; description?: string; key?: string }>);
	let acknowledged = $derived(new Set(data.acknowledged.map(a => a.issueKey)));

	let expandedIssue = $state<string | null>(null);

	// SSE: refresh on new snapshot or acknowledge changes
	function onAuditEvent(_e: SSEEvent) { invalidateAll(); }
	$effect(() => {
		subscribe('audit:security_snapshot', onAuditEvent);
		subscribe('audit:issue_acknowledged', onAuditEvent);
		subscribe('audit:issue_unacknowledged', onAuditEvent);
		return () => {
			unsubscribe('audit:security_snapshot', onAuditEvent);
			unsubscribe('audit:issue_acknowledged', onAuditEvent);
			unsubscribe('audit:issue_unacknowledged', onAuditEvent);
		};
	});

	const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
	let sortedIssues = $derived(
		[...issues].sort((a, b) => (SEVERITY_ORDER[a.severity ?? ''] ?? 9) - (SEVERITY_ORDER[b.severity ?? ''] ?? 9))
	);

	let ackLoading = $state<string | null>(null);

	async function toggleAcknowledge(issue: typeof issues[number]) {
		const key = issue.key ?? '';
		if (!key || ackLoading) return;
		ackLoading = key;
		const isAcked = acknowledged.has(key);
		const endpoint = isAcked ? '/api/audit/unacknowledge' : '/api/audit/acknowledge';
		const body = isAcked
			? { issueKey: key }
			: { issueKey: key, severity: issue.severity ?? 'unknown', title: issue.title ?? '', permissionHash: key };
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) invalidateAll();
		} finally {
			ackLoading = null;
		}
	}

	function severityColor(severity: string | undefined): string {
		switch (severity) {
			case 'critical': return 'var(--danger)';
			case 'high': return 'oklch(65% 0.15 40)';
			case 'medium': return 'var(--warn)';
			case 'low': return 'var(--info)';
			default: return 'var(--ink-2)';
		}
	}
</script>

<SpringReveal stagger={30}>
	{#if !latest}
		<EmptyState message="No security snapshots" subtitle="Run /audit security from Discord to generate the first snapshot" />
	{:else}
		<!-- Summary cards -->
		<div class="summary-grid">
			<DataCard accent={latest.criticalCount > 0}>
				<StatNumber value={latest.issueCount} label="Total Issues" />
			</DataCard>
			<DataCard accent={latest.criticalCount > 0}>
				<StatNumber value={latest.criticalCount} label="Critical" />
			</DataCard>
			<DataCard>
				<StatNumber value={latest.highCount} label="High" />
			</DataCard>
			<DataCard>
				<StatNumber value={latest.mediumCount + latest.lowCount} label="Medium + Low" />
			</DataCard>
			<DataCard>
				<StatNumber value={latest.roleCount} label="Roles" />
			</DataCard>
			<DataCard>
				<StatNumber value={latest.channelCount} label="Channels" />
			</DataCard>
		</div>

		<p class="last-scan">Last scan: {relativeTime(latest.createdAt)}</p>

		<!-- Issues list -->
		<div class="section-heading">Issues ({sortedIssues.length})</div>

		{#if sortedIssues.length === 0}
			<EmptyState message="No issues found" subtitle="Server permissions look clean" />
		{:else}
			<div class="issues-list">
				{#each sortedIssues as issue, i (issue.key ?? i)}
					{@const isAcknowledged = acknowledged.has(issue.key ?? '')}
					<button
						class="issue-row"
						class:issue-acknowledged={isAcknowledged}
						onclick={() => expandedIssue = expandedIssue === (issue.key ?? String(i)) ? null : (issue.key ?? String(i))}
					>
						<span class="issue-severity-badge" style:background={severityColor(issue.severity)}>
							{(issue.severity ?? 'unknown').toUpperCase()}
						</span>
						<span class="issue-title" class:issue-title-dimmed={isAcknowledged}>
							{issue.title ?? 'Untitled issue'}
						</span>
						{#if issue.category}
							<span class="issue-category">{issue.category}</span>
						{/if}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="ack-btn"
						class:ack-btn-undo={isAcknowledged}
						role="button"
						tabindex="0"
						onclick={(e) => { e.stopPropagation(); toggleAcknowledge(issue); }}
					>
						{ackLoading === (issue.key ?? '') ? '...' : isAcknowledged ? 'UNDO' : 'ACK'}
					</span>
					</button>
					{#if expandedIssue === (issue.key ?? String(i)) && issue.description}
						<div class="issue-detail">
							<p class="issue-description">{issue.description}</p>
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Snapshot history -->
		<div class="section-heading" style="margin-top: 2rem">Snapshot History ({snapshots.length})</div>
		<div class="snapshot-list">
			{#each snapshots as snap (snap.id)}
				<a href="/dashboard/audit/security/{snap.id}" class="snapshot-row">
					<span class="snapshot-time">{relativeTime(snap.createdAt)}</span>
					<span class="snapshot-stat">{snap.issueCount} issues</span>
					{#if snap.criticalCount > 0}
						<span class="snapshot-critical">{snap.criticalCount} critical</span>
					{/if}
					<span class="snapshot-meta">{snap.roleCount} roles · {snap.channelCount} channels</span>
				</a>
			{/each}
		</div>
	{/if}
</SpringReveal>

<style>
	.summary-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 1rem;
	}

	.last-scan {
		font-size: 0.75rem;
		color: var(--ink-faint);
		margin: 0.75rem 0 1.5rem;
	}

	.section-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--line);
	}

	.section-heading::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--sage);
		flex-shrink: 0;
	}

	.issues-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.issue-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast);
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
	}

	.issue-row:hover {
		background: var(--surface-2);
	}

	.issue-acknowledged {
		opacity: 0.5;
	}

	.issue-severity-badge {
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		color: var(--void);
		flex-shrink: 0;
	}

	.issue-title {
		font-size: 0.8rem;
		color: var(--ink);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.issue-title-dimmed {
		text-decoration: line-through;
	}

	.issue-category {
		font-size: 0.65rem;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.ack-btn {
		font-size: 0.55rem;
		font-weight: 700;
		color: var(--sage);
		border: 1px solid var(--sage);
		border-radius: 3px;
		padding: 0.1rem 0.35rem;
		flex-shrink: 0;
		cursor: pointer;
		transition: all var(--duration-fast);
		user-select: none;
	}

	.ack-btn:hover {
		background: var(--sage);
		color: var(--void);
	}

	.ack-btn-undo {
		color: var(--good);
		border-color: var(--good);
	}

	.ack-btn-undo:hover {
		background: var(--good);
		color: var(--void);
	}

	.issue-detail {
		padding: 0.5rem 0.75rem 0.75rem 2.5rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		margin-top: -2px;
	}

	.issue-description {
		font-size: 0.8rem;
		color: var(--ink-2);
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.snapshot-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.snapshot-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
		transition: background var(--duration-fast);
	}

	.snapshot-row:hover {
		background: var(--surface-2);
	}

	.snapshot-time {
		font-size: 0.75rem;
		color: var(--ink-2);
		min-width: 6rem;
	}

	.snapshot-stat {
		font-size: 0.75rem;
		color: var(--ink);
		font-weight: 500;
	}

	.snapshot-critical {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--danger);
	}

	.snapshot-meta {
		font-size: 0.7rem;
		color: var(--ink-faint);
		margin-left: auto;
	}

	@media (max-width: 768px) {
		.summary-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (max-width: 480px) {
		.summary-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.issue-category, .snapshot-meta {
			display: none;
		}
	}
</style>
