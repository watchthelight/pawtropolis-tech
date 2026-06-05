<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import { onDestroy } from 'svelte';
	import type { SSEEvent } from '$lib/types/events';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import Avatar from '$lib/components/data/Avatar.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { getIsMobile } from '$lib/stores/viewport.svelte';

	let { data, children } = $props();
	let threads = $derived(data.threads);
	let stats = $derived(data.stats);
	let filter = $derived(data.filter);

	let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
	function onModmailEvent(_e: SSEEvent) {
		clearTimeout(invalidateTimer);
		invalidateTimer = setTimeout(() => invalidateAll(), 150);
	}
	subscribe('modmail:*', onModmailEvent);
	onDestroy(() => {
		unsubscribe('modmail:*', onModmailEvent);
		clearTimeout(invalidateTimer);
	});

	function setFilter(f: string) {
		const url = new URL($page.url);
		url.searchParams.set('filter', f);
		goto(url.toString(), { replaceState: true, invalidateAll: true });
	}

	function truncate(text: string | null, max = 80): string {
		if (!text) return '';
		return text.length > max ? text.slice(0, max) + '…' : text;
	}

	let isMobile = $derived(getIsMobile());
	let selectedTicketId = $derived.by(() => {
		const parts = $page.url.pathname.split('/');
		return parts.length >= 4 ? parts[3] : null;
	});
	let hasSelection = $derived(selectedTicketId != null);
</script>

<div class="modmail-page">
	<SpringReveal stagger={30}>
		<div class="modmail-header">
			<h1 class="modmail-title">Modmail</h1>
			<div class="modmail-stats">
				<span class="stat-chip open">{stats.open} open</span>
				<span class="stat-chip">{stats.total} total</span>
			</div>
		</div>

		<div class="filter-tabs">
			<button class="filter-tab" class:active={filter === 'all'} onclick={() => setFilter('all')}>All</button>
			<button class="filter-tab" class:active={filter === 'open'} onclick={() => setFilter('open')}>Open</button>
			<button class="filter-tab" class:active={filter === 'closed'} onclick={() => setFilter('closed')}>Closed</button>
		</div>

		<div class="modmail-layout" class:has-selection={hasSelection}>
			<aside class="thread-rail" class:thread-rail-mobile-hidden={isMobile && hasSelection}>
				{#if threads.length === 0}
					<EmptyState
						message="No threads"
						subtitle={filter === 'open' ? 'No open modmail threads' : 'No modmail threads found'}
					/>
				{:else}
					<div class="thread-list">
						{#each threads as thread (thread.id)}
							{@const selected = String(thread.id) === selectedTicketId}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="thread-card"
								class:thread-unread={thread.hasUnread}
								class:thread-selected={selected}
								role="button"
								tabindex="0"
								onclick={() => goto(`/dashboard/modmail/${thread.id}${$page.url.search}`)}
								onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto(`/dashboard/modmail/${thread.id}${$page.url.search}`); } }}
							>
								<Avatar src={thread.avatarUrl} name={thread.username} size={40} />
								<div class="thread-info">
									<div class="thread-top">
										<span class="thread-name">
											{thread.username}
											{#if thread.appCode}
												<span class="thread-code">#{thread.appCode}</span>
											{/if}
										</span>
										<span class="thread-time">{relativeTime(thread.createdAt)}</span>
									</div>
									<div class="thread-preview">
										{#if thread.hasUnread}
											<span class="unread-dot"></span>
										{/if}
										<span class="preview-direction">
											{thread.latestDirection === 'to_staff' ? 'User:' : 'Staff:'}
										</span>
										<span class="preview-text">{truncate(thread.latestMessage)}</span>
									</div>
									<div class="thread-meta">
										<span class="thread-status" class:status-open={thread.status === 'open'}>
											{thread.status}
										</span>
										<span class="thread-count">{thread.messageCount} msg</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</aside>

			<section class="thread-pane" class:thread-pane-mobile-hidden={isMobile && !hasSelection}>
				{#if isMobile && hasSelection}
					<a href="/dashboard/modmail{$page.url.search}" class="mobile-back">← Threads</a>
				{/if}
				{@render children()}
			</section>
		</div>
	</SpringReveal>
</div>

<style>
	.modmail-page { width: 100%; }
	.modmail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
	.modmail-title { font-size: 1.5rem; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; }
	.modmail-stats { display: flex; gap: 0.5rem; }
	.stat-chip { padding: 0.2rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.7rem; font-weight: 500; background: var(--surface-2); color: var(--ink-2); }
	.stat-chip.open { background: var(--sage-deep); color: var(--sage); }
	.filter-tabs { display: flex; gap: 0.25rem; margin-bottom: 1rem; border-bottom: 1px solid var(--line); padding-bottom: 0.5rem; }
	.filter-tab { padding: 0.375rem 0.875rem; border: none; background: none; color: var(--ink-2); font-size: 0.8rem; cursor: pointer; border-radius: var(--radius-sm); transition: all 0.15s ease; }
	.filter-tab:hover { color: var(--ink); background: var(--surface-2); }
	.filter-tab.active { color: var(--sage); background: var(--sage-deep); font-weight: 500; }

	.modmail-layout {
		display: grid;
		grid-template-columns: 360px 1fr;
		gap: 1rem;
		height: calc(100vh - 200px);
		min-height: 480px;
	}

	.thread-rail {
		min-width: 0;
		overflow-y: auto;
		padding-right: 4px;
	}

	.thread-list { display: flex; flex-direction: column; gap: 0.4rem; }

	.thread-card {
		display: flex;
		gap: 0.65rem;
		padding: 0.65rem 0.75rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--surface);
		transition: all 0.15s ease;
		cursor: pointer;
	}
	.thread-card:hover { background: var(--surface-2); }
	.thread-unread { border-left: 3px solid var(--sage); background: var(--surface-2); }
	.thread-selected { border-color: var(--sage); background: var(--surface-2); box-shadow: var(--shadow-sm); }

	.thread-info { flex: 1; min-width: 0; }
	.thread-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.2rem; }
	.thread-name { font-size: 0.8rem; font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.thread-code { font-size: 0.65rem; color: var(--ink-3); margin-left: 0.3rem; }
	.thread-time { font-size: 0.65rem; color: var(--ink-3); flex-shrink: 0; }
	.thread-preview { display: flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; color: var(--ink-2); margin-bottom: 0.2rem; min-width: 0; }
	.unread-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sage); flex-shrink: 0; }
	.preview-direction { font-weight: 500; flex-shrink: 0; }
	.preview-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.thread-meta { display: flex; gap: 0.6rem; font-size: 0.6rem; color: var(--ink-3); }
	.thread-status { text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }
	.status-open { color: var(--good); }

	.thread-pane {
		min-width: 0;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.thread-pane > :global(*) { flex: 1; min-height: 0; }

	.mobile-back {
		padding: 0.6rem 0.9rem;
		font-size: 0.85rem;
		color: var(--sage);
		text-decoration: none;
		border-bottom: 1px solid var(--line);
	}

	@media (max-width: 900px) {
		.modmail-layout { grid-template-columns: 1fr; }
		.thread-rail-mobile-hidden { display: none; }
		.thread-pane-mobile-hidden { display: none; }
	}
</style>
