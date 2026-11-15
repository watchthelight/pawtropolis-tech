<script lang="ts">
	import { scaleLinear } from 'd3-scale';
	import { max } from 'd3-array';
	import type { EffortBin } from '$lib/shared/quality-types';

	let {
		data,
		cutoff = 0.2,
		height = 210
	}: {
		data: EffortBin[];
		/** Scores under this count as low effort. */
		cutoff?: number;
		height?: number;
	} = $props();

	let containerWidth = $state(0);
	let hovered = $state<number | null>(null);

	// The bins touch, as the score has no gaps. Two pixels of surface keep them apart.
	const GAP = 2;
	const margin = { top: 22, right: 12, bottom: 26, left: 48 };
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(height - margin.top - margin.bottom);

	const total = $derived(data.reduce((sum, bin) => sum + bin.count, 0));
	const low = $derived(data.reduce((sum, bin) => sum + (bin.binEnd <= cutoff ? bin.count : 0), 0));
	const highest = $derived(Math.max(max(data, (bin) => bin.count) ?? 0, 1));

	const x = $derived(scaleLinear().domain([0, 1]).range([0, innerWidth]));
	const y = $derived(scaleLinear().domain([0, highest]).range([innerHeight, 0]).nice(4));
	const yTicks = $derived(y.ticks(4));

	const pct = (value: number) => `${Math.round(value * 100)}%`;
	const share = (count: number) => (total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0%');
	// One style per axis: full numbers, or thousands once the axis reaches 10,000.
	const tickLabel = (tick: number) =>
		tick > 0 && (y.domain()[1] ?? 0) >= 10_000 ? `${tick / 1000}K` : tick.toLocaleString();

	/** A bar with its two upper corners rounded and a square foot on the baseline. */
	function bar(bin: EffortBin): string {
		const left = x(bin.binStart) + GAP / 2;
		const width = Math.max(x(bin.binEnd) - x(bin.binStart) - GAP, 0);
		const top = y(bin.count);
		const r = Math.min(2, width / 2, innerHeight - top);
		return `M${left},${innerHeight}V${top + r}Q${left},${top} ${left + r},${top}H${left + width - r}Q${left + width},${top} ${left + width},${top + r}V${innerHeight}Z`;
	}

	const shown = $derived(hovered === null ? null : (data[hovered] ?? null));
</script>

<div class="chart" bind:clientWidth={containerWidth}>
	{#if total > 0}
		<p class="readout">
			{#if shown}
				<b>{shown.count.toLocaleString()}</b> messages ({share(shown.count)}) scored {pct(shown.binStart)} to {pct(shown.binEnd)}
			{:else}
				<b>{share(low)}</b> of {total.toLocaleString()} messages scored under {pct(cutoff)}
			{/if}
		</p>

		{#if containerWidth > 0}
			<svg
				width={containerWidth}
				{height}
				role="img"
				aria-label="Spread of effort scores: {total.toLocaleString()} messages, {share(low)} of them under {pct(cutoff)}"
				onpointerleave={() => (hovered = null)}
			>
				<g transform="translate({margin.left},{margin.top})">
					{#each yTicks as tick}
						<line x1={0} x2={innerWidth} y1={y(tick)} y2={y(tick)} class="grid" />
						<text x={-8} y={y(tick)} class="axis" text-anchor="end" dominant-baseline="central">{tickLabel(tick)}</text>
					{/each}

					{#each data as bin, i}
						<path d={bar(bin)} class="bar" class:low={bin.binEnd <= cutoff} class:lit={hovered === i} />
					{/each}

					<line x1={x(cutoff)} x2={x(cutoff)} y1={-14} y2={innerHeight} class="cutoff" />
					<text x={x(cutoff) + 6} y={-8} class="axis note">low effort under {pct(cutoff)}</text>

					{#each [0, 0.25, 0.5, 0.75, 1] as mark}
						<text x={x(mark)} y={innerHeight + 16} class="axis" text-anchor="middle">{pct(mark)}</text>
					{/each}

					<!-- The whole column is the target, so a short bar is as easy to reach as a tall one. -->
					{#each data as bin, i}
						<rect
							x={x(bin.binStart)}
							y={0}
							width={Math.max(x(bin.binEnd) - x(bin.binStart), 0)}
							height={innerHeight}
							class="target"
							role="presentation"
							onpointerenter={() => (hovered = i)}
						/>
					{/each}
				</g>
			</svg>
		{:else}
			<div style:height="{height}px"></div>
		{/if}
	{:else}
		<p class="empty">No scores in this window.</p>
	{/if}
</div>

<style>
	.chart {
		width: 100%;
	}

	svg {
		display: block;
		width: 100%;
	}

	.readout {
		margin: 0 0 0.35rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}

	.readout b {
		color: var(--ink);
		font-size: 1.05rem;
		font-weight: 600;
	}

	.grid {
		stroke: var(--line-soft);
		stroke-width: 1;
	}

	.axis {
		font-size: 0.6rem;
		fill: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.axis.note {
		fill: var(--ink-2);
	}

	.bar {
		fill: var(--sage);
	}

	.bar.low {
		fill: var(--ink-3);
	}

	.bar.lit {
		fill: var(--sage-bright);
	}

	.bar.low.lit {
		fill: var(--ink-2);
	}

	.cutoff {
		stroke: var(--line-strong);
		stroke-width: 1;
	}

	.target {
		fill: transparent;
	}

	.empty {
		margin: 0;
		padding: 2rem 0;
		text-align: center;
		font-size: 0.75rem;
		color: var(--ink-2);
	}
</style>
