<script lang="ts">
	import type { Tokens } from 'marked';
	import Inline from './Inline.svelte';

	type Props = { token: Tokens.Table };
	let { token }: Props = $props();
</script>

<div class="hb-table-wrap">
	<table class="hb-table">
		<thead>
			<tr>
				{#each token.header as cell, i (i)}
					<th style:text-align={cell.align ?? 'left'}>
						<Inline tokens={cell.tokens} />
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each token.rows as row, r (r)}
				<tr>
					{#each row as cell, c (c)}
						<td
							style:text-align={cell.align ?? 'left'}
							data-label={token.header[c]?.text ?? ''}
						>
							<Inline tokens={cell.tokens} />
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.hb-table-wrap {
		margin: 0.8em 0 1em;
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.hb-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}
	.hb-table th,
	.hb-table td {
		padding: 0.6em 0.9em;
		border-bottom: 1px solid var(--line-soft);
		text-align: left;
		vertical-align: top;
		color: var(--ink-2);
	}
	.hb-table th {
		background: var(--surface-2);
		color: var(--ink);
		font-weight: 600;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
	}
	.hb-table tr:last-child td {
		border-bottom: none;
	}
	@media (max-width: 640px) {
		.hb-table {
			display: block;
		}
		.hb-table thead {
			display: none;
		}
		.hb-table tbody,
		.hb-table tr,
		.hb-table td {
			display: block;
			width: 100%;
		}
		.hb-table tr {
			border-bottom: 1px solid var(--line-soft);
			padding: 0.5em 0;
		}
		.hb-table td {
			border: none;
			padding: 0.25em 0.9em;
		}
		.hb-table td::before {
			content: attr(data-label) ' \2014 ';
			color: var(--ink-3);
			font-weight: 600;
			font-size: 0.75rem;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-right: 0.3em;
		}
	}
</style>
