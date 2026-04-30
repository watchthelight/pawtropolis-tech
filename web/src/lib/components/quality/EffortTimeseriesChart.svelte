<script lang="ts">
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { line, curveMonotoneX } from 'd3-shape';
	import { timeFormat } from 'd3-time-format';
	import { extent } from 'd3-array';
	import type { QualityWeekBucket } from '$lib/shared/quality-types';

	let { data, height = 280 }: { data: QualityWeekBucket[]; height?: number } = $props();

	let containerWidth = $state(0);
	const margin = { top: 14, right: 16, bottom: 28, left: 38 };
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(height - margin.top - margin.bottom);

	const parsed = $derived(data.map((d) => ({ ...d, date: new Date(d.weekStart * 1000) })));

	const xScale = $derived(scaleTime().domain(extent(parsed, (d) => d.date) as [Date, Date]).range([0, innerWidth]));
	const yScale = $derived(scaleLinear().domain([0, 1]).range([innerHeight, 0]));

	const lineEffort = $derived(line<typeof parsed[0]>().x((d) => xScale(d.date)).y((d) => yScale(d.meanEffort)).curve(curveMonotoneX)(parsed) ?? '');
	const lineRolling = $derived(line<typeof parsed[0]>().x((d) => xScale(d.date)).y((d) => yScale(d.rolling4w)).curve(curveMonotoneX)(parsed) ?? '');
	const lineResonance = $derived(line<typeof parsed[0]>().x((d) => xScale(d.date)).y((d) => yScale(d.meanResonance)).curve(curveMonotoneX)(parsed) ?? '');

	const yTicks = $derived(yScale.ticks(5));
	const xTicks = $derived(
		xScale.ticks(Math.min(Math.floor(innerWidth / 90), 8)).map((d) => ({ pos: xScale(d), label: timeFormat('%b %Y')(d) }))
	);

	let hoverIdx = $state<number | null>(null);
	function onMove(ev: MouseEvent) {
		const target = ev.currentTarget as SVGSVGElement;
		const r = target.getBoundingClientRect();
		const mx = ev.clientX - r.left - margin.left;
		if (mx < 0 || mx > innerWidth) { hoverIdx = null; return; }
		const t = xScale.invert(mx).getTime();
		let best = 0, bestDiff = Infinity;
		for (let i = 0; i < parsed.length; i++) {
			const d = Math.abs(parsed[i].date.getTime() - t);
			if (d < bestDiff) { bestDiff = d; best = i; }
		}
		hoverIdx = best;
	}
</script>

<div class="wrap" bind:clientWidth={containerWidth}>
	{#if containerWidth > 0 && parsed.length > 1}
		<svg width={containerWidth} {height} onmousemove={onMove} onmouseleave={() => (hoverIdx = null)} role="img" aria-label="Effort and resonance over time">
			<g transform="translate({margin.left},{margin.top})">
				{#each yTicks as tick}
					<line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} class="grid" />
					<text x={-8} y={yScale(tick)} class="ax y" text-anchor="end" dominant-baseline="central">{tick.toFixed(1)}</text>
				{/each}
				{#each xTicks as tick}
					<text x={tick.pos} y={innerHeight + 18} class="ax" text-anchor="middle">{tick.label}</text>
				{/each}

				<path d={lineEffort} class="line effort" />
				<path d={lineRolling} class="line rolling" />
				<path d={lineResonance} class="line resonance" />

				{#if hoverIdx !== null}
					{@const d = parsed[hoverIdx]}
					<line x1={xScale(d.date)} x2={xScale(d.date)} y1={0} y2={innerHeight} class="hover-rule" />
					<circle cx={xScale(d.date)} cy={yScale(d.meanEffort)} r="3" fill="var(--effort-color, #f0b86e)" />
					<circle cx={xScale(d.date)} cy={yScale(d.meanResonance)} r="3" fill="var(--resonance-color, #6ea7f0)" />
				{/if}
			</g>
		</svg>

		{#if hoverIdx !== null}
			{@const d = parsed[hoverIdx]}
			<div class="tooltip">
				<b>{d.iso}</b> &middot; n={d.count.toLocaleString()}<br />
				<span class="effort">effort {d.meanEffort.toFixed(2)}</span> (rolling {d.rolling4w.toFixed(2)})<br />
				<span class="resonance">resonance {d.meanResonance.toFixed(2)}</span> &middot; low-effort {(d.lowEffortShare * 100).toFixed(0)}%
			</div>
		{/if}

		<div class="legend">
			<span class="lk effort"></span>weekly mean effort
			<span class="lk rolling"></span>4-week rolling
			<span class="lk resonance"></span>resonance
		</div>
	{:else}
		<div class="empty">Not enough data for this window yet.</div>
	{/if}
</div>

<style>
	.wrap { width: 100%; position: relative; }
	svg { display: block; width: 100%; }
	.grid { stroke: var(--terminal-grid, #1f232c); stroke-width: 0.5; }
	.ax { font-size: 0.6rem; fill: var(--text-secondary); }
	.line { fill: none; stroke-width: 2; }
	.line.effort { stroke: #f0b86e; opacity: 0.55; stroke-width: 1.4; }
	.line.rolling { stroke: #ffd699; stroke-width: 2.4; }
	.line.resonance { stroke: #6ea7f0; stroke-width: 1.8; opacity: 0.85; }
	.hover-rule { stroke: var(--text-secondary); stroke-dasharray: 2 2; opacity: 0.4; }
	.tooltip { position: absolute; bottom: 28px; right: 12px; background: #1a1d24; border: 1px solid var(--terminal-grid, #1f232c); border-radius: 6px; padding: 8px 10px; font-size: 12px; line-height: 1.5; pointer-events: none; }
	.tooltip .effort { color: #f0b86e; }
	.tooltip .resonance { color: #6ea7f0; }
	.legend { display: flex; gap: 14px; font-size: 11px; color: var(--text-secondary); margin-top: 4px; align-items: center; }
	.lk { display: inline-block; width: 14px; height: 2px; margin-right: 4px; vertical-align: middle; }
	.lk.effort { background: #f0b86e; opacity: 0.55; }
	.lk.rolling { background: #ffd699; height: 3px; }
	.lk.resonance { background: #6ea7f0; }
	.empty { color: var(--text-secondary); font-size: 0.8rem; padding: 2rem; text-align: center; }
</style>
