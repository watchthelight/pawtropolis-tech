<script lang="ts">
	import { scaleLinear, scaleBand } from 'd3-scale';
	import { max } from 'd3-array';
	import type { EffortBin } from '$lib/shared/quality-types';

	let { data, height = 180 }: { data: EffortBin[]; height?: number } = $props();

	let containerWidth = $state(0);
	const margin = { top: 8, right: 12, bottom: 28, left: 36 };
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(height - margin.top - margin.bottom);

	const x = $derived(scaleBand<number>().domain(data.map((_, i) => i)).range([0, innerWidth]).padding(0.08));
	const yMax = $derived(max(data, (d) => d.count) ?? 1);
	const y = $derived(scaleLinear().domain([0, yMax]).range([innerHeight, 0]).nice());

	const yTicks = $derived(y.ticks(4));
</script>

<div class="wrap" bind:clientWidth={containerWidth}>
	{#if containerWidth > 0 && data.length}
		<svg width={containerWidth} {height} role="img" aria-label="Effort score distribution">
			<g transform="translate({margin.left},{margin.top})">
				{#each yTicks as tick}
					<line x1={0} x2={innerWidth} y1={y(tick)} y2={y(tick)} class="grid" />
					<text x={-8} y={y(tick)} class="ax" text-anchor="end" dominant-baseline="central">{tick.toLocaleString()}</text>
				{/each}

				{#each data as bin, i}
					<rect x={x(i)} y={y(bin.count)} width={x.bandwidth()} height={innerHeight - y(bin.count)} class="bar" class:low={bin.binStart < 0.20} />
				{/each}

				{#each [0, 0.25, 0.5, 0.75, 1] as v}
					<text x={(v * innerWidth)} y={innerHeight + 18} class="ax" text-anchor="middle">{v.toFixed(2)}</text>
				{/each}
			</g>
		</svg>
	{:else}
		<div class="empty">No effort data for this window.</div>
	{/if}
</div>

<style>
	.wrap { width: 100%; }
	svg { display: block; width: 100%; }
	.grid { stroke: var(--terminal-grid, #1f232c); stroke-width: 0.5; }
	.ax { font-size: 0.6rem; fill: var(--text-secondary); }
	.bar { fill: var(--accent, #f0b86e); opacity: 0.85; }
	.bar.low { fill: #ef6f6f; opacity: 0.85; }
	.empty { color: var(--text-secondary); font-size: 0.8rem; padding: 2rem; text-align: center; }
</style>
