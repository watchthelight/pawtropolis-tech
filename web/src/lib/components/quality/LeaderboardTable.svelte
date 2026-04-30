<script lang="ts">
	import type { AuthorRow } from '$lib/shared/quality-types';

	let {
		rows,
		title,
		subtitle,
		valueColumn,
		valueLabel,
	}: {
		rows: AuthorRow[];
		title: string;
		subtitle?: string;
		/** which numeric column to render as the bold "Score" — defaults to meanEffort */
		valueColumn: 'meanEffort' | 'composite' | 'drag';
		valueLabel: string;
	} = $props();
</script>

<div class="lb">
	<header>
		<h3>{title}</h3>
		{#if subtitle}<p class="sub">{subtitle}</p>{/if}
	</header>
	<table>
		<thead>
			<tr>
				<th class="num">#</th>
				<th>Author</th>
				<th class="num">Messages</th>
				<th class="num">Mean effort</th>
				<th class="num">{valueLabel}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r, i}
				<tr>
					<td class="num">{i + 1}</td>
					<td>
						<b>{r.display}</b>
						{#if r.username && r.username !== r.display}<span class="uname">@{r.username}</span>{/if}
						{#if !r.inGuild}<span class="badge">left</span>{/if}
					</td>
					<td class="num">{r.msgs.toLocaleString()}</td>
					<td class="num">{r.meanEffort.toFixed(3)}</td>
					<td class="num bold">{r[valueColumn].toFixed(3)}</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="empty">No qualifying authors in this window.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.lb { background: var(--surface, #14171c); border: 1px solid var(--border, #1f232c); border-radius: var(--radius-md, 8px); padding: var(--space-card, 16px); }
	header { margin-bottom: 10px; }
	h3 { margin: 0; font-size: 0.95rem; font-weight: 600; }
	.sub { margin: 2px 0 0; color: var(--text-secondary); font-size: 0.75rem; }
	table { width: 100%; border-collapse: collapse; font-size: 12px; }
	th { text-align: left; font-weight: 600; color: var(--text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 8px 8px; border-bottom: 1px solid var(--border, #1f232c); }
	td { padding: 8px 8px; border-bottom: 1px solid var(--border, #1f232c); vertical-align: top; }
	td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
	td.bold { color: var(--text-primary); font-weight: 600; }
	td:first-child { color: var(--text-secondary); width: 32px; }
	.uname { color: var(--text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; margin-left: 4px; }
	.badge { display: inline-block; font-size: 10px; color: var(--text-secondary); border: 1px solid var(--border, #1f232c); padding: 1px 5px; border-radius: 8px; margin-left: 6px; text-transform: uppercase; letter-spacing: .04em; }
	.empty { text-align: center; color: var(--text-secondary); padding: 1.5rem; }
</style>
