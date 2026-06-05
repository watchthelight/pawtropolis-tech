<script lang="ts">
	import { onMount } from 'svelte';
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { area, line, curveMonotoneX } from 'd3-shape';
	import { timeFormat } from 'd3-time-format';
	import { max, extent } from 'd3-array';
	import gsap from 'gsap';
	import { prefersReducedMotion } from '$lib/motion';
	import type { DailyCount } from '$lib/server/queries/stats';

	let { data, height = 160 }: { data: DailyCount[]; height?: number } = $props();

	let containerWidth = $state(0);

	const margin = { top: 8, right: 12, bottom: 28, left: 36 };
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(height - margin.top - margin.bottom);

	const parsed = $derived(
		data.map((d) => ({ date: new Date(d.day + 'T00:00:00Z'), count: d.count }))
	);

	const xScale = $derived(
		scaleTime()
			.domain(extent(parsed, (d) => d.date) as [Date, Date])
			.range([0, innerWidth])
	);

	const yMax = $derived(Math.max(max(parsed, (d) => d.count) ?? 1, 1));
	const yScale = $derived(scaleLinear().domain([0, yMax]).range([innerHeight, 0]).nice());

	const areaPath = $derived(
		area<{ date: Date; count: number }>()
			.x((d) => xScale(d.date))
			.y0(innerHeight)
			.y1((d) => yScale(d.count))
			.curve(curveMonotoneX)(parsed) ?? ''
	);

	const linePath = $derived(
		line<{ date: Date; count: number }>()
			.x((d) => xScale(d.date))
			.y((d) => yScale(d.count))
			.curve(curveMonotoneX)(parsed) ?? ''
	);

	// Y axis ticks
	const yTicks = $derived(yScale.ticks(4));

	// X axis ticks (auto D3)
	const xTicks = $derived(
		xScale.ticks(Math.min(Math.floor(innerWidth / 80), 8)).map((d) => ({
			pos: xScale(d),
			label: timeFormat('%b %d')(d)
		}))
	);

	let clipRect: SVGRectElement | undefined;
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		if (prefersReducedMotion() || !clipRect) return;
		gsap.fromTo(clipRect, { width: 0 }, { width: innerWidth, duration: 1, ease: 'power2.out' });
	});

	// Unique ID for gradient/clip
	const uid = `activity-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="chart-wrap" bind:clientWidth={containerWidth}>
	{#if containerWidth > 0 && parsed.length > 1}
		<svg width={containerWidth} {height}>
			<defs>
				<linearGradient id="{uid}-grad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="oklch(72% 0.18 var(--hue))" stop-opacity="0.3" />
					<stop offset="100%" stop-color="oklch(72% 0.18 var(--hue))" stop-opacity="0" />
				</linearGradient>
				<clipPath id="{uid}-clip">
					<rect bind:this={clipRect} x="0" y="0" width={mounted || prefersReducedMotion() ? innerWidth : 0} height={innerHeight + 2} />
				</clipPath>
			</defs>

			<g transform="translate({margin.left},{margin.top})">
				<!-- Grid lines -->
				{#each yTicks as tick}
					<line
						x1={0}
						x2={innerWidth}
						y1={yScale(tick)}
						y2={yScale(tick)}
						class="grid-line"
					/>
				{/each}

				<!-- Area + line (clipped for animation) -->
				<g clip-path="url(#{uid}-clip)">
					<path d={areaPath} fill="url(#{uid}-grad)" />
					<path d={linePath} fill="none" class="chart-line" />
				</g>

				<!-- Y axis labels -->
				{#each yTicks as tick}
					<text x={-8} y={yScale(tick)} class="axis-label y-label" text-anchor="end" dominant-baseline="central">
						{tick}
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
		<div class="empty">No activity data for this period</div>
	{/if}
</div>

<style>
	.chart-wrap {
		width: 100%;
		min-height: 80px;
	}

	.chart-line {
		stroke: var(--sage);
		stroke-width: 2;
		filter: drop-shadow(0 0 4px oklch(72% 0.18 var(--hue) / 0.4));
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
