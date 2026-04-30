<script lang="ts">
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { line, curveMonotoneX } from 'd3-shape';
	import { timeFormat } from 'd3-time-format';
	import { extent } from 'd3-array';
	import { OVERLAY_METRIC_KEYS, type OverlayWeek, type OverlayMetricKey } from '$lib/shared/quality-types';

	let { data, height = 360 }: { data: OverlayWeek[]; height?: number } = $props();

	const META: Record<OverlayMetricKey, { label: string; color: string }> = {
		effort:              { label: 'LLM effort',         color: '#f0b86e' },
		heuristic:           { label: 'Heuristic v0',       color: '#cf8d4a' },
		resonance:           { label: 'Resonance',          color: '#6ea7f0' },
		median_length:       { label: 'Median length',      color: '#9adb89' },
		lexical_diversity:   { label: 'Lexical diversity',  color: '#5cc69d' },
		question_rate:       { label: 'Question rate',      color: '#c79dee' },
		no_repeat_spam:      { label: 'Anti-spam',          color: '#ef6f6f' },
		no_lowlist_hit:      { label: 'Anti-throwaway',     color: '#ee9c5d' },
		reply_rate:          { label: 'Reply rate',         color: '#6ed6e8' },
		author_distribution: { label: 'Author distribution',color: '#ed7eb1' },
	};

	let containerWidth = $state(0);
	let mode = $state<'minmax' | 'zscore'>('minmax');
	let smoothWindow = $state(1);
	let visible = $state(Object.fromEntries(OVERLAY_METRIC_KEYS.map((k) => [k, true])) as Record<OverlayMetricKey, boolean>);

	const margin = { top: 14, right: 16, bottom: 28, left: 44 };
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(height - margin.top - margin.bottom);

	const parsed = $derived(data.map((d) => ({ ...d, date: new Date(d.weekStart * 1000) })));
	const xScale = $derived(scaleTime().domain(extent(parsed, (d) => d.date) as [Date, Date]).range([0, innerWidth]));

	function smooth(values: number[], n: number): number[] {
		if (n <= 1) return values.slice();
		const out: number[] = new Array(values.length);
		for (let i = 0; i < values.length; i++) {
			const start = Math.max(0, i - n + 1);
			let s = 0, c = 0;
			for (let j = start; j <= i; j++) { s += values[j]; c++; }
			out[i] = s / c;
		}
		return out;
	}

	const stats = $derived(() => {
		const o = {} as Record<OverlayMetricKey, { min: number; max: number; mean: number; std: number }>;
		for (const k of OVERLAY_METRIC_KEYS) {
			const vals = parsed.map((d) => d.raw[k]);
			const min = Math.min(...vals), max = Math.max(...vals);
			const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
			const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vals.length);
			o[k] = { min, max, mean, std: Math.sqrt(variance) || 1 };
		}
		return o;
	});

	const transformed = $derived(() => {
		const out = {} as Record<OverlayMetricKey, number[]>;
		const s = stats();
		for (const k of OVERLAY_METRIC_KEYS) {
			const sm = smooth(parsed.map((d) => d.raw[k]), smoothWindow);
			if (mode === 'minmax') {
				out[k] = sm.map((v) => s[k].max > s[k].min ? (v - s[k].min) / (s[k].max - s[k].min) : 0.5);
			} else {
				out[k] = sm.map((v) => (v - s[k].mean) / s[k].std);
			}
		}
		return out;
	});

	const yDomain = $derived(() => {
		if (mode === 'minmax') return [0, 1];
		const t = transformed();
		let lo = 0, hi = 0;
		for (const k of OVERLAY_METRIC_KEYS) {
			if (!visible[k]) continue;
			for (const v of t[k]) { if (v < lo) lo = v; if (v > hi) hi = v; }
		}
		const pad = (hi - lo) * 0.05 || 1;
		return [lo - pad, hi + pad];
	});

	const yScale = $derived(scaleLinear().domain(yDomain()).range([innerHeight, 0]));
	const yTicks = $derived(yScale.ticks(5));
	const xTicks = $derived(xScale.ticks(Math.min(Math.floor(innerWidth / 90), 8)).map((d) => ({ pos: xScale(d), label: timeFormat('%b %Y')(d) })));

	function lineFor(k: OverlayMetricKey): string {
		const t = transformed()[k];
		const gen = line<number>().x((_, i) => xScale(parsed[i].date)).y((v) => yScale(v)).curve(curveMonotoneX);
		return gen(t) ?? '';
	}
</script>

<div class="wrap" bind:clientWidth={containerWidth}>
	<div class="controls">
		<label>Smoothing
			<input type="range" min="1" max="12" step="1" bind:value={smoothWindow} />
			<span class="val">{smoothWindow === 1 ? '1 week (raw)' : `${smoothWindow} weeks`}</span>
		</label>
		<div class="modes">
			<button class:active={mode === 'minmax'} onclick={() => (mode = 'minmax')}>Min-max [0,1]</button>
			<button class:active={mode === 'zscore'} onclick={() => (mode = 'zscore')}>Z-score</button>
		</div>
	</div>

	<div class="legend">
		{#each OVERLAY_METRIC_KEYS as k}
			<button class="legend-item" class:dim={!visible[k]} onclick={() => (visible = { ...visible, [k]: !visible[k] })}>
				<span class="swatch" style="background: {META[k].color};"></span>{META[k].label}
			</button>
		{/each}
	</div>

	{#if containerWidth > 0 && parsed.length > 1}
		<svg width={containerWidth} {height} role="img" aria-label="10 quality metrics overlaid">
			<g transform="translate({margin.left},{margin.top})">
				{#each yTicks as tick}
					<line x1={0} x2={innerWidth} y1={yScale(tick)} y2={yScale(tick)} class="grid" />
					<text x={-8} y={yScale(tick)} class="ax" text-anchor="end" dominant-baseline="central">{mode === 'zscore' ? (tick >= 0 ? '+' : '') + tick.toFixed(1) : tick.toFixed(1)}</text>
				{/each}
				{#if mode === 'zscore'}
					<line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} class="zero-line" />
				{/if}
				{#each xTicks as tick}
					<text x={tick.pos} y={innerHeight + 18} class="ax" text-anchor="middle">{tick.label}</text>
				{/each}
				{#each OVERLAY_METRIC_KEYS as k}
					{#if visible[k]}
						<path d={lineFor(k)} fill="none" stroke={META[k].color} stroke-width="1.7" opacity="0.85" />
					{/if}
				{/each}
			</g>
		</svg>
	{:else}
		<div class="empty">Not enough data.</div>
	{/if}
</div>

<style>
	.wrap { width: 100%; }
	svg { display: block; width: 100%; }
	.grid { stroke: var(--terminal-grid, #1f232c); stroke-width: 0.5; }
	.zero-line { stroke: #3a4150; stroke-dasharray: 3 4; stroke-width: 1; }
	.ax { font-size: 0.6rem; fill: var(--text-secondary); }
	.controls { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; font-size: 12px; color: var(--text-secondary); }
	.controls label { display: inline-flex; align-items: center; gap: 8px; }
	.controls input[type=range] { width: 220px; accent-color: #f0b86e; }
	.controls .val { color: var(--text-primary); min-width: 88px; font-variant-numeric: tabular-nums; }
	.modes { display: inline-flex; background: #1a1d24; border: 1px solid var(--terminal-grid, #1f232c); border-radius: 6px; padding: 2px; }
	.modes button { background: transparent; border: 0; color: var(--text-secondary); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
	.modes button.active { background: #2a2f3a; color: var(--text-primary); }
	.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 12px; font-size: 12px; }
	.legend-item { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; }
	.legend-item:hover { background: #1c2028; }
	.legend-item.dim { opacity: 0.35; }
	.swatch { width: 14px; height: 3px; display: inline-block; border-radius: 2px; }
	.empty { color: var(--text-secondary); font-size: 0.8rem; padding: 2rem; text-align: center; }
</style>
