<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import HeatmapGrid from '$lib/components/charts/HeatmapGrid.svelte';
	import TimeWindowSelector from '$lib/components/charts/TimeWindowSelector.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { BarChart3, Clock, TrendingUp, Calendar } from 'lucide-svelte';

	let { data } = $props();
	let heatmap = $derived(data.heatmap);
	let trends = $derived(heatmap.trends);
	let hasData = $derived(trends.totalMessages > 0);
	let growthTrend = $derived<'up' | 'down' | undefined>(
		trends.weekOverWeekGrowth == null
			? undefined
			: trends.weekOverWeekGrowth > 0
				? 'up'
				: trends.weekOverWeekGrowth < 0
					? 'down'
					: undefined
	);
	let rangeLabel = $derived(data.windowLabel);
	let multiWeek = $derived(heatmap.weeks.length > 1);

	const weekTitleFmt = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
	const weekTitleYearFmt = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});

	function formatWeekTitle(startDate: string, endDate: string): string {
		return `${weekTitleFmt.format(new Date(startDate))} – ${weekTitleYearFmt.format(new Date(endDate))}`;
	}
</script>

<SpringReveal stagger={30}>
	<div class="header">
		<PageHeader title="Heatmap" subtitle="Server activity patterns" />
		<TimeWindowSelector value={data.spec} />
	</div>

	{#if hasData}
		<div class="stats-grid">
			<div class="card">
				<div class="card-icon-row">
					<BarChart3 size={16} color="var(--sage)" />
				</div>
				<span class="card-label">Total Messages</span>
				<StatNumber value={trends.totalMessages} label="" trend={growthTrend} />
				<span class="card-sub">{rangeLabel}</span>
			</div>

			<div class="card">
				<div class="card-icon-row">
					<Clock size={16} color="var(--ink-3)" />
				</div>
				<span class="card-label">Avg / Hour</span>
				<StatNumber value={trends.avgMessagesPerHour} label="" />
				<span class="card-sub">across all hours</span>
			</div>

			<div class="card highlight-accent">
				<div class="card-icon-row">
					<TrendingUp size={16} color="var(--sage)" />
				</div>
				<span class="card-label">Busiest Hours</span>
				<div class="text-value">{trends.busiestHours}</div>
				<span class="card-sub">quietest: {trends.leastActiveHours}</span>
			</div>

			<div class="card">
				<div class="card-icon-row">
					<Calendar size={16} color="var(--ink-3)" />
				</div>
				<span class="card-label">Peak Days</span>
				<div class="text-value">{trends.peakDays.join(', ')}</div>
				<span class="card-sub">quietest: {trends.quietestDays.join(', ')}</span>
			</div>
		</div>

		<div class="heatmap-card card">
			<div class="heatmap-scroll">
				{#each heatmap.weeks as week, i}
					<HeatmapGrid
						grid={week.grid}
						maxValue={heatmap.maxValue}
						dates={week.dates}
						title={multiWeek ? formatWeekTitle(week.startDate, week.endDate) : undefined}
						showLegend={i === heatmap.weeks.length - 1}
					/>
					{#if i < heatmap.weeks.length - 1}
						<hr class="week-divider" />
					{/if}
				{/each}
			</div>
		</div>
	{:else}
		<EmptyState message="No message activity recorded yet" subtitle="Activity data will appear here once messages are tracked." />
	{/if}
</SpringReveal>

<style>
	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid color-mix(in oklch, var(--sage) 15%, var(--line));
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.card-icon-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.card-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--sage-muted);
		margin-bottom: 0.5rem;
	}

	.card-sub {
		display: block;
		font-size: 0.7rem;
		color: var(--ink-2);
		margin-top: 0.25rem;
	}

	.text-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--ink);
		line-height: 1.2;
	}

	.card.highlight-accent {
		border-color: color-mix(in oklch, var(--sage) 40%, transparent);
	}

	.heatmap-card {
		margin-top: 1.5rem;
	}

	.heatmap-scroll {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.week-divider {
		border: none;
		border-top: 1px solid var(--line);
		margin: 1.25rem 0;
	}

	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.header {
			flex-direction: column;
		}

		.stats-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
