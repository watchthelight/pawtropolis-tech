<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let health = $derived(data.health);
	let alerts = $derived(data.alerts);

	/** Threshold color for WS ping */
	function pingColor(ms: number): string {
		if (ms < 100) return 'var(--status-success)';
		if (ms <= 500) return 'var(--status-warning)';
		return 'var(--status-danger)';
	}

	/** Threshold color for percentage-based metrics */
	function percentColor(pct: number, amberAt: number = 70, redAt: number = 90): string {
		if (pct < amberAt) return 'var(--status-success)';
		if (pct <= redAt) return 'var(--status-warning)';
		return 'var(--status-danger)';
	}

	function severityColor(severity: string): string {
		return severity === 'critical' ? 'var(--status-danger)' : 'var(--status-warning)';
	}

	function alertStatusLabel(status: string): string {
		if (status === 'resolved') return 'Resolved';
		if (status === 'acknowledged') return 'Acknowledged';
		return 'Active';
	}

	function alertStatusColor(status: string): string {
		if (status === 'resolved') return 'var(--status-success)';
		if (status === 'acknowledged') return 'var(--status-info, var(--accent))';
		return 'var(--status-danger)';
	}

	function formatAlertType(type: string): string {
		// Preserve known acronyms (DB, PM2, WS, P95)
		return type.replace(/_/g, ' ')
			.replace(/\b\w+/g, w => {
				const upper = w.toUpperCase();
				if (['DB', 'PM2', 'WS', 'P95'].includes(upper)) return upper;
				return w.charAt(0).toUpperCase() + w.slice(1);
			});
	}

	function formatResolution(alert: typeof alerts[number]): string {
		if (alert.status !== 'resolved' || !alert.resolvedAt) return '';
		const durationMs = alert.resolvedAt - alert.triggeredAt;
		const minutes = Math.round(durationMs / 60000);
		if (minutes < 60) return `${minutes}m to resolve`;
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return mins > 0 ? `${hours}h ${mins}m to resolve` : `${hours}h to resolve`;
	}
</script>

<SpringReveal stagger={30}>
	<PageHeader title="System" subtitle="Bot system health" />

	<!-- Live metrics from bot API -->
	{#if health}
		<div class="metrics-grid">
			<DataCard>
				<span class="metric-uptime">{health.uptimeFormatted}</span>
				<span class="metric-detail">Uptime</span>
			</DataCard>
			<DataCard>
				<div class="metric-colored" style:color={pingColor(health.wsPingMs)}>
					<StatNumber value={health.wsPingMs} label="WS Ping" />
					<span class="metric-unit">ms</span>
				</div>
			</DataCard>
			<DataCard>
				{@const memPct = Math.round((health.memory.heapUsedMB / health.memory.heapTotalMB) * 100)}
				<div class="metric-colored" style:color={percentColor(memPct)}>
					<StatNumber value={memPct} label="Memory" />
					<span class="metric-unit">%</span>
				</div>
				<span class="metric-detail">{health.memory.heapUsedMB} / {health.memory.heapTotalMB} MB (RSS: {health.memory.rssMB} MB)</span>
			</DataCard>
			<DataCard>
				<div class="metric-colored" style:color={percentColor(health.disk.percentUsed, 70, 85)}>
					<StatNumber value={health.disk.percentUsed} label="Disk" />
					<span class="metric-unit">%</span>
				</div>
				<span class="metric-detail">{health.disk.usedGB} / {health.disk.totalGB} GB</span>
			</DataCard>
		</div>

		<!-- DB integrity -->
		<div class="db-status">
			<span class="db-dot" style:background={health.dbIntegrity.ok ? 'var(--status-success)' : 'var(--status-danger)'} aria-hidden="true"></span>
			<span class="db-label" aria-label="Database status: {health.dbIntegrity.message}">Database: {health.dbIntegrity.message}</span>
		</div>
	{:else}
		<div class="offline-banner">
			Bot offline — live metrics unavailable
		</div>
	{/if}

	<!-- Health alerts from SQLite -->
	<div class="section-heading">Recent Alerts ({alerts.length})</div>

	{#if alerts.length === 0}
		<EmptyState message="No recent alerts" subtitle="All systems healthy" />
	{:else}
		<ul class="alert-list" role="list">
			{#each alerts as alert (alert.id)}
				<li class="alert-row">
					<span class="alert-severity" style:background={severityColor(alert.severity)}>
						{alert.severity.toUpperCase()}
					</span>
					<span class="alert-type">{formatAlertType(alert.alertType)}</span>
					<span class="alert-time">{relativeTime(alert.triggeredAt)}</span>
					<span class="alert-status" style:color={alertStatusColor(alert.status)}>
						{alertStatusLabel(alert.status)}
					</span>
					{#if alert.status === 'resolved' && alert.resolvedAt}
						<span class="alert-resolution">{formatResolution(alert)}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</SpringReveal>

<style>
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.metric-uptime {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.metric-detail {
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
		display: block;
	}

	.metric-colored {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.metric-unit {
		font-size: 0.75rem;
		font-weight: 600;
		opacity: 0.8;
	}

	.db-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.db-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.db-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.offline-banner {
		padding: 1rem;
		text-align: center;
		background: var(--surface);
		border: 1px solid var(--status-danger);
		border-radius: var(--radius-sm);
		color: var(--status-danger);
		font-size: 0.85rem;
		font-weight: 500;
		margin-bottom: 1.5rem;
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
		border-bottom: 1px solid var(--border);
	}

	.section-heading::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}

	.alert-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.alert-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.alert-severity {
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		color: var(--bg);
		flex-shrink: 0;
	}

	.alert-type {
		font-size: 0.8rem;
		color: var(--text-primary);
		flex: 1;
	}

	.alert-time {
		font-size: 0.7rem;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.alert-status {
		font-size: 0.65rem;
		font-weight: 600;
		flex-shrink: 0;
	}

	.alert-resolution {
		font-size: 0.6rem;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	@media (max-width: 768px) {
		.metrics-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
