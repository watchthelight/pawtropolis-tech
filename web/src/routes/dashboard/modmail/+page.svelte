<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { SSEEvent } from '$lib/types/events';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let threads = $derived(data.threads);
	let stats = $derived(data.stats);
	let filter = $derived(data.filter);

	// Live updates
	function onModmailEvent(_e: SSEEvent) {
		invalidateAll();
	}
	subscribe('modmail:*', onModmailEvent);
	onDestroy(() => unsubscribe('modmail:*', onModmailEvent));

	function setFilter(f: string) {
		const url = new URL($page.url);
		url.searchParams.set('filter', f);
		goto(url.toString(), { replaceState: true, invalidateAll: true });
	}

	function truncate(text: string | null, max = 100): string {
		if (!text) return '';
		return text.length > max ? text.slice(0, max) + '...' : text;
	}
</script>

<SpringReveal stagger={30}>
	<div class="modmail-page">
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

		{#if threads.length === 0}
			<EmptyState message="No threads" subtitle={filter === 'open' ? 'No open modmail threads' : 'No modmail threads found'} />
		{:else}
			<div class="thread-list">
				{#each threads as thread (thread.id)}
					<div class="thread-card" class:thread-unread={thread.hasUnread}>
						<div class="thread-avatar">
							{#if thread.avatarUrl}
								<img src={thread.avatarUrl} alt="" class="avatar-img" />
							{:else}
								<div class="avatar-placeholder">{thread.username.charAt(0).toUpperCase()}</div>
							{/if}
						</div>
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
								<span class="thread-count">{thread.messageCount} messages</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</SpringReveal>

<style>
	.modmail-page {
		max-width: 800px;
	}

	.modmail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.modmail-title {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}

	.modmail-stats {
		display: flex;
		gap: 0.5rem;
	}

	.stat-chip {
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--surface-raised);
		color: var(--text-secondary);
	}

	.stat-chip.open {
		background: var(--accent-dim);
		color: var(--accent);
	}

	.filter-tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--border-holdfast);
		padding-bottom: 0.5rem;
	}

	.filter-tab {
		padding: 0.375rem 0.875rem;
		border: none;
		background: none;
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: all 0.15s ease;
	}

	.filter-tab:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	.filter-tab.active {
		color: var(--accent);
		background: var(--accent-dim);
		font-weight: 500;
	}

	.thread-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.thread-card {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		transition: all 0.15s ease;
	}

	.thread-unread {
		border-left: 3px solid var(--accent);
		background: var(--surface-raised);
	}

	.thread-avatar {
		flex-shrink: 0;
	}

	.avatar-img {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		object-fit: cover;
	}

	.avatar-placeholder {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.8rem;
	}

	.thread-info {
		flex: 1;
		min-width: 0;
	}

	.thread-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.25rem;
	}

	.thread-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.thread-code {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		margin-left: 0.375rem;
	}

	.thread-time {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.thread-preview {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.unread-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}

	.preview-direction {
		font-weight: 500;
		flex-shrink: 0;
	}

	.preview-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.thread-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.65rem;
		color: var(--text-tertiary);
	}

	.thread-status {
		text-transform: uppercase;
		font-weight: 600;
		letter-spacing: 0.05em;
	}

	.status-open {
		color: var(--status-success);
	}

	@media (hover: hover) {
		.thread-card:hover {
			background: var(--surface-raised);
		}
	}
</style>
