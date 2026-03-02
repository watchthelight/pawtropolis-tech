<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import ReviewCard from '$lib/components/review/ReviewCard.svelte';
	import TabBar from '$lib/components/review/TabBar.svelte';

	let { data, children } = $props();
	const { queue, history, userId, tabCounts } = data;

	type TabId = 'unclaimed' | 'mine' | 'all' | 'history';
	let activeTab = $state<TabId>('unclaimed');

	let filteredItems = $derived.by(() => {
		switch (activeTab) {
			case 'unclaimed': return queue.filter(item => !item.claimedBy);
			case 'mine': return queue.filter(item => item.claimedBy === userId);
			case 'all': return queue;
			case 'history': return [];
		}
	});

	let isHistoryTab = $derived(activeTab === 'history');

	function selectedAppId(): string | null {
		const parts = $page.url.pathname.split('/');
		return parts.length >= 4 ? parts[3] : null;
	}

	const EMPTY_MESSAGES: Record<TabId, { message: string; subtitle: string }> = {
		unclaimed: { message: 'All clear', subtitle: 'No unclaimed applications' },
		mine: { message: 'No claims', subtitle: "You haven't claimed any applications" },
		all: { message: 'All clear', subtitle: 'No open applications' },
		history: { message: 'No history', subtitle: 'No resolved applications yet' }
	};

	function outcomeColor(status: string): string {
		if (status === 'approved') return 'var(--status-success)';
		if (status === 'kicked') return 'var(--status-warning)';
		return 'var(--status-danger)';
	}

	function outcomeLabel(status: string): string {
		if (status === 'approved') return 'Approved';
		if (status === 'kicked') return 'Kicked';
		return 'Rejected';
	}

	function relativeTime(ms: number | null): string {
		if (ms == null) return '';
		const diff = Date.now() - ms;
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Reviews" subtitle="Application review queue" badge={tabCounts.unclaimed} />

	<TabBar active={activeTab} counts={tabCounts} onchange={(tab) => activeTab = tab} />

	{#if isHistoryTab}
		{#if history.length === 0}
			<EmptyState message={EMPTY_MESSAGES.history.message} subtitle={EMPTY_MESSAGES.history.subtitle} />
		{:else}
			<div class="review-layout">
				<div class="queue-list">
					{#each history as item (item.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="history-card"
							class:history-card-selected={selectedAppId() === item.id}
							role="button"
							tabindex="0"
							onclick={() => goto(`/dashboard/reviews/${item.id}`)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto(`/dashboard/reviews/${item.id}`); } }}
						>
							<div class="history-card-top">
								<span class="history-card-name">{item.applicantName}</span>
								<span class="history-card-time">{relativeTime(item.resolvedAt)}</span>
							</div>
							<div class="history-card-bottom">
								<span class="history-card-outcome" style:color={outcomeColor(item.status)}>
									<span class="status-dot" style:background-color={outcomeColor(item.status)}></span>
									{outcomeLabel(item.status)}
								</span>
								{#if item.reason}
									<span class="history-card-reason">{item.reason.slice(0, 40)}{item.reason.length > 40 ? '...' : ''}</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<div class="detail-panel">
					{@render children()}
				</div>
			</div>
		{/if}
	{:else if filteredItems.length === 0}
		<EmptyState message={EMPTY_MESSAGES[activeTab].message} subtitle={EMPTY_MESSAGES[activeTab].subtitle} />
	{:else}
		<div class="review-layout">
			<div class="queue-list">
				{#each filteredItems as item (item.id)}
					<ReviewCard
						applicantName={item.applicantName}
						status={item.status}
						submittedAt={item.submittedAt}
						claimedBy={item.claimedBy}
						riskScore={item.riskScore}
						selected={selectedAppId() === item.id}
						onclick={() => goto(`/dashboard/reviews/${item.id}`)}
					/>
				{/each}
			</div>

			<div class="detail-panel">
				{@render children()}
			</div>
		</div>
	{/if}
</SpringReveal>

<style>
	.review-layout {
		display: flex;
		gap: var(--space-section);
		min-height: calc(100vh - 260px);
	}

	.queue-list {
		width: 320px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
	}

	.detail-panel {
		flex: 1;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		min-height: 400px;
		overflow: hidden;
	}

	/* History cards — color-coded by outcome */
	.history-card {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.history-card:hover {
		background: var(--surface-raised);
		box-shadow: var(--glow-hover);
	}

	.history-card-selected {
		border-left: 3px solid var(--accent);
		background: var(--surface-raised);
		box-shadow: var(--glow-accent);
	}

	.history-card-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.25rem;
	}

	.history-card-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-card-time {
		font-size: 0.7rem;
		color: var(--text-secondary);
		flex-shrink: 0;
		margin-left: 0.5rem;
	}

	.history-card-bottom {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
	}

	.history-card-outcome {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-weight: 500;
	}

	.status-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.history-card-reason {
		color: var(--text-secondary);
		font-size: 0.7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
