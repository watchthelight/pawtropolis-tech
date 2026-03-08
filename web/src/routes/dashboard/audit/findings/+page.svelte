<script lang="ts">
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let runs = $derived(data.runs);
	let latest = $derived(runs[0] ?? null);

	function passRate(run: typeof runs[number]): number {
		const total = run.commandCount - run.skipCount;
		return total > 0 ? Math.round((run.passCount / total) * 100) : 0;
	}

	function rateColor(pct: number): string {
		if (pct >= 95) return 'var(--status-success)';
		if (pct >= 80) return 'var(--status-warning)';
		return 'var(--status-danger)';
	}
</script>

<SpringReveal stagger={30}>
	{#if runs.length === 0}
		<EmptyState message="No audit runs" subtitle="Run a command audit from Discord to see results here" />
	{:else}
		<!-- Latest run summary -->
		{#if latest}
			{@const rate = passRate(latest)}
			<div class="latest-grid">
				<DataCard>
					<div class="rate-display" style:color={rateColor(rate)}>{rate}%</div>
					<span class="rate-label">Pass Rate</span>
				</DataCard>
				<DataCard>
					<StatNumber value={latest.commandCount} label="Commands" />
				</DataCard>
				<DataCard accent={latest.failCount > 0}>
					<StatNumber value={latest.failCount} label="Failures" />
				</DataCard>
				<DataCard>
					<StatNumber value={latest.errorCount} label="Errors" />
				</DataCard>
			</div>
			<p class="latest-time">Latest run: {relativeTime(latest.startedAt)}</p>
		{/if}

		<!-- Runs table -->
		<div class="section-heading">All Runs ({runs.length})</div>
		<div class="runs-table">
			<div class="runs-header">
				<span>Run</span>
				<span>Date</span>
				<span>Commands</span>
				<span>Pass</span>
				<span>Fail</span>
				<span>Rate</span>
			</div>
			{#each runs as run (run.auditRunId)}
				{@const rate = passRate(run)}
				<a href="/dashboard/audit/findings/{run.auditRunId}" class="runs-row">
					<span class="run-id">{run.auditRunId.slice(0, 8)}</span>
					<span class="run-date">{relativeTime(run.startedAt)}</span>
					<span>{run.commandCount}</span>
					<span style:color="var(--status-success)">{run.passCount}</span>
					<span style:color={run.failCount > 0 ? 'var(--status-danger)' : 'var(--text-secondary)'}>{run.failCount}</span>
					<span class="run-rate" style:color={rateColor(rate)}>{rate}%</span>
				</a>
			{/each}
		</div>
	{/if}
</SpringReveal>

<style>
	.latest-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.rate-display {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1.1;
	}

	.rate-label {
		font-size: 0.8rem;
		color: var(--accent-muted);
		margin-top: 0.15rem;
	}

	.latest-time {
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

	.runs-table {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.runs-header, .runs-row {
		display: grid;
		grid-template-columns: 1.5fr 1.5fr 1fr 0.8fr 0.8fr 0.8fr;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		align-items: center;
	}

	.runs-header {
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 0.65rem;
	}

	.runs-row {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		text-decoration: none;
		transition: background var(--duration-fast);
	}

	.runs-row:hover {
		background: var(--surface-raised);
	}

	.run-id {
		font-family: var(--terminal-font);
		font-size: 0.7rem;
		color: var(--accent-muted);
	}

	.run-date {
		color: var(--text-secondary);
	}

	.run-rate {
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.latest-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.runs-header, .runs-row {
			grid-template-columns: 1fr 1fr 0.8fr 0.8fr;
		}

		.runs-header span:nth-child(5),
		.runs-header span:nth-child(6),
		.runs-row span:nth-child(5),
		.runs-row span:nth-child(6) {
			display: none;
		}
	}
</style>
