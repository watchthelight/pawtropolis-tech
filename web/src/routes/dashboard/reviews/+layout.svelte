<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import type { SSEEvent, ReviewSubmittedPayload } from '$lib/types/events';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	// PageHeader removed — title is inline with tabs
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import ReviewCard from '$lib/components/review/ReviewCard.svelte';
	import TabBar from '$lib/components/review/TabBar.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { openLightbox } from '$lib/stores/lightbox.svelte';

	let { data, children } = $props();

	// Live queue updates — any review event refreshes data from DB (debounced)
	let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
	function onReviewEvent(_event: SSEEvent) {
		if (invalidateTimer) clearTimeout(invalidateTimer);
		invalidateTimer = setTimeout(() => invalidateAll(), 150);
	}

	// OS notification for new applications (only when tab is hidden)
	async function onReviewSubmitted(event: SSEEvent) {
		if (typeof document === 'undefined' || !document.hidden) return;
		if (!('Notification' in window) || Notification.permission !== 'granted') return;
		const payload = event.payload as ReviewSubmittedPayload;
		const name = payload.applicantName ?? 'Someone';
		const appId = payload.appId;

		const reg = await navigator.serviceWorker?.ready;
		if (reg) {
			reg.showNotification('New Application', {
				body: `${name} just submitted an application`,
				icon: '/paw-logo.png',
				data: { appId },
				actions: [{ action: 'claim', title: 'Claim' }]
			} as NotificationOptions);
		} else {
			const n = new Notification('New Application', {
				body: `${name} just submitted an application`,
				icon: '/paw-logo.png'
			});
			n.onclick = () => { window.focus(); n.close(); };
		}
	}

	subscribe('review:*', onReviewEvent);
	subscribe('review:submitted', onReviewSubmitted);
	subscribe('modmail:*', onReviewEvent);
	onDestroy(() => {
		unsubscribe('review:submitted', onReviewSubmitted);
		unsubscribe('review:*', onReviewEvent);
		unsubscribe('modmail:*', onReviewEvent);
		if (invalidateTimer) clearTimeout(invalidateTimer);
	});
	let queue = $derived(data.queue);
	let history = $derived(data.history);
	let historyLimit = $derived(data.historyLimit);
	let userId = $derived(data.userId);
	let tabCounts = $derived(data.tabCounts);

	function setHistoryLimit(limit: number) {
		const url = new URL($page.url);
		url.searchParams.set('limit', String(limit));
		url.searchParams.set('tab', 'history');
		goto(url.toString(), { replaceState: true, invalidateAll: true });
	}

	type TabId = 'unclaimed' | 'mine' | 'all' | 'history';
	const VALID_TABS: TabId[] = ['unclaimed', 'mine', 'all', 'history'];
	const urlTab = $page.url.searchParams.get('tab');
	let activeTab = $state<TabId>(urlTab && VALID_TABS.includes(urlTab as TabId) ? urlTab as TabId : 'unclaimed');

	let filteredItems = $derived.by(() => {
		switch (activeTab) {
			case 'unclaimed': return queue.filter(item => !item.claimedBy);
			case 'mine': return queue
				.filter(item => item.claimedBy === userId)
				.sort((a, b) => {
					if (a.hasUnreadModmail !== b.hasUnreadModmail) return a.hasUnreadModmail ? -1 : 1;
					return (b.submittedAt ?? 0) - (a.submittedAt ?? 0);
				});
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


	// Glow overlay — rendered outside scroll container so it's not clipped
	let queueWrapper: HTMLElement;
	let glowRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
	let glowTarget: HTMLElement | null = null;

	function updateGlow() {
		if (!glowTarget || !queueWrapper) { glowRect = null; return; }
		const wr = queueWrapper.getBoundingClientRect();
		const cr = glowTarget.getBoundingClientRect();
		glowRect = {
			top: cr.top - wr.top,
			left: cr.left - wr.left,
			width: cr.width,
			height: cr.height,
		};
	}

	function onQueueHover(e: MouseEvent) {
		const card = (e.target as HTMLElement).closest('[role="button"]') as HTMLElement | null;
		if (!card) { glowTarget = null; glowRect = null; return; }
		glowTarget = card;
		updateGlow();
	}

	function onQueueLeave() {
		glowTarget = null;
		glowRect = null;
	}

	function onQueueScroll() {
		if (glowTarget) updateGlow();
	}

	let isMobile = $derived(getIsMobile());
	let hasSelectedApp = $derived($page.url.pathname !== '/dashboard/reviews');
</script>

<div class="reviews-page">
<SpringReveal stagger={30}>
	<div class="reviews-header">
		<div class="reviews-title-row">
			<h1 class="reviews-title">Reviews</h1>
			{#if tabCounts.unclaimed > 0}
				<span class="reviews-badge">{tabCounts.unclaimed}</span>
			{/if}
		</div>
		<TabBar active={activeTab} counts={tabCounts} onchange={(tab) => activeTab = tab} />
	</div>

	{#if isHistoryTab}
		{#if history.length === 0}
			<EmptyState message={EMPTY_MESSAGES.history.message} subtitle={EMPTY_MESSAGES.history.subtitle} />
		{:else if isMobile && hasSelectedApp}
			<!-- Mobile: full-width detail -->
			<div class="mobile-detail-wrapper">
				{@render children()}
			</div>
		{:else}
			<div class="review-layout">
				<div class="queue-wrapper" bind:this={queueWrapper}>
					<div class="history-controls">
						<span class="history-showing">Showing {history.length}</span>
						<select class="history-limit-select" value={historyLimit} onchange={(e) => setHistoryLimit(Number((e.target as HTMLSelectElement).value))}>
							<option value={10}>10</option>
							<option value={25}>25</option>
							<option value={50}>50</option>
							<option value={100}>100</option>
						</select>
					</div>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_mouse_events_have_key_events -->
					<div
						class="queue-list"
						onmouseover={isMobile ? undefined : onQueueHover}
						onmouseleave={isMobile ? undefined : onQueueLeave}
						onscroll={isMobile ? undefined : onQueueScroll}
					>
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
								<div class="history-card-row">
									{#if item.avatarUrl}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
									<img src={item.avatarUrl} alt={item.applicantName} class="history-card-avatar" style="cursor: zoom-in" onclick={(e) => { e.stopPropagation(); openLightbox(item.avatarUrl!); }} />
									{:else}
										<div class="history-card-avatar-ph">{item.applicantName.charAt(0).toUpperCase()}</div>
									{/if}
									<div class="history-card-info">
										<div class="history-card-top">
											<span class="history-card-name">{item.applicantName}</span>
											<span class="history-card-time">{relativeTime(item.resolvedAt)}</span>
										</div>
										<div class="history-card-bottom">
											<span class="history-card-outcome" style:color={outcomeColor(item.status)}>
												<span class="status-dot" style:background-color={outcomeColor(item.status)}></span>
												{outcomeLabel(item.status)}
											</span>
											{#if item.resolverName}
												<span class="history-card-resolver">by {item.resolverName}</span>
											{/if}
											{#if item.reason}
												<span class="history-card-reason">{item.reason}</span>
											{/if}
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
					{#if !isMobile && glowRect}
						<div class="queue-glow" style="top:{glowRect.top}px;left:{glowRect.left}px;width:{glowRect.width}px;height:{glowRect.height}px"></div>
					{/if}
				</div>

				{#if !isMobile}
					<div class="detail-panel">
						{@render children()}
					</div>
				{/if}
			</div>
		{/if}
	{:else if filteredItems.length === 0}
		<EmptyState message={EMPTY_MESSAGES[activeTab].message} subtitle={EMPTY_MESSAGES[activeTab].subtitle} />
	{:else if isMobile && hasSelectedApp}
		<!-- Mobile: full-width detail -->
		<div class="mobile-detail-wrapper">
			{@render children()}
		</div>
	{:else}
		<div class="review-layout">
			<div class="queue-wrapper" bind:this={queueWrapper}>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_mouse_events_have_key_events -->
				<div
					class="queue-list"
					onmouseover={isMobile ? undefined : onQueueHover}
					onmouseleave={isMobile ? undefined : onQueueLeave}
					onscroll={isMobile ? undefined : onQueueScroll}
				>
					{#each filteredItems as item (item.id)}
						<div transition:slide={{ duration: 200 }} animate:flip={{ duration: 200 }}>
						<ReviewCard
							applicantName={item.applicantName}
							avatarUrl={item.avatarUrl}
							status={item.status}
							submittedAt={item.submittedAt}
							claimedBy={item.claimedBy}
							claimedByName={item.claimedByName}
							claimedByAvatar={item.claimedByAvatar}
							riskScore={item.riskScore}
							hasUnreadModmail={item.hasUnreadModmail}
							selected={selectedAppId() === item.id}
							onclick={() => goto(`/dashboard/reviews/${item.id}`)}
						/>
						</div>
					{/each}
				</div>
				{#if !isMobile && glowRect}
					<div class="queue-glow" style="top:{glowRect.top}px;left:{glowRect.left}px;width:{glowRect.width}px;height:{glowRect.height}px"></div>
				{/if}
			</div>

			{#if !isMobile}
				<div class="detail-panel">
					{@render children()}
				</div>
			{/if}
		</div>
	{/if}
</SpringReveal>
</div>

<style>
	/* Reclaim container padding for the reviews page — extend into parent's p-8 */
	.reviews-page {
		margin: -0.75rem;
	}

	/* Inline header: title + badge on the left, tabs on the right */
	.reviews-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.reviews-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.reviews-title {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}

	.reviews-badge {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--accent);
	}

	/* Remove TabBar bottom border/margin when inline — header row handles spacing */
	.reviews-header :global(.tab-bar) {
		padding-bottom: 0;
		margin-bottom: 0;
		border-bottom: none;
	}

	.review-layout {
		display: flex;
		gap: 1rem;
		height: calc(100vh - 170px);
	}

	.queue-wrapper {
		position: relative;
		z-index: 1;
		width: 320px;
		flex-shrink: 0;
	}

	.queue-list {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.5rem;
		overflow-y: auto;
	}

	/* Suppress card hover shadow inside queue — overlay handles it */
	.queue-list :global([role="button"]:hover) {
		box-shadow: none !important;
	}

	.queue-glow {
		position: absolute;
		pointer-events: none;
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		transition: top 100ms ease, left 100ms ease, width 100ms ease, height 100ms ease;
	}

	.detail-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		min-height: 400px;
		overflow: hidden;
	}

	/* Stretch page content (SpringReveal wrapper, placeholder div) to fill panel */
	.detail-panel > :global(*) {
		flex: 1;
		min-height: 0;
	}

	.history-card-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.history-card-avatar {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		flex-shrink: 0;
	}

	.history-card-avatar-ph {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.history-card-info {
		flex: 1;
		min-width: 0;
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

	.history-card-selected {
		border-left: 3px solid var(--accent);
		background: var(--surface-raised);
		box-shadow: var(--shadow-sm);
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
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
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

	.history-card-resolver {
		color: var(--text-secondary);
		font-size: 0.7rem;
		flex-shrink: 0;
	}

	.history-card-reason {
		color: var(--text-tertiary);
		font-size: 0.65rem;
		font-style: italic;
		line-height: 1.4;
		width: 100%;
		margin-top: 0.2rem;
	}

	.history-controls {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 0.25rem 0.5rem;
	}

	.history-showing {
		font-size: 0.65rem;
		color: var(--text-tertiary);
	}

	.history-limit-select {
		background: var(--surface);
		color: var(--text-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.2rem 0.4rem;
		font-size: 0.65rem;
		cursor: pointer;
	}

	/* Mobile: full-width detail wrapper */
	.mobile-detail-wrapper {
		display: flex;
		flex-direction: column;
		min-height: calc(var(--vh-full) - var(--mobile-header-h) - 10rem);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		overflow: hidden;
	}

	.mobile-detail-wrapper > :global(*) {
		flex: 1;
		min-height: 0;
	}

	@media (max-width: 767px) {
		.review-layout {
			height: auto;
		}

		.queue-wrapper {
			width: 100%;
		}
	}

	@media (hover: hover) {
		.history-card:hover {
			background: var(--surface-raised);
		}
	}
</style>
