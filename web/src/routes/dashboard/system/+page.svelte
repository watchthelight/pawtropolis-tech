<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let health = $derived(data.health);
	let alerts = $derived(data.alerts);

	// Live polling — every 30s while tab is foregrounded. Pairs with the
	// server-side 20s cached() so each poll either returns from cache (cheap)
	// or refreshes from upstream. Bot health endpoint can take 60-90s cold
	// on this box, so don't poll faster than that.
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		pollTimer = setInterval(() => {
			if (document.visibilityState === 'visible') invalidateAll();
		}, 30_000);
	});
	onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });

	function pingColor(ms: number): string {
		if (ms < 100) return 'var(--status-success)';
		if (ms <= 500) return 'var(--status-warning)';
		return 'var(--status-danger)';
	}
	function pctColor(pct: number, amber = 70, red = 90): string {
		if (pct < amber) return 'var(--status-success)';
		if (pct <= red) return 'var(--status-warning)';
		return 'var(--status-danger)';
	}
	function formatBytesMB(mb: number): string {
		if (mb < 1024) return `${mb} MB`;
		return `${(mb / 1024).toFixed(2)} GB`;
	}
	function formatHostUptime(s: number): string {
		const days = Math.floor(s / 86400);
		const hours = Math.floor((s % 86400) / 3600);
		const minutes = Math.floor((s % 3600) / 60);
		if (days) return `${days}d ${hours}h`;
		if (hours) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}
	function pm2Color(status: string): string {
		if (status === 'online') return 'var(--status-success)';
		if (status === 'launching' || status === 'restarting') return 'var(--status-warning)';
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
		return type.replace(/_/g, ' ').replace(/\b\w+/g, w => {
			const upper = w.toUpperCase();
			if (['DB', 'PM2', 'WS', 'P95'].includes(upper)) return upper;
			return w.charAt(0).toUpperCase() + w.slice(1);
		});
	}
	function formatResolution(alert: typeof alerts[number]): string {
		if (alert.status !== 'resolved' || !alert.resolvedAt) return '';
		const minutes = Math.round((alert.resolvedAt - alert.triggeredAt) / 60000);
		if (minutes < 60) return `${minutes}m to resolve`;
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return mins > 0 ? `${hours}h ${mins}m to resolve` : `${hours}h to resolve`;
	}
</script>

<SpringReveal stagger={30}>
	<PageHeader title="System" subtitle="Process and host telemetry — auto-refreshes every 5s" />

	{#if health}
		<!-- Bot tile row -->
		<div class="section-label">Bot process</div>
		<div class="tile-row">
			<div class="tile">
				<span class="tile-label">Uptime</span>
				<span class="tile-value">{health.uptimeFormatted}</span>
			</div>
			<div class="tile">
				<span class="tile-label">WS ping</span>
				<span class="tile-value" style:color={pingColor(health.wsPingMs)}>
					{health.wsPingMs}<span class="unit"> ms</span>
				</span>
			</div>
			{#if health.memory.heapTotalMB > 0}
				{@const heapPct = Math.round((health.memory.heapUsedMB / health.memory.heapTotalMB) * 100)}
				<div class="tile">
					<span class="tile-label">Heap</span>
					<span class="tile-value" style:color={pctColor(heapPct)}>{heapPct}<span class="unit">%</span></span>
					<span class="tile-sub">{health.memory.heapUsedMB} / {health.memory.heapTotalMB} MB · RSS {health.memory.rssMB} MB</span>
				</div>
			{/if}
			<div class="tile">
				<span class="tile-label">Disk</span>
				<span class="tile-value" style:color={pctColor(health.disk.percentUsed, 70, 85)}>
					{health.disk.percentUsed}<span class="unit">%</span>
				</span>
				<span class="tile-sub">{health.disk.usedGB} / {health.disk.totalGB} GB</span>
			</div>
		</div>

		<!-- DB integrity -->
		<div class="db-status">
			<span class="db-dot" style:background={health.dbIntegrity.ok ? 'var(--status-success)' : 'var(--status-danger)'} aria-hidden="true"></span>
			<span class="db-label">Database: {health.dbIntegrity.message}</span>
		</div>

		<!-- Host metrics -->
		{#if health.host}
			<div class="section-label">Host (EC2)</div>
			<div class="tile-row">
				<div class="tile">
					<span class="tile-label">Load avg</span>
					<span class="tile-value">{health.host.loadavg[0].toFixed(2)}</span>
					<span class="tile-sub">5m {health.host.loadavg[1].toFixed(2)} · 15m {health.host.loadavg[2].toFixed(2)} · {health.host.cpuCount} cores</span>
				</div>
				<div class="tile">
					<span class="tile-label">Host RAM</span>
					<span class="tile-value" style:color={pctColor(health.host.usedMemPct, 75, 90)}>{health.host.usedMemPct}<span class="unit">%</span></span>
					<span class="tile-sub">{formatBytesMB(health.host.totalMemMB - health.host.freeMemMB)} / {formatBytesMB(health.host.totalMemMB)}</span>
				</div>
				<div class="tile">
					<span class="tile-label">Host uptime</span>
					<span class="tile-value">{formatHostUptime(health.host.uptimeS)}</span>
				</div>
			</div>
		{/if}

		<!-- Cost panel -->
		{#if health.cost}
			<div class="section-label">Real-time costs</div>
			<div class="tile-row">
				<div class="tile cost-tile">
					<span class="tile-label">Hourly burn</span>
					<span class="tile-value">${health.cost.hourlyUsd.toFixed(4)}</span>
				</div>
				<div class="tile cost-tile">
					<span class="tile-label">Today (24h)</span>
					<span class="tile-value">${health.cost.dailyUsd.toFixed(2)}</span>
				</div>
				<div class="tile cost-tile">
					<span class="tile-label">Monthly projection</span>
					<span class="tile-value">${health.cost.monthlyUsd.toFixed(2)}</span>
					<span class="tile-sub">{health.cost.note}</span>
				</div>
			</div>
		{/if}

		<!-- PM2 process table -->
		{#if health.pm2 && health.pm2.length > 0}
			<div class="section-label">Processes (PM2)</div>
			<div class="pm2-table">
				<div class="pm2-row pm2-head">
					<span>Name</span><span>Status</span><span>CPU</span><span>Memory</span>
				</div>
				{#each health.pm2 as proc}
					<div class="pm2-row">
						<span class="proc-name">{proc.name}</span>
						<span style:color={pm2Color(proc.status)}>● {proc.status}</span>
						<span class="proc-num">{proc.cpu != null ? `${proc.cpu.toFixed(1)}%` : '—'}</span>
						<span class="proc-num">{proc.memory != null ? formatBytesMB(Math.round(proc.memory / 1024 / 1024)) : '—'}</span>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="offline-banner">
			<div class="offline-msg">Bot offline — live metrics unavailable</div>
			<button class="retry" onclick={() => invalidateAll()}>Retry</button>
		</div>
	{/if}

	<!-- Alerts -->
	<div class="section-label">Recent alerts ({alerts.length})</div>
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
	.section-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin: 1.5rem 0 0.6rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--border);
	}
	.section-label::before {
		content: '';
		width: 4px; height: 4px; border-radius: 50%; background: var(--accent);
	}
	.tile-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.85rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.tile-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); font-weight: 600; }
	.tile-value { font-size: 1.55rem; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1.05; }
	.tile-sub { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.15rem; }
	.unit { font-size: 0.85rem; font-weight: 500; opacity: 0.7; margin-left: 2px; }
	.cost-tile .tile-value { color: var(--accent); }

	.db-status {
		display: flex; align-items: center; gap: 0.5rem;
		margin-top: 0.6rem; padding: 0.5rem 0.75rem;
		background: var(--surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.db-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.db-label { font-size: 0.78rem; color: var(--text-secondary); }

	.pm2-table {
		display: flex; flex-direction: column; gap: 1px;
		background: var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--border);
	}
	.pm2-row {
		display: grid;
		grid-template-columns: 1.5fr 1fr 0.7fr 1fr;
		gap: 0.75rem;
		padding: 0.55rem 0.85rem;
		background: var(--surface);
		font-size: 0.78rem;
		align-items: center;
	}
	.pm2-head { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); font-weight: 600; }
	.proc-name { color: var(--text-primary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }
	.proc-num { color: var(--text-secondary); font-variant-numeric: tabular-nums; }

	.offline-banner {
		display: flex; align-items: center; justify-content: space-between; gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--surface); border: 1px solid var(--status-danger);
		border-radius: var(--radius-md); margin-bottom: 1rem;
	}
	.offline-msg { color: var(--status-danger); font-weight: 500; font-size: 0.85rem; }
	.retry {
		padding: 0.4rem 0.85rem;
		border: 1px solid var(--status-danger);
		background: transparent;
		color: var(--status-danger);
		border-radius: var(--radius-sm);
		font-size: 0.75rem; font-weight: 600;
		cursor: pointer;
	}
	.retry:hover { background: oklch(25% 0.08 25); }

	.alert-list { display: flex; flex-direction: column; gap: 2px; list-style: none; margin: 0; padding: 0; }
	.alert-row {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.alert-severity { font-size: 0.55rem; font-weight: 700; letter-spacing: 0.05em; padding: 0.1rem 0.35rem; border-radius: 3px; color: var(--bg); flex-shrink: 0; }
	.alert-type { font-size: 0.8rem; color: var(--text-primary); flex: 1; }
	.alert-time { font-size: 0.7rem; color: var(--text-secondary); flex-shrink: 0; }
	.alert-status { font-size: 0.65rem; font-weight: 600; flex-shrink: 0; }
	.alert-resolution { font-size: 0.6rem; color: var(--text-secondary); flex-shrink: 0; }

	@media (max-width: 768px) {
		.pm2-row { grid-template-columns: 1fr 1fr; }
		.pm2-head span:nth-child(3), .pm2-head span:nth-child(4),
		.pm2-row:not(.pm2-head) span:nth-child(3), .pm2-row:not(.pm2-head) span:nth-child(4) { display: none; }
	}
</style>
