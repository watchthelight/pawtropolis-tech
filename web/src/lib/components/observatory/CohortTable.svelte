<script lang="ts">
	import { fmtInt, fmtDayShort } from '$lib/components/observatory/format';

	interface Props {
		cohorts: { week: string; size: number; offsets: { offset: number; retainedPct: number }[] }[];
		offsets: number[];
		ariaLabel: string;
	}

	let { cohorts, offsets, ariaLabel }: Props = $props();

	// Pure-from-props guards: tolerate undefined/null arrays without throwing.
	const cols = Array.isArray(offsets) ? offsets : [];
	const rows = Array.isArray(cohorts) ? cohorts : [];
	const hasData = rows.length > 0 && cols.length > 0;

	type Cell = { pct: number | null };

	// Precompute each row as an offset->pct map so missing offsets become muted
	// empty cells instead of misaligned columns. All math is done here; the
	// markup only reads the result (no client JS, SSR-stable).
	const matrix = rows.map((c) => {
		const byOffset = new Map<number, number>();
		const src = Array.isArray(c?.offsets) ? c.offsets : [];
		for (const o of src) {
			if (o && Number.isFinite(o.offset) && o.retainedPct != null && Number.isFinite(o.retainedPct)) {
				byOffset.set(o.offset, o.retainedPct);
			}
		}
		const cells: Cell[] = cols.map((off) => {
			const v = byOffset.get(off);
			return { pct: v == null ? null : v };
		});
		return { week: c?.week ?? '', size: c?.size ?? 0, cells };
	});

	// Heat opacity: floor so even a 1% cell is faintly visible; clamp to [floor, 1].
	function heat(pct: number): number {
		const clamped = Math.max(0, Math.min(100, pct));
		return Math.max(0.05, clamped / 100);
	}

	// Above ~55% retention the gold tint is solid enough that dark ink reads best;
	// below that the cell is dim, so luminous ink keeps the number legible.
	function inkFor(pct: number): string {
		return pct >= 55 ? 'var(--obs-void)' : 'var(--obs-ink)';
	}
</script>

{#if !hasData}
	<p class="empty" aria-label={ariaLabel}>Not enough history yet</p>
{:else}
	<div class="wrap" role="region" aria-label={ariaLabel}>
		<table role="grid">
			<thead>
				<tr>
					<th scope="col" class="lab">Cohort</th>
					<th scope="col" class="num n">n</th>
					{#each cols as off (off)}
						<th scope="col" class="num">W{off}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each matrix as row, r (r)}
					<tr>
						<th scope="row" class="lab">{fmtDayShort(row.week)}</th>
						<td class="num n">{fmtInt(row.size)}</td>
						{#each row.cells as cell, c (c)}
							{#if cell.pct == null}
								<td class="cell empty-cell" aria-label="no data">
									<span class="dash">&middot;</span>
								</td>
							{:else}
								<td class="cell">
									<span class="fill" style="opacity:{heat(cell.pct)}"></span>
									<span class="pct" style="color:{inkFor(cell.pct)}">{fmtInt(cell.pct)}</span>
								</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.wrap {
		width: 100%;
		overflow-x: auto;
		border: 1px solid var(--obs-border);
		border-radius: var(--obs-r-lg);
		background: var(--obs-card-bg);
		box-shadow: var(--obs-shadow);
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-family: var(--obs-font-body);
		color: var(--obs-ink-dim);
	}

	th,
	td {
		padding: 0.55rem 0.7rem;
		text-align: center;
		vertical-align: middle;
		border-bottom: 1px solid var(--obs-grid);
		white-space: nowrap;
	}

	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: none;
	}

	/* Faint zebra striping. */
	tbody tr:nth-child(even) {
		background: var(--obs-surface-2);
	}

	thead th {
		position: sticky;
		top: 0;
		background: var(--obs-surface);
		color: var(--obs-ink-mute);
		font-family: var(--obs-font-display);
		font-weight: 600;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-bottom: 1px solid var(--obs-border-strong);
	}

	/* Left-aligned cohort label column. */
	.lab {
		text-align: left;
		font-family: var(--obs-font-mono);
		font-weight: 500;
		color: var(--obs-ink);
		font-size: 0.82rem;
		letter-spacing: 0.01em;
	}
	tbody th.lab {
		font-weight: 600;
	}

	.num {
		font-family: var(--obs-font-mono);
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
	}

	/* Cohort size column: dimmer, with a hairline divider before the heat grid. */
	.n {
		color: var(--obs-ink-mute);
		border-right: 1px solid var(--obs-grid-strong);
	}

	/* Heat cells: gold fill layer under a tabular-mono percentage. */
	.cell {
		position: relative;
		min-width: 3.1rem;
		padding: 0;
		height: 2.4rem;
	}

	.fill {
		position: absolute;
		inset: 2px;
		border-radius: var(--obs-r-sm);
		background: var(--obs-gold);
		box-shadow: 0 0 10px -2px var(--obs-glow-gold);
	}

	.pct {
		position: relative;
		z-index: 1;
		display: inline-block;
		font-family: var(--obs-font-mono);
		font-variant-numeric: tabular-nums;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 2.4rem;
		text-shadow: 0 1px 2px var(--obs-void);
	}

	.empty-cell {
		color: var(--obs-ink-faint);
	}

	.dash {
		display: inline-block;
		line-height: 2.4rem;
		font-size: 0.9rem;
		opacity: 0.5;
	}

	.empty {
		margin: 0;
		padding: 1.1rem 1.25rem;
		font-family: var(--obs-font-body);
		font-size: 0.85rem;
		color: var(--obs-ink-faint);
		text-align: center;
		border: 1px dashed var(--obs-border);
		border-radius: var(--obs-r-lg);
		background: var(--obs-card-bg);
	}

	@media (max-width: 560px) {
		th,
		td {
			padding: 0.45rem 0.5rem;
		}
		.cell {
			min-width: 2.5rem;
		}
		.pct {
			font-size: 0.72rem;
		}
	}
</style>
