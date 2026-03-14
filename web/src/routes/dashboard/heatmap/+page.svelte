<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
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
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Heatmap" subtitle="Server activity patterns" />

	{#if hasData}
		<div class="stats-grid">
			<div class="card">
				<div class="card-icon-row">
					<BarChart3 size={16} color="var(--accent)" />
				</div>
				<span class="card-label">Total Messages</span>
				<StatNumber value={trends.totalMessages} label="" trend={growthTrend} />
				<span class="card-sub">this week</span>
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

		<div class="heatmap-placeholder card">
			<EmptyState message="Heatmap visualization" subtitle="Grid visualization coming in the next story." />
		</div>
	{:else}
		<EmptyState message="No message activity recorded yet" subtitle="Activity data will appear here once messages are tracked." />
	{/if}
</SpringReveal>

<style>
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.card {
		background: var(--surface);
		background-image: linear-gradient(180deg, oklch(100% 0 0 / 0.03) 0%, transparent 50%);
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

	.heatmap-placeholder {
		margin-top: 1.5rem;
	}

	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.stats-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
