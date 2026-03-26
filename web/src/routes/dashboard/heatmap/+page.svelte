<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import HeatmapGrid from '$lib/components/charts/HeatmapGrid.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { BarChart3, Clock, TrendingUp, Calendar } from 'lucide-svelte';

	let { data } = $props();
	let heatmap = $derived(data.heatmap);
	let trends = $derived(heatmap.trends);
	let weeks = $derived(data.weeks as 1 | 2 | 4 | 8);
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
	let rangeLabel = $derived(weeks === 1 ? 'this week' : `past ${weeks} weeks`);
	let multiWeek = $derived(heatmap.weeks.length > 1);

	type WeekCount = 1 | 2 | 4 | 8;
	const weekOptions: { id: WeekCount; label: string }[] = [
		{ id: 1, label: '1W' },
		{ id: 2, label: '2W' },
		{ id: 4, label: '4W' },
		{ id: 8, label: '8W' }
	];

	function selectWeeks(w: WeekCount) {
		if (w === weeks) return;
		const params = new URLSearchParams($page.url.searchParams);
		params.set('weeks', String(w));
		goto(`?${params.toString()}`, { keepFocus: true });
	}

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
		<div class="selector" role="radiogroup" aria-label="Week range">
			{#each weekOptions as w}
				<button
					role="radio"
					aria-checked={weeks === w.id}
					class="chip"
					class:active={weeks === w.id}
					onclick={() => selectWeeks(w.id)}
				>
					{w.label}
				</button>
			{/each}
		</div>
	</div>

	{#if hasData}
		<div class="stats-grid">
			<div class="card">
				<div class="card-icon-row">
					<BarChart3 size={16} color="var(--accent)" />
				</div>
				<span class="card-label">Total Messages</span>
				<StatNumber value={trends.totalMessages} label="" trend={growthTrend} />
				<span class="card-sub">{rangeLabel}</span>
			</div>

			<div class="card">
				<div class="card-icon-row">
					<Clock size={16} color="var(--text-tertiary)" />
				</div>
				<span class="card-label">Avg / Hour</span>
				<StatNumber value={trends.avgMessagesPerHour} label="" />
				<span class="card-sub">across all hours</span>
			</div>

			<div class="card highlight-accent">
				<div class="card-icon-row">
					<TrendingUp size={16} color="var(--accent)" />
				</div>
				<span class="card-label">Busiest Hours</span>
				<div class="text-value">{trends.busiestHours}</div>
				<span class="card-sub">quietest: {trends.leastActiveHours}</span>
			</div>

			<div class="card">
				<div class="card-icon-row">
					<Calendar size={16} color="var(--text-tertiary)" />
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

	.selector {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.chip {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		padding: 6px 14px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms ease;
	}

	@media (hover: hover) {
		.chip:hover {
			color: var(--text-primary);
			border-color: var(--terminal-border);
		}
	}

	.chip.active {
		color: var(--text-primary);
		background: oklch(72% 0.18 var(--hue) / 0.12);
		border-color: var(--terminal-border);
		box-shadow:
			0 0 8px oklch(72% 0.18 var(--hue) / 0.25),
			inset 0 0 6px oklch(72% 0.18 var(--hue) / 0.08);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid color-mix(in oklch, var(--accent) 15%, var(--border-holdfast));
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
		color: var(--accent-muted);
		margin-bottom: 0.5rem;
	}

	.card-sub {
		display: block;
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.text-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.2;
	}

	.card.highlight-accent {
		border-color: color-mix(in oklch, var(--accent) 40%, transparent);
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
		border-top: 1px solid var(--border-holdfast);
		margin: 1.25rem 0;
	}

	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.chip {
			min-height: 44px;
			display: flex;
			align-items: center;
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
