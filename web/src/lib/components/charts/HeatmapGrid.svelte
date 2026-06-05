<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';
	import { formatHourRange, formatDayName, TOTAL_COLS, TOTAL_ROWS } from '$lib/utils/heatmap';

	let { grid, maxValue, dates, title, showLegend = true }: {
		grid: number[][];
		maxValue: number;
		dates: string[];
		title?: string;
		showLegend?: boolean;
	} = $props();

	const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const reduced = prefersReducedMotion();
	const countFmt = new Intl.NumberFormat();

	function formatHourLabel(hour: number): string {
		if (hour === 0) return '12a';
		if (hour < 12) return `${hour}a`;
		if (hour === 12) return '12p';
		return `${hour - 12}p`;
	}

	const LABELED_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

	function cellOpacity(count: number): number {
		if (count === 0) return 0.04;
		return 0.04 + (count / maxValue) * 0.96;
	}

	/** Build aria-label for a cell so screen readers can announce the data */
	function cellLabel(dayIndex: number, hour: number, count: number): string {
		const dayName = dates[dayIndex] ? formatDayName(dates[dayIndex]) : DAY_LABELS[dayIndex];
		return `${dayName}, ${formatHourRange(hour)}: ${countFmt.format(count)} messages`;
	}

	// ── Hover/touch state ──
	let hoveredDay = $state<number | null>(null);
	let hoveredHour = $state<number | null>(null);
	let leaveTimer: ReturnType<typeof setTimeout> | null = null;

	let tooltip = $derived.by(() => {
		if (hoveredDay === null || hoveredHour === null) return null;
		const count = grid[hoveredDay]?.[hoveredHour] ?? 0;
		const dayName = dates[hoveredDay] ? formatDayName(dates[hoveredDay]) : DAY_LABELS[hoveredDay];
		const hourRange = formatHourRange(hoveredHour);

		const colFraction = (hoveredHour + 1) / TOTAL_COLS;
		const rowFraction = (hoveredDay + 1) / TOTAL_ROWS;
		const anchorAbove = rowFraction > 0.5;
		// Clamp left% so tooltip doesn't overflow container edges
		const leftPct = Math.max(8, Math.min(92, colFraction * 100));

		return { dayName, hourRange, count, leftPct, rowFraction, anchorAbove };
	});

	// Event delegation: extract day/hour from data attributes on the grid container
	function onCellEnter(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.dataset.day) return;
		// Cancel any pending leave — prevents flicker when crossing 2px grid gaps
		if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
		hoveredDay = Number(target.dataset.day);
		hoveredHour = Number(target.dataset.hour);
	}

	function onCellLeave(e: MouseEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (related?.dataset?.day) return; // moving to another cell — don't clear
		// Debounce: short delay lets the mouse cross 2px grid gaps without flickering
		leaveTimer = setTimeout(() => {
			hoveredDay = null;
			hoveredHour = null;
			leaveTimer = null;
		}, 30);
	}

	// Touch: tap to show, tap outside to dismiss
	function onCellClick(e: Event) {
		const target = e.target as HTMLElement;
		if (!target.dataset.day) {
			// Tapped outside a cell — dismiss
			hoveredDay = null;
			hoveredHour = null;
			return;
		}
		const day = Number(target.dataset.day);
		const hour = Number(target.dataset.hour);
		if (hoveredDay === day && hoveredHour === hour) {
			// Tap same cell — dismiss
			hoveredDay = null;
			hoveredHour = null;
		} else {
			hoveredDay = day;
			hoveredHour = hour;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="heatmap-grid-wrapper"
	onmouseover={onCellEnter}
	onmouseout={onCellLeave}
	onclick={onCellClick}
>
	{#if title}
		<h3 class="week-title">{title}</h3>
	{/if}

	<div class="grid-container">
		<!-- Hour labels row -->
		<div class="corner-cell"></div>
		{#each Array(24) as _, hour}
			<div class="hour-label" class:labeled={LABELED_HOURS.includes(hour)}>
				{#if LABELED_HOURS.includes(hour)}
					{formatHourLabel(hour)}
				{/if}
			</div>
		{/each}

		<!-- Data rows -->
		{#each DAY_LABELS as dayLabel, dayIndex}
			<div class="day-label">{dayLabel}</div>
			{#each grid[dayIndex] as count, hour}
				<div
					class="cell"
					class:cell-hovered={hoveredDay === dayIndex && hoveredHour === hour}
					style:opacity={cellOpacity(count)}
					data-day={dayIndex}
					data-hour={hour}
					role="gridcell"
					aria-label={cellLabel(dayIndex, hour, count)}
				></div>
			{/each}
		{/each}
	</div>

	<!-- Tooltip -->
	{#if tooltip}
		<div
			class="tooltip"
			class:no-transition={reduced}
			class:anchor-above={tooltip.anchorAbove}
			style:left="{tooltip.leftPct}%"
			style:top={tooltip.anchorAbove
				? `calc(${tooltip.rowFraction * 100}% - 8px)`
				: `calc(${tooltip.rowFraction * 100}% + ${100 / TOTAL_ROWS}% + 8px)`}
		>
			<span class="tooltip-day">{tooltip.dayName}</span>
			<span class="tooltip-hour">{tooltip.hourRange}</span>
			<span class="tooltip-count">{countFmt.format(tooltip.count)} messages</span>
		</div>
	{/if}

	{#if showLegend}
		<div class="axis-note">All times UTC</div>

		<!-- Legend -->
		<div class="legend">
			<span class="legend-label">Less</span>
			<div class="legend-gradient"></div>
			<span class="legend-label">More</span>
		</div>
	{/if}
</div>

<style>
	.heatmap-grid-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		position: relative;
	}

	.week-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--ink-2);
		margin: 0;
		letter-spacing: 0.04em;
	}

	.grid-container {
		display: grid;
		grid-template-columns: auto repeat(24, 1fr);
		grid-template-rows: auto repeat(7, 1fr);
		gap: 2px;
	}

	.hour-label {
		font-size: 0.6rem;
		color: var(--ink-2);
		text-align: center;
		padding-bottom: 4px;
		min-width: 0;
	}

	.hour-label:not(.labeled) {
		visibility: hidden;
		padding-bottom: 4px;
	}

	.day-label {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--ink-2);
		display: flex;
		align-items: center;
		padding-right: 8px;
		white-space: nowrap;
	}

	.cell {
		aspect-ratio: 1;
		min-width: 0;
		border-radius: 2px;
		background-color: var(--sage);
		transition: opacity var(--duration-fast) var(--ease-smooth);
		cursor: crosshair;
	}

	.cell-hovered {
		outline: 2px solid var(--sage);
		outline-offset: -1px;
		z-index: 1;
	}

	/* ── Tooltip ── */

	.tooltip {
		position: absolute;
		transform: translateX(-50%);
		pointer-events: none;
		z-index: 10;
		background: var(--surface-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		padding: 0.4rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		white-space: nowrap;
		transition: left var(--duration-fast) var(--ease-smooth),
		            top var(--duration-fast) var(--ease-smooth),
		            opacity var(--duration-fast) var(--ease-smooth);
	}

	.tooltip.anchor-above {
		transform: translateX(-50%) translateY(-100%);
	}

	.tooltip.no-transition {
		transition: none;
	}

	.tooltip-day {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--ink);
	}

	.tooltip-hour {
		font-size: 0.6rem;
		color: var(--ink-2);
	}

	.tooltip-count {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--sage);
		font-variant-numeric: tabular-nums;
	}

	.axis-note {
		font-size: 0.6rem;
		color: var(--ink-3, var(--ink-2));
		text-align: right;
		opacity: 0.7;
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.legend-label {
		font-size: 0.6rem;
		color: var(--ink-2);
	}

	.legend-gradient {
		width: 100px;
		height: 10px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			color-mix(in oklch, var(--sage) 4%, transparent) 0%,
			var(--sage) 100%
		);
	}
</style>
