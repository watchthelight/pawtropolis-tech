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

	function severityColor(severity: string | undefined): string {
		switch (severity) {
			case 'critical': return 'var(--status-danger)';
			case 'high': return 'oklch(65% 0.15 40)';
			case 'medium': return 'var(--status-warning)';
			case 'low': return 'var(--status-info)';
			default: return 'var(--text-secondary)';
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
						{#if isAcknowledged}
							<span class="issue-ack-badge">ACK</span>
						{/if}
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
		color: var(--text-muted);
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
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast);
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
	}

	.issue-row:hover {
		background: var(--surface-raised);
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
		color: var(--bg);
		flex-shrink: 0;
	}

	.issue-title {
		font-size: 0.8rem;
		color: var(--text-primary);
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
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.issue-ack-badge {
		font-size: 0.55rem;
		font-weight: 700;
		color: var(--status-success);
		border: 1px solid var(--status-success);
		border-radius: 3px;
		padding: 0 0.25rem;
		flex-shrink: 0;
	}

	.issue-detail {
		padding: 0.5rem 0.75rem 0.75rem 2.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		margin-top: -2px;
	}

	.issue-description {
		font-size: 0.8rem;
		color: var(--text-secondary);
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
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
		transition: background var(--duration-fast);
	}

	.snapshot-row:hover {
		background: var(--surface-raised);
	}

	.snapshot-time {
		font-size: 0.75rem;
		color: var(--text-secondary);
		min-width: 6rem;
	}

	.snapshot-stat {
		font-size: 0.75rem;
		color: var(--text-primary);
		font-weight: 500;
	}

	.snapshot-critical {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--status-danger);
	}

	.snapshot-meta {
		font-size: 0.7rem;
		color: var(--text-muted);
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
