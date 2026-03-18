<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';

	let { grid, maxValue, dates }: {
		grid: number[][];
		maxValue: number;
		dates: string[];
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

	/** Full hour range for tooltip: "2:00 PM – 3:00 PM" */
	export function formatHourRange(hour: number): string {
		const startH = hour % 12 || 12;
		const startAmPm = hour < 12 ? 'AM' : 'PM';
		const endHour = (hour + 1) % 24;
		const endH = endHour % 12 || 12;
		const endAmPm = endHour < 12 ? 'AM' : 'PM';
		return `${startH}:00 ${startAmPm} – ${endH}:00 ${endAmPm}`;
	}

	/** Full day name from ISO date string */
	export function formatDayName(isoDate: string): string {
		return new Date(isoDate).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
	}

	const LABELED_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

	function cellOpacity(count: number): number {
		if (count === 0) return 0.04;
		return 0.04 + (count / maxValue) * 0.96;
	}

	// ── Hover/touch state ──
	let hoveredDay = $state<number | null>(null);
	let hoveredHour = $state<number | null>(null);

	let tooltip = $derived.by(() => {
		if (hoveredDay === null || hoveredHour === null) return null;
		const count = grid[hoveredDay]?.[hoveredHour] ?? 0;
		const dayName = dates[hoveredDay] ? formatDayName(dates[hoveredDay]) : DAY_LABELS[hoveredDay];
		const hourRange = formatHourRange(hoveredHour);

		// Position: column offset (skip day-label col) + row offset (skip hour-label row)
		// Grid has 25 columns (1 day-label + 24 hours), 8 rows (1 hour-label + 7 days)
		const colFraction = (hoveredHour + 1) / 25; // +1 for the day-label column
		const rowFraction = (hoveredDay + 1) / 8;   // +1 for the hour-label row
		const anchorAbove = rowFraction > 0.5;

		return { dayName, hourRange, count, colFraction, rowFraction, anchorAbove };
	});

	// Event delegation: extract day/hour from data attributes on the grid container
	function onCellEnter(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.dataset.day) return;
		hoveredDay = Number(target.dataset.day);
		hoveredHour = Number(target.dataset.hour);
	}

	function onCellLeave(e: MouseEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (related?.dataset?.day) return; // moving to another cell — don't clear
		hoveredDay = null;
		hoveredHour = null;
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
			style:left="{tooltip.colFraction * 100}%"
			style:top={tooltip.anchorAbove
				? `calc(${tooltip.rowFraction * 100}% - 8px)`
				: `calc(${tooltip.rowFraction * 100}% + ${100 / 8}% + 8px)`}
		>
			<span class="tooltip-day">{tooltip.dayName}</span>
			<span class="tooltip-hour">{tooltip.hourRange}</span>
			<span class="tooltip-count">{countFmt.format(tooltip.count)} messages</span>
		</div>
	{/if}

	<div class="axis-note">All times UTC</div>

	<!-- Legend -->
	<div class="legend">
		<span class="legend-label">Less</span>
		<div class="legend-gradient"></div>
		<span class="legend-label">More</span>
	</div>
</div>

<style>
	.heatmap-grid-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		position: relative;
	}

	.grid-container {
		display: grid;
		grid-template-columns: auto repeat(24, 1fr);
		grid-template-rows: auto repeat(7, 1fr);
		gap: 2px;
	}

	.hour-label {
		font-size: 0.6rem;
		color: var(--text-secondary);
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
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		padding-right: 8px;
		white-space: nowrap;
	}

	.cell {
		aspect-ratio: 1;
		min-width: 0;
		border-radius: 2px;
		background-color: var(--accent);
		transition: opacity var(--duration-fast) var(--ease-smooth);
		cursor: crosshair;
	}

	.cell-hovered {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
		z-index: 1;
	}

	/* ── Tooltip ── */

	.tooltip {
		position: absolute;
		transform: translateX(-50%);
		pointer-events: none;
		z-index: 10;
		background: var(--surface-raised);
		border: 1px solid var(--border-strong);
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
		color: var(--text-primary);
	}

	.tooltip-hour {
		font-size: 0.6rem;
		color: var(--text-secondary);
	}

	.tooltip-count {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.axis-note {
		font-size: 0.6rem;
		color: var(--text-tertiary, var(--text-secondary));
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
		color: var(--text-secondary);
	}

	.legend-gradient {
		width: 100px;
		height: 10px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			color-mix(in oklch, var(--accent) 4%, transparent) 0%,
			var(--accent) 100%
		);
	}
</style>
