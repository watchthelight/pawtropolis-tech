<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { slide } from 'svelte/transition';

	let { data } = $props();
	let entries = $derived(data.entries);
	let totalPages = $derived(Math.ceil(data.total / data.pageSize));

	// Filter state (bound to URL params)
	let actionFilter = $state(data.filters.action);
	let searchQuery = $state(data.filters.search);
	let fromDate = $state(data.filters.from);
	let toDate = $state(data.filters.to);

	// Expanded row
	let expandedId = $state<number | null>(null);

	// Debounced search
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function applyFilters(resetPage = true) {
		const params = new URLSearchParams();
		if (actionFilter) params.set('action', actionFilter);
		if (searchQuery) params.set('q', searchQuery);
		if (fromDate) params.set('from', fromDate);
		if (toDate) params.set('to', toDate);
		if (!resetPage && data.page > 1) params.set('page', String(data.page));
		goto(`?${params.toString()}`, { keepFocus: true, replaceState: true });
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => applyFilters(), 300);
	}

	function clearFilters() {
		actionFilter = '';
		searchQuery = '';
		fromDate = '';
		toDate = '';
		goto('?', { keepFocus: true, replaceState: true });
	}

	function goToPage(p: number) {
		const params = new URLSearchParams($page.url.searchParams);
		if (p > 1) params.set('page', String(p));
		else params.delete('page');
		goto(`?${params.toString()}`, { keepFocus: true });
	}

	const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
		approve: { bg: 'oklch(25% 0.06 145)', text: 'var(--status-success)' },
		reject: { bg: 'oklch(30% 0.08 85)', text: 'oklch(70% 0.15 85)' },
		perm_reject: { bg: 'oklch(25% 0.08 25)', text: 'var(--status-danger)' },
		kick: { bg: 'oklch(25% 0.08 25)', text: 'var(--status-danger)' },
		claim: { bg: 'var(--accent-dim)', text: 'var(--accent)' },
		unclaim: { bg: 'oklch(25% 0.04 0)', text: 'var(--text-secondary)' },
		app_submitted: { bg: 'oklch(30% 0.08 220)', text: 'oklch(75% 0.12 220)' },
		modmail_open: { bg: 'oklch(30% 0.08 280)', text: 'oklch(75% 0.12 280)' },
		modmail_close: { bg: 'oklch(25% 0.04 0)', text: 'var(--text-secondary)' },
		flag: { bg: 'oklch(30% 0.08 330)', text: 'oklch(75% 0.12 330)' },
	};

	function actionColor(action: string) {
		return ACTION_COLORS[action] ?? { bg: 'var(--surface-raised)', text: 'var(--text-secondary)' };
	}

	function actionLabel(action: string): string {
		return action.replace(/_/g, ' ');
	}

	function hasActiveFilters(): boolean {
		return !!(actionFilter || searchQuery || fromDate || toDate);
	}

	function parseMeta(json: string | null): Record<string, unknown> | null {
		if (!json) return null;
		try { return JSON.parse(json); } catch { return null; }
	}
</script>

<SpringReveal stagger={30}>
	<!-- PageHeader is rendered by the audit layout -->

	<!-- Filter bar -->
	<div class="filter-bar">
		<input
			type="text"
			class="search-input"
			placeholder="Search name, reason, ID..."
			bind:value={searchQuery}
			oninput={onSearchInput}
		/>
		<select class="filter-select" bind:value={actionFilter} onchange={() => applyFilters()}>
			<option value="">All actions</option>
			{#each data.actionTypes as type}
				<option value={type}>{actionLabel(type)}</option>
			{/each}
		</select>
		<input type="date" class="date-input" bind:value={fromDate} onchange={() => applyFilters()} title="From date" />
		<input type="date" class="date-input" bind:value={toDate} onchange={() => applyFilters()} title="To date" />
		{#if hasActiveFilters()}
			<button class="clear-btn" onclick={clearFilters}>Clear</button>
		{/if}
	</div>

	{#if entries.length === 0}
		<EmptyState
			message={hasActiveFilters() ? 'No matching entries' : 'No audit entries'}
			subtitle={hasActiveFilters() ? 'Try adjusting your filters.' : 'No actions logged in this time period.'}
		/>
	{:else}
		<div class="table-card">
			<div class="table-header">
				<span class="col-time">When</span>
				<span class="col-actor">Actor</span>
				<span class="col-action">Action</span>
				<span class="col-target">Target</span>
				<span class="col-reason">Reason</span>
			</div>
			{#each entries as entry (entry.id)}
				{@const colors = actionColor(entry.action)}
				{@const meta = parseMeta(entry.metaJson)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="table-row"
					class:row-expanded={expandedId === entry.id}
					role="button"
					tabindex="0"
					onclick={() => expandedId = expandedId === entry.id ? null : entry.id}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandedId = expandedId === entry.id ? null : entry.id; } }}
				>
					<div class="row-main">
						<span class="col-time" title={new Date(entry.createdAt).toLocaleString()}>
							{relativeTime(entry.createdAt)}
						</span>
						<span class="col-actor">{entry.actorName}</span>
						<span class="col-action">
							<span class="action-badge" style:background={colors.bg} style:color={colors.text}>
								{actionLabel(entry.action)}
							</span>
						</span>
						<span class="col-target">
							{#if entry.subjectName}
								{entry.subjectName}
							{:else if entry.appCode}
								{entry.appCode}
							{:else}
								<span class="no-target">&mdash;</span>
							{/if}
						</span>
						<span class="col-reason" class:no-target={!entry.reason}>
							{entry.reason ?? '\u2014'}
						</span>
					</div>

					{#if expandedId === entry.id}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div class="row-detail" transition:slide={{ duration: 150 }} onclick={(e) => e.stopPropagation()}>
							<div class="detail-grid">
								<div class="detail-item">
									<span class="detail-label">Actor ID</span>
									<span class="detail-value"><CopyableId value={entry.actorId} /></span>
								</div>
								{#if entry.subjectId}
									<div class="detail-item">
										<span class="detail-label">Target ID</span>
										<span class="detail-value"><CopyableId value={entry.subjectId} /></span>
									</div>
								{/if}
								{#if entry.appCode}
									<div class="detail-item">
										<span class="detail-label">App Code</span>
										<span class="detail-value">{entry.appCode}</span>
									</div>
								{/if}
								<div class="detail-item">
									<span class="detail-label">Timestamp</span>
									<span class="detail-value">{new Date(entry.createdAt).toLocaleString()}</span>
								</div>
								{#if entry.reason}
									<div class="detail-item detail-full">
										<span class="detail-label">Full Reason</span>
										<span class="detail-value">{entry.reason}</span>
									</div>
								{/if}
								{#if meta}
									<div class="detail-item detail-full">
										<span class="detail-label">Metadata</span>
										<pre class="detail-meta">{JSON.stringify(meta, null, 2)}</pre>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="pagination">
				<button
					class="page-btn"
					disabled={data.page <= 1}
					onclick={() => goToPage(data.page - 1)}
				>
					Prev
				</button>
				<span class="page-info">
					Page {data.page} of {totalPages}
					<span class="page-total">({data.total} entries)</span>
				</span>
				<button
					class="page-btn"
					disabled={data.page >= totalPages}
					onclick={() => goToPage(data.page + 1)}
				>
					Next
				</button>
			</div>
		{/if}
	{/if}
</SpringReveal>

<style>
	/* ─── Filter bar ─── */
	.filter-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.search-input {
		flex: 1;
		min-width: 180px;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8rem;
		outline: none;
		transition: border-color 150ms var(--ease-smooth);
	}

	.search-input::placeholder {
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.search-input:focus {
		border-color: var(--accent);
	}

	.filter-select, .date-input {
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8rem;
		cursor: pointer;
		outline: none;
	}

	.date-input {
		width: 8.5rem;
	}

	.date-input::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
	}

	.clear-btn {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.clear-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-secondary);
	}

	/* ─── Table ─── */
	.table-card {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.table-header {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--border-holdfast);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}

	.table-row {
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		transition: background 150ms var(--ease-smooth);
	}

	.table-row:last-child {
		border-bottom: none;
	}

	@media (hover: hover) {
		.table-row:hover {
			background: var(--surface-raised);
		}
	}

	.row-expanded {
		background: var(--surface-raised);
	}

	.row-main {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		align-items: center;
		font-size: 0.8rem;
		color: var(--text-primary);
	}

	/* ─── Columns ─── */
	.col-time {
		width: 5.5rem;
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.col-actor {
		width: 8rem;
		flex-shrink: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-action {
		width: 6.5rem;
		flex-shrink: 0;
	}

	.col-target {
		width: 8rem;
		flex-shrink: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-reason {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.no-target {
		opacity: 0.4;
	}

	/* ─── Action badge ─── */
	.action-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: capitalize;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	/* ─── Expanded detail ─── */
	.row-detail {
		padding: 0 1rem 0.75rem;
		border-top: 1px solid var(--border);
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
		padding-top: 0.75rem;
	}

	.detail-full {
		grid-column: 1 / -1;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.detail-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}

	.detail-value {
		font-size: 0.8rem;
		color: var(--text-primary);
		word-break: break-word;
	}

	.detail-meta {
		font-size: 0.7rem;
		color: var(--text-secondary);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
		margin: 0;
		overflow-x: auto;
		white-space: pre-wrap;
		font-family: var(--font-mono, monospace);
	}

	/* ─── Pagination ─── */
	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 1rem;
	}

	.page-btn {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.page-btn:hover:not(:disabled) {
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.page-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.page-info {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.page-total {
		opacity: 0.6;
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.filter-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.search-input {
			min-width: 0;
		}

		.date-input {
			width: auto;
		}

		.col-reason, .col-target {
			display: none;
		}

		.col-actor {
			width: 6rem;
		}
	}
</style>
