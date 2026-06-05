<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import type { SSEEvent } from '$lib/types/events';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import Avatar from '$lib/components/data/Avatar.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { addToast as pushToast } from '$lib/stores/toast.svelte';
	import type { QotdFilter } from '$lib/server/queries/qotd';

	let { data } = $props();
	let items = $derived(data.items);
	let stats = $derived(data.stats);
	let filter = $derived(data.filter);
	let search = $derived(data.search);
	let nextCursor = $derived(data.nextCursor);

	let searchInput = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		searchInput = search;
	});

	let busyId = $state<number | null>(null);
	let editingId = $state<number | null>(null);
	let editText = $state('');
	let rejectingId = $state<number | null>(null);
	let rejectReason = $state('');

	// SSE: any qotd:* event re-fetches the grid
	let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
	function onQotdEvent(_e: SSEEvent) {
		clearTimeout(invalidateTimer);
		invalidateTimer = setTimeout(() => invalidateAll(), 200);
	}
	subscribe('qotd:*', onQotdEvent);
	onDestroy(() => {
		unsubscribe('qotd:*', onQotdEvent);
		clearTimeout(invalidateTimer);
		clearTimeout(searchTimer);
	});

	function setFilter(f: QotdFilter) {
		const url = new URL($page.url);
		url.searchParams.set('filter', f);
		url.searchParams.delete('cursor');
		goto(url.toString(), { replaceState: true, invalidateAll: true });
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			const url = new URL($page.url);
			if (searchInput.trim()) url.searchParams.set('q', searchInput.trim());
			else url.searchParams.delete('q');
			url.searchParams.delete('cursor');
			goto(url.toString(), { replaceState: true, invalidateAll: true });
		}, 300);
	}

	function nextPage() {
		if (!nextCursor) return;
		const url = new URL($page.url);
		url.searchParams.set('cursor', String(nextCursor));
		goto(url.toString(), { invalidateAll: true });
	}

	async function callAction(suggestionId: number, action: string, extra: Record<string, unknown> = {}) {
		busyId = suggestionId;
		try {
			const res = await fetch(`/api/qotd/${action}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ suggestionId, ...extra })
			});
			const body = await res.json();
			if (!res.ok || !body.success) {
				pushToast(body.error ?? `Failed to ${action}`, 'error');
				return false;
			}
			await invalidateAll();
			return true;
		} catch (err) {
			pushToast(err instanceof Error ? err.message : `Failed to ${action}`, 'error');
			return false;
		} finally {
			busyId = null;
		}
	}

	async function approve(id: number) { await callAction(id, 'approve'); }
	async function use(id: number) {
		const ok = await callAction(id, 'use');
		if (ok) pushToast('Marked as used.', 'success');
	}
	async function restore(id: number) {
		const ok = await callAction(id, 'restore');
		if (ok) pushToast('Restored to approved.', 'success');
	}

	function startReject(id: number) {
		rejectingId = id;
		rejectReason = '';
	}
	async function confirmReject() {
		if (rejectingId == null) return;
		const ok = await callAction(rejectingId, 'reject', { reason: rejectReason || 'Rejected via dashboard' });
		if (ok) {
			pushToast('Rejected.', 'success');
			rejectingId = null;
			rejectReason = '';
		}
	}
	function cancelReject() { rejectingId = null; rejectReason = ''; }

	function startEdit(id: number, current: string) {
		editingId = id;
		editText = current;
	}
	async function confirmEdit() {
		if (editingId == null) return;
		const ok = await callAction(editingId, 'edit', { question: editText });
		if (ok) {
			pushToast('Edited.', 'success');
			editingId = null;
			editText = '';
		}
	}
	function cancelEdit() { editingId = null; editText = ''; }

	const STATUS_META: Record<string, { label: string; cls: string }> = {
		pending:  { label: 'Pending',  cls: 'pill-pending' },
		approved: { label: 'Approved', cls: 'pill-approved' },
		rejected: { label: 'Rejected', cls: 'pill-rejected' },
		used:     { label: 'Used',     cls: 'pill-used' }
	};

	function onKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (e.key === '1') setFilter('all');
		else if (e.key === '2') setFilter('pending');
		else if (e.key === '3') setFilter('approved');
		else if (e.key === '4') setFilter('used');
		else if (e.key === '5') setFilter('rejected');
	}
</script>

<svelte:window onkeydown={onKey} />

<SpringReveal stagger={30}>
	<PageHeader title="QOTD" subtitle="Question of the Day suggestions" />

	<div class="metrics-row">
		<button class="metric-tile" class:tile-active={filter === 'pending'} onclick={() => setFilter('pending')}>
			<span class="metric-num">{stats.pending}</span>
			<span class="metric-label">Pending</span>
		</button>
		<button class="metric-tile" class:tile-active={filter === 'approved'} onclick={() => setFilter('approved')}>
			<span class="metric-num">{stats.approved}</span>
			<span class="metric-label">Approved</span>
		</button>
		<button class="metric-tile" class:tile-active={filter === 'used'} onclick={() => setFilter('used')}>
			<span class="metric-num">{stats.used}</span>
			<span class="metric-label">Used</span>
		</button>
		<button class="metric-tile" class:tile-active={filter === 'rejected'} onclick={() => setFilter('rejected')}>
			<span class="metric-num">{stats.rejected}</span>
			<span class="metric-label">Rejected</span>
		</button>
	</div>

	<div class="toolbar">
		<input
			class="search"
			placeholder="Search question text…"
			bind:value={searchInput}
			oninput={onSearchInput}
		/>
		<div class="chips">
			<button class="chip" class:chip-active={filter === 'all'} onclick={() => setFilter('all')} title="1">All</button>
			<button class="chip" class:chip-active={filter === 'pending'} onclick={() => setFilter('pending')} title="2">Pending</button>
			<button class="chip" class:chip-active={filter === 'approved'} onclick={() => setFilter('approved')} title="3">Approved</button>
			<button class="chip" class:chip-active={filter === 'used'} onclick={() => setFilter('used')} title="4">Used</button>
			<button class="chip" class:chip-active={filter === 'rejected'} onclick={() => setFilter('rejected')} title="5">Rejected</button>
		</div>
	</div>

	{#if items.length === 0}
		<EmptyState
			message={search ? 'No matches' : (filter === 'pending' ? 'No pending — clear inbox' : 'No suggestions')}
			subtitle={search ? 'Try a different word.' : 'Members can submit QOTD ideas with /qotd suggest'}
		/>
	{:else}
		<div class="grid">
			{#each items as s (s.id)}
				{@const meta = STATUS_META[s.status]}
				<div class="card" class:card-pending={s.status === 'pending'}>
					<div class="card-top">
						<Avatar src={s.suggesterAvatar} name={s.suggesterName} size={32} />
						<div class="card-id">
							<span class="suggester">{s.suggesterName}</span>
							<span class="when">{relativeTime(s.createdAtS * 1000)}</span>
						</div>
						<span class="pill {meta.cls}">{meta.label}</span>
					</div>

					{#if editingId === s.id}
						<textarea class="edit-area" bind:value={editText} rows="3"></textarea>
						<div class="edit-actions">
							<button class="btn btn-primary" disabled={busyId === s.id} onclick={confirmEdit}>Save</button>
							<button class="btn" onclick={cancelEdit}>Cancel</button>
						</div>
					{:else}
						<p class="question">{s.question}</p>
					{/if}

					<div class="card-meta">
						<span class="code">#{s.shortCode}</span>
						{#if s.status === 'rejected' && s.rejectReason}
							<span class="reject-reason" title={s.rejectReason}>“{s.rejectReason}”</span>
						{/if}
						{#if s.status === 'used' && s.usedByName}
							<span class="used-by">used by {s.usedByName}</span>
						{/if}
						{#if s.status === 'approved' && s.reviewedByName}
							<span class="approved-by">approved by {s.reviewedByName}</span>
						{/if}
					</div>

					{#if rejectingId === s.id}
						<div class="reject-form">
							<input class="reject-input" placeholder="Reason (optional)" bind:value={rejectReason} />
							<button class="btn btn-danger" disabled={busyId === s.id} onclick={confirmReject}>Confirm</button>
							<button class="btn" onclick={cancelReject}>Cancel</button>
						</div>
					{:else if editingId !== s.id}
						<div class="card-actions">
							{#if s.status === 'pending'}
								<button class="btn btn-primary" disabled={busyId === s.id} onclick={() => approve(s.id)}>Approve</button>
								<button class="btn btn-ghost" disabled={busyId === s.id} onclick={() => startEdit(s.id, s.question)}>Edit</button>
								<button class="btn btn-danger" disabled={busyId === s.id} onclick={() => startReject(s.id)}>Reject</button>
							{:else if s.status === 'approved'}
								<button class="btn btn-primary" disabled={busyId === s.id} onclick={() => use(s.id)}>Use now</button>
								<button class="btn btn-danger" disabled={busyId === s.id} onclick={() => startReject(s.id)}>Reject</button>
							{:else if s.status === 'rejected'}
								<button class="btn" disabled={busyId === s.id} onclick={() => restore(s.id)}>Restore</button>
							{:else if s.status === 'used'}
								<button class="btn" disabled={busyId === s.id} onclick={() => restore(s.id)}>Restore</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if nextCursor}
			<div class="more-row">
				<button class="btn" onclick={nextPage}>Load more</button>
			</div>
		{/if}
	{/if}
</SpringReveal>

<style>
	.metrics-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.75rem;
		margin: 0 0 1rem;
	}
	.metric-tile {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s ease, background 0.15s ease;
	}
	.metric-tile:hover { background: var(--surface-2); }
	.metric-tile.tile-active { border-color: var(--sage); box-shadow: inset 0 0 0 1px var(--sage); }
	.metric-num { font-size: 1.6rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
	.metric-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }

	.toolbar { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
	.search {
		flex: 1;
		min-width: 200px;
		padding: 0.5rem 0.8rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 0.85rem;
		outline: none;
	}
	.search:focus { border-color: var(--sage); }
	.chips { display: flex; gap: 0.25rem; }
	.chip {
		padding: 0.35rem 0.7rem;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-2);
		font-size: 0.75rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.chip:hover { color: var(--ink); background: var(--surface-2); }
	.chip-active { color: var(--ink); background: var(--surface); border-color: var(--line); box-shadow: var(--shadow-sm); }

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.85rem;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 0.85rem 0.95rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
	}
	.card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); border-color: var(--ink-3); }
	.card-pending { border-color: oklch(40% 0.08 60); background: oklch(20% 0.04 60 / 0.45); }
	.card-top { display: flex; align-items: center; gap: 0.6rem; }
	.card-id { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.suggester { font-size: 0.78rem; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.when { font-size: 0.65rem; color: var(--ink-3); }
	.pill {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-pill);
	}
	.pill-pending  { background: oklch(28% 0.06 60);  color: oklch(80% 0.12 60); }
	.pill-approved { background: oklch(28% 0.06 145); color: oklch(80% 0.14 145); }
	.pill-rejected { background: oklch(28% 0.06 25);  color: oklch(80% 0.14 25); }
	.pill-used     { background: var(--sage-deep); color: var(--sage); }

	.question { font-size: 0.92rem; line-height: 1.45; color: var(--ink); margin: 0; }
	.edit-area { width: 100%; padding: 0.5rem; background: var(--void); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 0.85rem; resize: vertical; font-family: inherit; }
	.edit-actions { display: flex; gap: 0.4rem; }

	.card-meta { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; font-size: 0.65rem; color: var(--ink-3); }
	.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.reject-reason { color: var(--danger); font-style: italic; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.used-by, .approved-by { color: var(--ink-2); }

	.card-actions, .reject-form { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
	.reject-input { flex: 1; min-width: 140px; padding: 0.4rem 0.6rem; background: var(--void); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--ink); font-size: 0.78rem; outline: none; }
	.btn {
		padding: 0.35rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--ink);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.btn:hover { border-color: var(--ink-2); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-primary { background: var(--sage); color: var(--void); border-color: var(--sage); }
	.btn-primary:hover { background: var(--sage); filter: brightness(1.1); }
	.btn-danger { color: var(--danger); border-color: var(--danger); background: transparent; }
	.btn-danger:hover { background: oklch(25% 0.08 25); }
	.btn-ghost { background: transparent; }

	.more-row { display: flex; justify-content: center; padding: 1rem 0; }

	@media (max-width: 768px) {
		.metrics-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
