<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import TimeWindowSelector from '$lib/components/charts/TimeWindowSelector.svelte';
	import DonutChart from '$lib/components/charts/DonutChart.svelte';
	import ActivityChart from '$lib/components/charts/ActivityChart.svelte';
	import ResponseTimeChart from '$lib/components/charts/ResponseTimeChart.svelte';
	import { formatDuration } from '$lib/utils/time';

	let { data } = $props();
	let personal = $derived(data.personal);
	let trend = $derived(data.trend);
	let showTrend = $derived(data.window !== 'all');
	let hasData = $derived(personal.total > 0);

	type TabId = 'mine' | 'team';
	const VALID_TABS: TabId[] = ['mine', 'team'];
	const urlTab = $page.url.searchParams.get('tab');
	let activeTab = $state<TabId>(
		urlTab && VALID_TABS.includes(urlTab as TabId) ? (urlTab as TabId) : 'mine'
	);

	function switchTab(tab: TabId) {
		activeTab = tab;
		const params = new URLSearchParams($page.url.searchParams);
		params.set('tab', tab);
		goto(`?${params.toString()}`, { keepFocus: true, replaceState: true });
	}

	const donutSegments = $derived([
		{ label: 'Approved', value: personal.approvals, color: 'oklch(65% 0.15 145)' },
		{ label: 'Rejected', value: personal.rejections, color: 'oklch(70% 0.15 85)' },
		{ label: 'Perm Reject', value: personal.permRejects, color: 'oklch(60% 0.15 25)' },
		{ label: 'Kicks', value: personal.kicks, color: 'oklch(65% 0.12 290)' },
		{ label: 'Modmail', value: personal.modmail, color: 'oklch(65% 0.12 200)' }
	]);
</script>

<div class="terminal-bg">
<SpringReveal stagger={30}>
	<!-- Header -->
	<div class="header">
		<div class="header-left">
			<h1 class="page-title">
				<span class="title-prefix">//</span> OPERATOR STATS
			</h1>
			<!-- Tab bar -->
			<div class="tab-bar" role="tablist">
				<button
					role="tab"
					aria-selected={activeTab === 'mine'}
					class="tab-chip"
					class:tab-active={activeTab === 'mine'}
					onclick={() => switchTab('mine')}
				>
					MY STATS
				</button>
				<button
					role="tab"
					aria-selected={activeTab === 'team'}
					class="tab-chip"
					class:tab-active={activeTab === 'team'}
					onclick={() => switchTab('team')}
				>
					TEAM
				</button>
			</div>
		</div>
		{#if activeTab === 'mine'}
			<TimeWindowSelector value={data.window} />
		{/if}
	</div>

	{#if activeTab === 'mine'}
		{#if hasData}
			{#key data.window}
				<div class="stats-grid">
					<!-- Stat cards row -->
					<a href="/dashboard/reviews" class="stat-card clickable" title="View review queue">
						<span class="card-label">// DECISIONS</span>
						<StatNumber value={personal.total} label="" trend={showTrend ? trend.total.direction : undefined} />
						{#if showTrend && trend.total.label}
							<span class="trend-label">{trend.total.label}</span>
						{/if}
					</a>
					<a href="/dashboard/reviews?tab=unclaimed" class="stat-card clickable" title="View unclaimed reviews">
						<span class="card-label">// APPROVED</span>
						<StatNumber value={personal.approvals} label="" trend={showTrend ? trend.approvals.direction : undefined} />
						{#if showTrend && trend.approvals.label}
							<span class="trend-label">{trend.approvals.label}</span>
						{/if}
					</a>
					<a href="/dashboard/reviews?tab=completed" class="stat-card clickable" title="View completed reviews">
						<span class="card-label">// REJECTED</span>
						<StatNumber value={personal.rejections + personal.permRejects + personal.kicks} label="" trend={showTrend ? trend.rejections.direction : undefined} />
						{#if showTrend && trend.rejections.label}
							<span class="trend-label">{trend.rejections.label}</span>
						{/if}
					</a>
					<div class="stat-card">
						<span class="card-label">// MODMAIL</span>
						<StatNumber value={personal.modmail} label="" />
					</div>

					<!-- Donut chart -->
					<div class="chart-panel donut-panel scanlines">
						<span class="card-label">// ACTION BREAKDOWN</span>
						<div class="donut-wrap">
							<DonutChart segments={donutSegments} />
						</div>
					</div>

					<!-- Activity timeline -->
					<div class="chart-panel activity-panel scanlines">
						<span class="card-label">// ACTIVITY TIMELINE</span>
						<ActivityChart data={data.timeline} />
					</div>

					<!-- Response time trend -->
					<div class="chart-panel response-panel scanlines">
						<span class="card-label">// RESPONSE TIME TREND</span>
						<ResponseTimeChart data={data.responseTrend} />
					</div>

					<!-- Avg time cards -->
					<div class="stat-card avg-card">
						<span class="card-label">// AVG CLAIM → DECISION</span>
						<div class="time-row">
							<span class="time-value">{formatDuration(personal.avgClaimToDecisionS)}</span>
							{#if showTrend && trend.avgClaimToDecision.direction !== 'neutral'}
								<span class="trend-arrow" class:trend-up={trend.avgClaimToDecision.direction === 'up'} class:trend-down={trend.avgClaimToDecision.direction === 'down'}>
									{trend.avgClaimToDecision.direction === 'up' ? '↑' : '↓'}
								</span>
							{/if}
						</div>
						{#if showTrend && trend.avgClaimToDecision.label}
							<span class="trend-label">{trend.avgClaimToDecision.label}</span>
						{:else}
							<span class="time-sublabel">your avg response</span>
						{/if}
					</div>
					<div class="stat-card avg-card">
						<span class="card-label">// AVG SUBMIT → CLAIM</span>
						<div class="time-row">
							<span class="time-value">{formatDuration(personal.avgSubmitToClaimS)}</span>
							{#if showTrend && trend.avgSubmitToClaim.direction !== 'neutral'}
								<span class="trend-arrow" class:trend-up={trend.avgSubmitToClaim.direction === 'up'} class:trend-down={trend.avgSubmitToClaim.direction === 'down'}>
									{trend.avgSubmitToClaim.direction === 'up' ? '↑' : '↓'}
								</span>
							{/if}
						</div>
						{#if showTrend && trend.avgSubmitToClaim.label}
							<span class="trend-label">{trend.avgSubmitToClaim.label}</span>
						{:else}
							<span class="time-sublabel">server avg queue time</span>
						{/if}
					</div>

					<!-- Breakdown detail row -->
					{#if personal.permRejects > 0 || personal.kicks > 0}
						<div class="breakdown-row">
							{#if personal.permRejects > 0}
								<span class="breakdown-tag">
									{personal.permRejects} perm reject{personal.permRejects !== 1 ? 's' : ''}
								</span>
							{/if}
							{#if personal.kicks > 0}
								<span class="breakdown-tag">
									{personal.kicks} kick{personal.kicks !== 1 ? 's' : ''}
								</span>
							{/if}
						</div>
					{/if}
				</div>
			{/key}

			<p class="window-label">
				{data.window === 'all' ? 'All time' : `Last ${data.window.replace('d', ' days')}`}
			</p>
		{:else}
			<EmptyState
				message="Not enough data yet"
				subtitle="Start reviewing applications to see your stats here."
			/>
		{/if}
	{:else}
		<EmptyState
			message="Team stats coming soon"
			subtitle="Team performance view will be available in a future update."
		/>
	{/if}
</SpringReveal>
</div>

<style>
	/* ─── Terminal background ─── */
	.terminal-bg {
		position: relative;
		padding: 0 0 2rem;
		background-image:
			linear-gradient(var(--terminal-grid) 1px, transparent 1px),
			linear-gradient(90deg, var(--terminal-grid) 1px, transparent 1px);
		background-size: 32px 32px;
		min-height: 100%;
	}

	/* ─── Header ─── */
	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.header-left {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.page-title {
		font-family: var(--terminal-font);
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: 0.08em;
		margin: 0;
	}

	.title-prefix {
		color: var(--secondary);
		opacity: 0.7;
	}

	/* ─── Tabs ─── */
	.tab-bar {
		display: flex;
		gap: 4px;
	}

	.tab-chip {
		font-family: var(--terminal-font);
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		padding: 5px 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms ease;
	}

	@media (hover: hover) {
		.tab-chip:hover {
			color: var(--text-primary);
			border-color: var(--terminal-border);
		}
	}

	.tab-active {
		color: var(--text-primary);
		background: var(--secondary-soft);
		border-color: var(--secondary-dim);
	}

	/* ─── Grid layout ─── */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 0.875rem;
	}

	/* ─── Stat cards ─── */
	.stat-card {
		grid-column: span 3;
		position: relative;
		background: var(--surface);
		border: 1px solid var(--terminal-border);
		border-radius: 4px;
		padding: 1.25rem;
		box-shadow: var(--terminal-glow);
		overflow: hidden;
		text-decoration: none;
		display: block;
	}

	.stat-card.clickable {
		cursor: pointer;
		transition: all 150ms ease;
		color: inherit;
	}

	@media (hover: hover) {
		.stat-card.clickable:hover {
			border-color: var(--secondary);
			box-shadow: var(--glow-secondary);
			transform: translateY(-1px);
		}
	}

	/* Corner brackets — warm earth tone */
	.stat-card::before,
	.stat-card::after {
		content: '';
		position: absolute;
		width: 10px;
		height: 10px;
		border-color: var(--secondary);
		border-style: solid;
		opacity: 0.35;
	}

	.stat-card::before {
		top: 5px;
		left: 5px;
		border-width: 1.5px 0 0 1.5px;
	}

	.stat-card::after {
		bottom: 5px;
		right: 5px;
		border-width: 0 1.5px 1.5px 0;
	}

	.card-label {
		display: block;
		font-family: var(--terminal-font);
		font-size: 0.6rem;
		font-weight: 500;
		letter-spacing: 0.12em;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		opacity: 0.7;
	}

	/* ─── Chart panels ─── */
	.chart-panel {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--terminal-border);
		border-radius: 4px;
		padding: 1.25rem;
		box-shadow: var(--terminal-glow);
		overflow: hidden;
	}

	.chart-panel::before,
	.chart-panel::after {
		content: '';
		position: absolute;
		width: 10px;
		height: 10px;
		border-color: var(--secondary);
		border-style: solid;
		opacity: 0.35;
	}

	.chart-panel::before {
		top: 5px;
		left: 5px;
		border-width: 1.5px 0 0 1.5px;
	}

	.chart-panel::after {
		bottom: 5px;
		right: 5px;
		border-width: 0 1.5px 1.5px 0;
	}

	/* Scanline overlay */
	.scanlines::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 1;
		background: repeating-linear-gradient(
			to bottom,
			transparent 0px,
			transparent 3px,
			oklch(0% 0 0 / 0.04) 3px,
			oklch(0% 0 0 / 0.04) 4px
		);
		border-radius: inherit;
	}

	/* Fix: corner bracket is also ::before, so use an inner wrapper approach */
	/* Actually, scanlines override corner bracket. Let's use outline for brackets instead */
	.scanlines.chart-panel::before {
		/* scanline takes priority — brackets via box-shadow on .chart-panel */
		background: repeating-linear-gradient(
			to bottom,
			transparent 0px,
			transparent 3px,
			oklch(0% 0 0 / 0.04) 3px,
			oklch(0% 0 0 / 0.04) 4px
		);
		border: none;
		width: auto;
		height: auto;
		inset: 0;
		top: 0;
		left: 0;
		opacity: 1;
	}

	.donut-panel {
		grid-column: span 4;
		grid-row: span 2;
		display: flex;
		flex-direction: column;
	}

	.donut-wrap {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-top: 0.5rem;
	}

	.activity-panel {
		grid-column: span 8;
	}

	.response-panel {
		grid-column: span 8;
	}

	/* ─── Avg time cards ─── */
	.avg-card {
		grid-column: span 6;
	}

	.time-value {
		display: block;
		font-family: var(--terminal-font);
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.2;
	}

	.time-sublabel {
		display: block;
		font-family: var(--terminal-font);
		font-size: 0.65rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.time-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.trend-arrow {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.trend-up {
		color: var(--status-success);
	}

	.trend-down {
		color: var(--status-danger);
	}

	/* ─── Trend labels ─── */
	.trend-label {
		display: block;
		font-family: var(--terminal-font);
		font-size: 0.6rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
		opacity: 0.8;
	}

	/* ─── Breakdown ─── */
	.breakdown-row {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.breakdown-tag {
		font-family: var(--terminal-font);
		font-size: 0.65rem;
		color: var(--text-secondary);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 4px 10px;
	}

	/* ─── Window label ─── */
	.window-label {
		font-family: var(--terminal-font);
		font-size: 0.65rem;
		color: var(--text-secondary);
		margin-top: 1rem;
		opacity: 0.6;
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.stat-card {
			grid-column: span 1;
		}

		.donut-panel,
		.activity-panel,
		.response-panel {
			grid-column: span 2;
			grid-row: auto;
		}

		.avg-card {
			grid-column: span 2;
		}

		.header {
			flex-direction: column;
		}

		.tab-chip {
			min-height: 44px;
			display: flex;
			align-items: center;
		}

		.time-value {
			font-size: 1.4rem;
		}
	}

	@media (max-width: 480px) {
		.stats-grid {
			grid-template-columns: 1fr;
		}

		.stat-card,
		.donut-panel,
		.activity-panel,
		.response-panel,
		.avg-card {
			grid-column: span 1;
		}

		.donut-panel {
			grid-row: auto;
		}
	}
</style>
