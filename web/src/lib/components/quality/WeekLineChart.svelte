<script lang="ts">
	import { scaleLinear, scaleUtc } from 'd3-scale';
	import { line, curveMonotoneX } from 'd3-shape';
	import { utcFormat } from 'd3-time-format';

	interface Point {
		weekStart: number;
		/** The line the chart is about. */
		value: number;
		/** A quieter second line of the same measure, such as the unsmoothed weekly value. */
		faint?: number;
		/** More about the week, shown next to the values. */
		note?: string;
	}

	let {
		points,
		format,
		tickFormat,
		label,
		minSpan = 0,
		limits = [-Infinity, Infinity],
		valueName = '',
		faintName = '',
		height = 240,
		compact = false,
		hoverWeek = $bindable(null)
	}: {
		points: Point[];
		format: (value: number) => string;
		/** The form of the axis ticks, when it differs from the values. */
		tickFormat?: (value: number) => string;
		/** What the chart shows, for screen readers. */
		label: string;
		/** The least the axis spans, so that a week-to-week wobble is not drawn as a swing. */
		minSpan?: number;
		/** The values the measure can take. A widened axis stays inside them. */
		limits?: [number, number];
		valueName?: string;
		faintName?: string;
		height?: number;
		/** The small form for a grid of charts: two ticks, first and last date, no legend. */
		compact?: boolean;
		/** The week under the pointer. Bind it to one variable to move all charts of a page together. */
		hoverWeek?: number | null;
	} = $props();

	let containerWidth = $state(0);

	const margin = $derived(
		compact ? { top: 8, right: 8, bottom: 18, left: 44 } : { top: 12, right: 14, bottom: 26, left: 48 }
	);
	const innerWidth = $derived(Math.max(containerWidth - margin.left - margin.right, 0));
	const innerHeight = $derived(Math.max(height - margin.top - margin.bottom, 0));
	const hasFaint = $derived(points.some((point) => point.faint !== undefined));
	const dateOf = (point: Point) => new Date(point.weekStart * 1000);

	const x = $derived(
		scaleUtc()
			.domain([new Date((points[0]?.weekStart ?? 0) * 1000), new Date((points.at(-1)?.weekStart ?? 0) * 1000)])
			.range([0, innerWidth])
	);

	// A line needs no zero baseline, so the axis follows the data. It never spans less than
	// minSpan: an axis stretched over two points would draw noise as a mountain range.
	const y = $derived.by(() => {
		const all = points.flatMap((point) => (point.faint === undefined ? [point.value] : [point.value, point.faint]));
		let low = all.length ? Math.min(...all) : 0;
		let high = all.length ? Math.max(...all) : 1;
		const span = Math.max(high - low, minSpan) || Math.abs(high) * 0.2 || 1;
		const middle = (low + high) / 2;
		low = middle - span / 2;
		high = middle + span / 2;
		if (low < limits[0]) [low, high] = [limits[0], limits[0] + span];
		if (high > limits[1]) [low, high] = [limits[1] - span, limits[1]];
		return scaleLinear().domain([low, high]).range([innerHeight, 0]).nice(compact ? 2 : 4);
	});
	const yTicks = $derived(y.ticks(compact ? 2 : 4));
	const tickText = $derived(tickFormat ?? format);

	const xTicks = $derived.by(() => {
		const first = points[0];
		const last = points.at(-1);
		if (!first || !last) return [];
		const months = last.weekStart - first.weekStart > 120 * 86400;
		const day = utcFormat(months ? '%b %Y' : '%b %d');
		if (compact) {
			return [
				{ pos: 0, label: day(dateOf(first)), anchor: 'start' },
				{ pos: innerWidth, label: day(dateOf(last)), anchor: 'end' }
			];
		}
		const room = Math.max(2, Math.min(Math.floor(innerWidth / 90), 8));
		// Over a few months the ticks are weeks of the line itself, counted back from the newest:
		// a tick between two of them would name a day the line has no point on.
		const step = Math.ceil(points.length / room);
		const dates = months
			? x.ticks(room)
			: points.filter((_, i) => (points.length - 1 - i) % step === 0).map(dateOf);
		return dates.map((date) => {
			const pos = x(date);
			// A label at the right edge would run out of the chart.
			return { pos, label: day(date), anchor: pos > innerWidth - 24 ? 'end' : 'middle' };
		});
	});

	const pathOf = (pick: (point: Point) => number) =>
		line<Point>()
			.x((point) => x(dateOf(point)))
			.y((point) => y(pick(point)))
			.curve(curveMonotoneX)(points) ?? '';
	const valuePath = $derived(pathOf((point) => point.value));
	const faintPath = $derived(hasFaint ? pathOf((point) => point.faint ?? point.value) : '');

	const hovered = $derived(
		hoverWeek === null ? null : (points.find((point) => point.weekStart === hoverWeek) ?? null)
	);
	// Without a pointer the newest week is the one to read.
	const shown = $derived(hovered ?? points.at(-1) ?? null);
	const weekDay = utcFormat('%b %d, %Y');

	function onMove(event: PointerEvent) {
		const left = (event.currentTarget as SVGSVGElement).getBoundingClientRect().left;
		const at = x.invert(Math.max(0, Math.min(innerWidth, event.clientX - left - margin.left))).getTime() / 1000;
		let best: Point | null = null;
		for (const point of points) {
			if (!best || Math.abs(point.weekStart - at) < Math.abs(best.weekStart - at)) best = point;
		}
		hoverWeek = best?.weekStart ?? null;
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			hoverWeek = null;
			return;
		}
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const step = event.key === 'ArrowLeft' ? -1 : 1;
		const at = hovered ? points.indexOf(hovered) + step : points.length - 1;
		hoverWeek = points[Math.max(0, Math.min(points.length - 1, at))]?.weekStart ?? null;
	}
</script>

<div class="chart" class:compact bind:clientWidth={containerWidth}>
	{#if points.length > 1 && shown}
		<p class="readout">
			<b>{format(shown.value)}</b>{#if valueName}<span class="name">{valueName}</span>{/if}
			{#if shown.faint !== undefined}
				<b>{format(shown.faint)}</b><span class="name">{faintName}</span>
			{/if}
			<span class="when">
				{hovered ? `week of ${weekDay(dateOf(shown))}` : 'newest week'}{#if shown.note}, {shown.note}{/if}
			</span>
		</p>

		{#if containerWidth > 0}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (the plot takes focus so the arrow keys can move the readout) -->
			<svg
				width={containerWidth}
				{height}
				role="img"
				aria-label={label}
				tabindex="0"
				onpointermove={onMove}
				onpointerleave={() => (hoverWeek = null)}
				onkeydown={onKey}
			>
				<g transform="translate({margin.left},{margin.top})">
					{#each yTicks as tick}
						<line x1={0} x2={innerWidth} y1={y(tick)} y2={y(tick)} class="grid" />
						<text x={-8} y={y(tick)} class="axis" text-anchor="end" dominant-baseline="central">{tickText(tick)}</text>
					{/each}
					{#each xTicks as tick}
						<text x={tick.pos} y={innerHeight + 15} class="axis" text-anchor={tick.anchor}>{tick.label}</text>
					{/each}

					{#if hovered}
						<line x1={x(dateOf(hovered))} x2={x(dateOf(hovered))} y1={0} y2={innerHeight} class="crosshair" />
					{/if}

					{#if hasFaint}
						<path d={faintPath} class="line faint" />
					{/if}
					<path d={valuePath} class="line" class:draw={!compact} pathLength="1" />
					<circle cx={x(dateOf(shown))} cy={y(shown.value)} r="4" class="marker" />
				</g>
			</svg>
		{:else}
			<div style:height="{height}px"></div>
		{/if}

		{#if hasFaint && !compact}
			<p class="legend">
				<span class="key"></span>{valueName}
				<span class="key thin"></span>{faintName}
			</p>
		{/if}
	{:else}
		<p class="empty">{compact ? 'Under two weeks.' : 'This window holds under two weeks of scores.'}</p>
	{/if}
</div>

<style>
	.chart {
		width: 100%;
	}

	svg {
		display: block;
		width: 100%;
		touch-action: pan-y;
	}

	svg:focus-visible {
		outline: 1px solid var(--line-strong);
		outline-offset: 2px;
	}

	.readout {
		margin: 0 0 0.35rem;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.4rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}

	.readout b {
		color: var(--ink);
		font-size: 1.05rem;
		font-weight: 600;
	}

	.compact .readout b {
		font-size: 0.95rem;
	}

	.name {
		margin-right: 0.5rem;
	}

	.when {
		color: var(--ink-3);
		font-size: 0.7rem;
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

	.crosshair {
		stroke: var(--line-strong);
		stroke-width: 1;
	}

	.line {
		fill: none;
		stroke: var(--sage);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.line.faint {
		stroke-width: 1;
		opacity: 0.45;
	}

	/* Many weeks on little width: a lighter line keeps the turns apart. */
	.compact .line {
		stroke-width: 1.5;
	}

	/* The line draws itself once. pathLength="1" makes one dash as long as the whole path. */
	.line.draw {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 0.9s var(--ease-smooth, ease-out) forwards;
	}

	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.line.draw {
			animation: none;
			stroke-dashoffset: 0;
		}
	}

	.marker {
		fill: var(--sage);
		stroke: var(--surface);
		stroke-width: 2;
	}

	.legend {
		margin: 0.35rem 0 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: var(--ink-2);
	}

	.key {
		display: inline-block;
		width: 14px;
		height: 2px;
		background: var(--sage);
	}

	.key.thin {
		height: 1px;
		opacity: 0.45;
		margin-left: 0.6rem;
	}

	.empty {
		margin: 0;
		padding: 1.5rem 0;
		text-align: center;
		font-size: 0.75rem;
		color: var(--ink-2);
	}
</style>
