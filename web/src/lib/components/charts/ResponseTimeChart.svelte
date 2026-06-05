<script lang="ts">
	import { onMount } from 'svelte';
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { line, curveMonotoneX } from 'd3-shape';
	import { area } from 'd3-shape';
	import { timeFormat } from 'd3-time-format';
	import { max, extent } from 'd3-array';
	import gsap from 'gsap';
	import { prefersReducedMotion } from '$lib/motion';
	import { formatDuration } from '$lib/utils/time';
	import type { DailyAvgSeconds } from '$lib/server/queries/stats';

	let { data, height = 140 }: { data: DailyAvgSeconds[]; height?: number } = $props();

	let containerWidth = $state(0);

	const margin = { top: 8, right: 12, bottom: 28, left: 48 };
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(height - margin.top - margin.bottom);

	const parsed = $derived(
		data.map((d) => ({ date: new Date(d.day + 'T00:00:00Z'), seconds: d.avg_seconds }))
	);

	const xScale = $derived(
		scaleTime()
			.domain(extent(parsed, (d) => d.date) as [Date, Date])
			.range([0, innerWidth])
	);

	const yMax = $derived(Math.max(max(parsed, (d) => d.seconds) ?? 60, 60));
	const yScale = $derived(scaleLinear().domain([0, yMax]).range([innerHeight, 0]).nice());

	const areaPath = $derived(
		area<{ date: Date; seconds: number }>()
			.x((d) => xScale(d.date))
			.y0(innerHeight)
			.y1((d) => yScale(d.seconds))
			.curve(curveMonotoneX)(parsed) ?? ''
	);

	const linePath = $derived(
		line<{ date: Date; seconds: number }>()
			.x((d) => xScale(d.date))
			.y((d) => yScale(d.seconds))
			.curve(curveMonotoneX)(parsed) ?? ''
	);

	const yTicks = $derived(yScale.ticks(4));
	const xTicks = $derived(
		xScale.ticks(Math.min(Math.floor(innerWidth / 80), 8)).map((d) => ({
			pos: xScale(d),
			label: timeFormat('%b %d')(d)
		}))
	);

	let lineEl: SVGPathElement | undefined;

	onMount(() => {
		if (prefersReducedMotion() || !lineEl) return;
		const len = lineEl.getTotalLength();
		gsap.fromTo(
			lineEl,
			{ strokeDasharray: `${len}`, strokeDashoffset: len },
			{ strokeDashoffset: 0, duration: 1.2, ease: 'power2.out' }
		);
	});

	const uid = `resp-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="chart-wrap" bind:clientWidth={containerWidth}>
	{#if containerWidth > 0 && parsed.length > 1}
		<svg width={containerWidth} {height}>
			<defs>
				<linearGradient id="{uid}-grad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="oklch(65% 0.12 200)" stop-opacity="0.2" />
					<stop offset="100%" stop-color="oklch(65% 0.12 200)" stop-opacity="0" />
				</linearGradient>
			</defs>

			<g transform="translate({margin.left},{margin.top})">
				<!-- Grid lines -->
				{#each yTicks as tick}
					<line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} class="grid-line" />
				{/each}

				<!-- Area fill -->
				<path d={areaPath} fill="url(#{uid}-grad)" />

				<!-- Line -->
				<path bind:this={lineEl} d={linePath} fill="none" class="chart-line" />

				<!-- Data points -->
				{#each parsed as p}
					<circle
						cx={xScale(p.date)}
						cy={yScale(p.seconds)}
						r="3"
						class="data-point"
					>
						<title>{timeFormat('%b %d')(p.date)}: {formatDuration(p.seconds)}</title>
					</circle>
				{/each}

				<!-- Y axis labels (formatted duration) -->
				{#each yTicks as tick}
					<text x={-8} y={yScale(tick)} class="axis-label y-label" text-anchor="end" dominant-baseline="central">
						{formatDuration(tick)}
					</text>
				{/each}

				<!-- X axis labels -->
				{#each xTicks as tick}
					<text x={tick.pos} y={innerHeight + 18} class="axis-label" text-anchor="middle">
						{tick.label}
					</text>
				{/each}
			</g>
		</svg>
	{:else if parsed.length <= 1}
		<div class="empty">Not enough response time data for this period</div>
	{/if}
</div>

<style>
	.chart-wrap {
		width: 100%;
		min-height: 80px;
	}

	.chart-line {
		stroke: oklch(65% 0.12 200);
		stroke-width: 2;
		filter: drop-shadow(0 0 4px oklch(65% 0.12 200 / 0.5));
	}

	.data-point {
		fill: oklch(65% 0.12 200);
		stroke: oklch(80% 0.12 200);
		stroke-width: 1;
		cursor: default;
		transition: r 150ms ease;
	}

	@media (hover: hover) {
		.data-point:hover {
			r: 5;
		}
	}

	.grid-line {
		stroke: var(--terminal-grid);
		stroke-width: 0.5;
	}

	.axis-label {

		font-size: 0.6rem;
		fill: var(--ink-2);
	}

	.y-label {
		font-size: 0.55rem;
	}

	.empty {

		font-size: 0.75rem;
		color: var(--ink-2);
		padding: 2rem;
		text-align: center;
	}
</style>
