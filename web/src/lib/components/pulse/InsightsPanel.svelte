<script lang="ts">
	import type { Insight } from '$lib/server/queries/pulse';
	import { fade } from 'svelte/transition';
	import {
		TrendingUp, TrendingDown, Minus,
		Users, MessageSquare, Shield, AlertTriangle, UserCheck,
		CheckCircle, ChevronDown
	} from 'lucide-svelte';

	let { insights }: { insights: Insight[] } = $props();

	let expanded = $state(false);
	const MAX_VISIBLE = 8;

	let visibleInsights = $derived(
		expanded ? insights : insights.slice(0, MAX_VISIBLE)
	);
	let hasMore = $derived(insights.length > MAX_VISIBLE);

	const categoryIcons: Record<string, typeof Users> = {
		growth: Users,
		engagement: MessageSquare,
		moderation: Shield,
		risk: AlertTriangle,
		retention: UserCheck
	};

	const categoryLabels: Record<string, string> = {
		growth: 'Growth',
		engagement: 'Engagement',
		moderation: 'Moderation',
		risk: 'Risk',
		retention: 'Retention'
	};

	const severityColors: Record<string, { text: string; bg: string; border: string }> = {
		critical: {
			text: 'var(--danger)',
			bg: 'oklch(60% 0.15 25 / 0.1)',
			border: 'oklch(60% 0.15 25 / 0.25)'
		},
		warning: {
			text: 'var(--warn)',
			bg: 'oklch(70% 0.15 85 / 0.08)',
			border: 'oklch(70% 0.15 85 / 0.2)'
		},
		info: {
			text: 'var(--info)',
			bg: 'oklch(65% 0.12 250 / 0.08)',
			border: 'oklch(65% 0.12 250 / 0.15)'
		}
	};

	function trendIcon(trend: 'up' | 'down' | 'flat' | undefined) {
		if (trend === 'up') return TrendingUp;
		if (trend === 'down') return TrendingDown;
		return Minus;
	}
</script>

{#if insights.length === 0}
	<div class="insight-card all-clear" transition:fade={{ duration: 200 }}>
		<div class="all-clear-inner">
			<CheckCircle size={20} color="var(--good)" />
			<div>
				<span class="all-clear-title">All clear</span>
				<span class="all-clear-body">No actionable insights detected. Everything looks healthy.</span>
			</div>
		</div>
	</div>
{:else}
	<div class="insights-grid">
		{#each visibleInsights as insight, i (insight.id)}
			{@const colors = severityColors[insight.severity]}
			{@const CatIcon = categoryIcons[insight.category] ?? AlertTriangle}
			<div
				class="insight-card"
				style:border-color={colors.border}
				style:background={`var(--surface)`}
				transition:fade={{ duration: 200, delay: i * 30 }}
			>
				<div class="insight-top">
					<span class="insight-badge" style:color={colors.text} style:background={colors.bg}>
						<CatIcon size={11} />
						{categoryLabels[insight.category]}
					</span>
					{#if insight.metric}
						<span class="insight-metric" style:color={colors.text}>
							{insight.metric}
							{#if insight.trend}
								{@const TrendComp = trendIcon(insight.trend)}
								<TrendComp size={12} />
							{/if}
						</span>
					{/if}
				</div>

				<span class="insight-title">{insight.title}</span>
				<span class="insight-body">{insight.body}</span>

				{#if insight.suggestion}
					<span class="insight-suggestion">{insight.suggestion}</span>
				{/if}
			</div>
		{/each}
	</div>

	{#if hasMore}
		<button class="show-more" onclick={() => expanded = !expanded}>
			<ChevronDown size={14} style={expanded ? 'transform: rotate(180deg)' : ''} />
			{expanded ? 'Show less' : `Show all ${insights.length} insights`}
		</button>
	{/if}
{/if}

<style>
	.insights-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.insight-card {
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.all-clear {
		border-color: oklch(65% 0.15 145 / 0.2);
	}

	.all-clear-inner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.all-clear-title {
		display: block;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--good);
	}

	.all-clear-body {
		display: block;
		font-size: 0.7rem;
		color: var(--ink-2);
	}

	.insight-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.insight-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
	}

	.insight-metric {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.insight-title {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--ink);
		line-height: 1.3;
	}

	.insight-body {
		font-size: 0.7rem;
		color: var(--ink-2);
		line-height: 1.5;
	}

	.insight-suggestion {
		font-size: 0.65rem;
		color: var(--ink-faint);
		line-height: 1.4;
		font-style: italic;
		margin-top: 0.15rem;
	}

	.show-more {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		width: 100%;
		padding: 0.5rem;
		margin-top: 0.5rem;
		background: transparent;
		border: 1px dashed var(--line-soft);
		border-radius: var(--radius-sm);
		color: var(--ink-3);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.show-more:hover {
		color: var(--sage);
		border-color: var(--sage-deep);
		background: var(--hover-bg);
	}

	@media (max-width: 768px) {
		.insights-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
