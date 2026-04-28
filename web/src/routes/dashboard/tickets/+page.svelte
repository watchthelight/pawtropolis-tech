<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let filterType = $state(data.filters.typeKey ?? '');
	let filterStatus = $state(data.filters.status ?? '');
	let filterSearch = $state(data.filters.search ?? '');

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	function applyFilters() {
		const params = new URLSearchParams();
		if (filterType) params.set('type', filterType);
		if (filterStatus) params.set('status', filterStatus);
		if (filterSearch) params.set('search', filterSearch);
		params.set('page', '1');
		goto(`/dashboard/tickets?${params.toString()}`);
	}

	function gotoPage(n: number) {
		const params = new URLSearchParams($page.url.searchParams);
		params.set('page', String(n));
		goto(`/dashboard/tickets?${params.toString()}`);
	}

	function fmtDate(unix: number | null): string {
		if (!unix) return '—';
		return new Date(unix * 1000).toLocaleString();
	}
</script>

<div class="page">
	<header>
		<h1>Tickets</h1>
		<p class="muted">{data.total} total · page {data.page} of {totalPages}</p>
	</header>

	<div class="filters">
		<select bind:value={filterStatus} onchange={applyFilters}>
			<option value="">All statuses</option>
			<option value="open">Open</option>
			<option value="closed">Closed</option>
		</select>
		<select bind:value={filterType} onchange={applyFilters}>
			<option value="">All types</option>
			{#each data.typeKeys as k (k)}
				<option value={k}>{k}</option>
			{/each}
		</select>
		<input
			type="search"
			placeholder="Search opener / claimer / number"
			bind:value={filterSearch}
			onkeydown={(e) => e.key === 'Enter' && applyFilters()}
		/>
		<button type="button" onclick={applyFilters}>Apply</button>
	</div>

	{#if data.restrictReports}
		<p class="info-banner">
			Report tickets are hidden — Mod Team role required to view those.
		</p>
	{/if}

	<table class="ticket-list">
		<thead>
			<tr>
				<th>#</th>
				<th>Type</th>
				<th>Opener</th>
				<th>Claimer</th>
				<th>Status</th>
				<th>Opened</th>
				<th>Closed</th>
			</tr>
		</thead>
		<tbody>
			{#each data.rows as row (row.id)}
				<tr>
					<td>
						<a href={`/dashboard/tickets/${row.id}`}>
							{row.typeKey}-{String(row.number).padStart(4, '0')}
						</a>
					</td>
					<td>
						<span class="type-pill" style:background-color={`#${row.typeEmbedColor.toString(16).padStart(6, '0')}`}>{row.typeLabel}</span>
					</td>
					<td><code>{row.openerUserId}</code></td>
					<td>
						{#if row.claimedByUserId}
							<code>{row.claimedByUserId}</code>
						{:else}
							<span class="muted">unclaimed</span>
						{/if}
					</td>
					<td class={`status status-${row.status}`}>{row.status}</td>
					<td>{fmtDate(row.openedAt)}</td>
					<td>{fmtDate(row.closedAt)}</td>
				</tr>
			{:else}
				<tr><td colspan="7" class="empty">No tickets match.</td></tr>
			{/each}
		</tbody>
	</table>

	{#if totalPages > 1}
		<nav class="pagination">
			<button disabled={data.page <= 1} onclick={() => gotoPage(data.page - 1)}>Prev</button>
			<span>Page {data.page} / {totalPages}</span>
			<button disabled={data.page >= totalPages} onclick={() => gotoPage(data.page + 1)}>Next</button>
		</nav>
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem;
		display: grid;
		gap: 1rem;
	}
	header {
		display: grid;
		gap: 0.25rem;
	}
	.muted {
		color: var(--text-muted, #888);
		font-size: 0.875rem;
	}
	.info-banner {
		padding: 0.75rem 1rem;
		background: var(--surface-raised, #2a2a2a);
		border-left: 3px solid var(--border-strong, #555);
		border-radius: var(--radius-md, 12px);
		font-size: 0.875rem;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.filters select,
	.filters input,
	.filters button {
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-sm, 6px);
		border: 1px solid var(--border, #444);
		background: var(--surface, #1c1c1c);
		color: inherit;
		font-size: 0.9rem;
	}
	.filters input {
		min-width: 14rem;
	}
	.ticket-list {
		width: 100%;
		border-collapse: collapse;
		background: var(--surface, #1c1c1c);
		border-radius: var(--radius-md, 12px);
		overflow: hidden;
	}
	.ticket-list th,
	.ticket-list td {
		padding: 0.6rem 0.85rem;
		text-align: left;
		border-bottom: 1px solid var(--border, #333);
		font-size: 0.875rem;
	}
	.ticket-list th {
		background: var(--surface-raised, #2a2a2a);
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
	}
	.ticket-list tr:last-child td {
		border-bottom: none;
	}
	.type-pill {
		display: inline-block;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		color: #fff;
		font-size: 0.75rem;
		font-weight: 600;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
	}
	.status {
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.75rem;
	}
	.status-open {
		color: #4ade80;
	}
	.status-closed {
		color: #94a3b8;
	}
	.empty {
		text-align: center;
		padding: 2rem !important;
		color: var(--text-muted, #888);
	}
	code {
		font-size: 0.8rem;
	}
	.pagination {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: center;
		margin-top: 0.5rem;
	}
	.pagination button {
		padding: 0.4rem 1rem;
		background: var(--surface, #1c1c1c);
		border: 1px solid var(--border, #444);
		border-radius: var(--radius-sm, 6px);
		color: inherit;
		cursor: pointer;
	}
	.pagination button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
