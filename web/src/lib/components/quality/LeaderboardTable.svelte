<script lang="ts">
	import type { AuthorRow } from '$lib/shared/quality-types';

	let {
		rows,
		title,
		subtitle,
		rankedBy
	}: {
		rows: AuthorRow[];
		title: string;
		subtitle: string;
		/** The number the board is sorted by, with the heading of its column. Without it the board is sorted by mean effort. */
		rankedBy?: { column: 'composite' | 'drag'; label: string };
	} = $props();

	const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
</script>

<section class="board">
	<h4>{title}</h4>
	<p class="sub">{subtitle}</p>
	<table>
		<thead>
			<tr>
				<th class="num" scope="col">#</th>
				<th scope="col">Author</th>
				<th class="num" scope="col">Messages</th>
				<th class="num" scope="col">Effort</th>
				{#if rankedBy}<th class="num" scope="col">{rankedBy.label}</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each rows as row, i (row.id)}
				<tr>
					<td class="num rank">{i + 1}</td>
					<td class="author">
						<div class="who">
							<span class="name" title={row.display}>{row.display}</span>
							{#if !row.inGuild}<span class="left">left</span>{/if}
						</div>
					</td>
					<td class="num">{row.msgs.toLocaleString()}</td>
					<td class="num" class:lead={!rankedBy}>{pct(row.meanEffort)}</td>
					{#if rankedBy}<td class="num lead">{row[rankedBy.column].toFixed(2)}</td>{/if}
				</tr>
			{:else}
				<tr><td colspan={rankedBy ? 5 : 4} class="none">Nobody wrote enough messages in this window.</td></tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.board {
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
		min-width: 0;
	}

	h4 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--ink);
	}

	/* Room for two lines, so boards that stand side by side start their tables on one line. */
	.sub {
		margin: 0.2rem 0 0.6rem;
		min-height: 2.8em;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--ink-2);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}

	th {
		padding: 0.4rem 0.4rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	td {
		padding: 0.4rem 0.4rem;
		border-bottom: 1px solid var(--line-soft);
		color: var(--ink-2);
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.rank {
		width: 1.6rem;
		color: var(--ink-3);
	}

	/* The one column that gives way: max-width 0 lets it shrink under its content. */
	.author {
		width: 100%;
		max-width: 0;
		color: var(--ink);
	}

	.who {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lead {
		color: var(--ink);
		font-weight: 600;
	}

	.left {
		flex: none;
		padding: 0 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: 0.6rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.none {
		padding: 1.2rem 0;
		text-align: center;
		color: var(--ink-2);
	}
</style>
