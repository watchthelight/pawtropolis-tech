<script lang="ts">
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import type { SSEEvent } from '$lib/types/events';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
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
	let showTrend = $derived(!(data.spec.kind === 'preset' && data.spec.preset === 'all'));
	let hasData = $derived(personal.total > 0);
	let team = $derived(data.team);
	let hasTeamData = $derived(team.reviewers.length > 0);

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

	// Live stats updates via SSE
	let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
	function onStatsUpdated(event: SSEEvent) {
		const payload = event as SSEEvent & { userId?: string };
		// My Stats tab: only refresh if the event is for the current user
		// Team tab: refresh on any stats:updated event (any reviewer's action changes team totals)
		if (activeTab === 'mine' && payload.userId !== data.userId) return;
		if (invalidateTimer) clearTimeout(invalidateTimer);
		invalidateTimer = setTimeout(() => invalidateAll(), 150);
	}

	subscribe('stats:updated', onStatsUpdated);
	onDestroy(() => {
		unsubscribe('stats:updated', onStatsUpdated);
		if (invalidateTimer) clearTimeout(invalidateTimer);
	});

	const donutSegments = $derived([
		{ label: 'Approved', value: personal.approvals, color: 'oklch(65% 0.15 145)' },
		{ label: 'Rejected', value: personal.rejections, color: 'oklch(70% 0.15 85)' },
		{ label: 'Perm Reject', value: personal.permRejects, color: 'oklch(60% 0.15 25)' },
		{ label: 'Kicks', value: personal.kicks, color: 'oklch(65% 0.12 290)' },
		{ label: 'Modmail', value: personal.modmail, color: 'oklch(65% 0.12 200)' }
	]);
</script>

<SpringReveal stagger={30}>
	<!-- Header -->
	<div class="header">
		<div>
			<PageHeader title="Stats" subtitle="Your review performance" />
		</div>
		<div class="header-right">
			<div class="tab-bar" role="tablist">
				<button
					role="tab"
					aria-selected={activeTab === 'mine'}
					class="tab"
					class:tab-active={activeTab === 'mine'}
					onclick={() => switchTab('mine')}
				>
					My Stats
				</button>
				<button
					role="tab"
					aria-selected={activeTab === 'team'}
					class="tab"
					class:tab-active={activeTab === 'team'}
					onclick={() => switchTab('team')}
				>
					Team
				</button>
			</div>
			<TimeWindowSelector value={data.spec} />
		</div>
	</div>

	{#if activeTab === 'mine'}
		{#if hasData}
			{#key data.windowLabel}
				<div class="stats-grid">
					<!-- Stat cards row -->
					<a href="/dashboard/reviews" class="card clickable" title="View review queue">
						<span class="card-label">Decisions</span>
						<StatNumber value={personal.total} label="" trend={showTrend ? trend.total.direction : undefined} />
						{#if showTrend && trend.total.label}
							<span class="trend-label">{trend.total.label}</span>
						{/if}
					</a>
					<a href="/dashboard/reviews?tab=unclaimed" class="card clickable" title="View unclaimed reviews">
						<span class="card-label">Approved</span>
						<StatNumber value={personal.approvals} label="" trend={showTrend ? trend.approvals.direction : undefined} />
						{#if showTrend && trend.approvals.label}
							<span class="trend-label">{trend.approvals.label}</span>
						{/if}
					</a>
					<a href="/dashboard/reviews?tab=completed" class="card clickable" title="View completed reviews">
						<span class="card-label">Rejected</span>
						<StatNumber value={personal.rejections + personal.permRejects + personal.kicks} label="" trend={showTrend ? trend.rejections.direction : undefined} />
						{#if showTrend && trend.rejections.label}
							<span class="trend-label">{trend.rejections.label}</span>
						{/if}
					</a>
					<div class="card">
						<span class="card-label">Modmail</span>
						<StatNumber value={personal.modmail} label="" />
					</div>

					<!-- Donut chart -->
					<div class="card donut-panel">
						<span class="card-label">Action Breakdown</span>
						<div class="donut-wrap">
							<DonutChart segments={donutSegments} />
						</div>
					</div>

					<!-- Activity timeline -->
					<div class="card activity-panel">
						<span class="card-label">Activity Timeline</span>
						<ActivityChart data={data.timeline} />
					</div>

					<!-- Response time trend -->
					<div class="card response-panel">
						<span class="card-label">Response Time Trend</span>
						<ResponseTimeChart data={data.responseTrend} />
					</div>

					<!-- Avg time cards -->
					<div class="card avg-card">
						<span class="card-label">Avg Claim to Decision</span>
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
							<span class="trend-label">your avg response</span>
						{/if}
					</div>
					<div class="card avg-card">
						<span class="card-label">Avg Submit to Claim</span>
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
							<span class="trend-label">server avg queue time</span>
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

			<p class="window-label">{data.windowLabel}</p>
		{:else}
			<EmptyState
				message="Not enough data yet"
				subtitle="Start reviewing applications to see your stats here."
			/>
		{/if}
	{:else}
		{#if hasTeamData}
			{#key data.windowLabel}
				<!-- Summary cards -->
				<div class="team-summary">
					<div class="card">
						<span class="card-label">Team Decisions</span>
						<StatNumber value={team.summary.totalDecisions} label="" />
					</div>
					<div class="card">
						<span class="card-label">Active Reviewers</span>
						<StatNumber value={team.summary.activeReviewers} label="" />
					</div>
					<div class="card">
						<span class="card-label">Avg Response Time</span>
						<span class="time-value">{formatDuration(team.summary.avgTeamResponseTimeS)}</span>
						<span class="trend-label">team avg claim to decision</span>
					</div>
				</div>

				<!-- Reviewer leaderboard -->
				<div class="leaderboard">
					<span class="card-label">Reviewers</span>
					<div class="leaderboard-table">
						<div class="lb-header">
							<span class="lb-rank">#</span>
							<span class="lb-name">Name</span>
							<span class="lb-stat">Total</span>
							<span class="lb-stat">Approved</span>
							<span class="lb-stat">Rejected</span>
						</div>
						{#each team.reviewers as reviewer, i}
							<div class="lb-row">
								<span class="lb-rank">{i + 1}</span>
								<span class="lb-name">{reviewer.displayName}</span>
								<span class="lb-stat lb-stat-total">{reviewer.total}</span>
								<span class="lb-stat lb-stat-approve">{reviewer.approvals}</span>
								<span class="lb-stat lb-stat-reject">{reviewer.rejections + reviewer.permRejects + reviewer.kicks}</span>
							</div>
						{/each}
					</div>
				</div>
			{/key}

			<p class="window-label">{data.windowLabel}</p>
		{:else}
			<EmptyState
				message="No team activity"
				subtitle="No decisions in this time period."
			/>
		{/if}
	{/if}
</SpringReveal>

<style>
	/* ─── Header ─── */
	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	/* ─── Tabs (matches reviews TabBar) ─── */
	.tab-bar {
		display: flex;
		gap: 0.25rem;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-2);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.tab:hover {
			color: var(--ink);
			background: var(--surface-2);
		}
	}

	.tab:active {
		background: var(--surface-2);
	}

	.tab-active {
		color: var(--ink);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}

	/* ─── Grid layout ─── */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 1rem;
	}

	/* ─── Cards (matches DataCard aesthetic) ─── */
	.card {
		grid-column: span 3;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
		text-decoration: none;
		display: block;
		color: inherit;
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.card.clickable {
		cursor: pointer;
	}

	@media (hover: hover) {
		.card.clickable:hover {
			box-shadow: var(--shadow-md);
			transform: translateY(-2px);
		}
	}

	.card-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
		margin-bottom: 0.5rem;
	}

	/* ─── Chart panels ─── */
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
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--ink);
		line-height: 1.2;
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
		color: var(--good);
	}

	.trend-down {
		color: var(--danger);
	}

	/* ─── Trend labels ─── */
	.trend-label {
		display: block;
		font-size: 0.7rem;
		color: var(--ink-2);
		margin-top: 0.25rem;
	}

	/* ─── Breakdown ─── */
	.breakdown-row {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.breakdown-tag {
		font-size: 0.75rem;
		color: var(--ink-2);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px 10px;
	}

	/* ─── Window label ─── */
	.window-label {
		font-size: 0.75rem;
		color: var(--ink-2);
		margin-top: 1rem;
		opacity: 0.6;
	}

	/* ─── Team summary ─── */
	.team-summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.team-summary .card {
		grid-column: span 1;
	}

	/* ─── Leaderboard ─── */
	.leaderboard {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
	}

	.leaderboard-table {
		display: flex;
		flex-direction: column;
	}

	.lb-header {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--line);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
	}

	.lb-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem 0;
		border-bottom: 1px solid var(--line-soft);
		font-size: 0.85rem;
		color: var(--ink);
		transition: background 150ms var(--ease-smooth);
	}

	.lb-row:last-child {
		border-bottom: none;
	}

	@media (hover: hover) {
		.lb-row:hover {
			background: var(--surface-2);
		}
	}

	.lb-rank {
		width: 2rem;
		flex-shrink: 0;
		color: var(--ink-2);
		font-weight: 600;
		font-size: 0.75rem;
	}

	.lb-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lb-stat {
		width: 4rem;
		flex-shrink: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.lb-stat-total {
		font-weight: 600;
	}

	.lb-stat-approve {
		color: var(--good);
	}

	.lb-stat-reject {
		color: var(--danger);
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.header {
			flex-direction: column;
		}

		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.card {
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

		.tab {
			min-height: 44px;
		}

		.time-value {
			font-size: 1.4rem;
		}

		.team-summary {
			grid-template-columns: 1fr;
		}

		.lb-stat {
			width: 3rem;
			font-size: 0.75rem;
		}
	}

	@media (max-width: 480px) {
		.stats-grid {
			grid-template-columns: 1fr;
		}

		.card,
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
