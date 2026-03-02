<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import ReviewCard from '$lib/components/review/ReviewCard.svelte';

	let { data, children } = $props();
	const { queue, pendingCount } = data;

	function selectedAppId(): string | null {
		// Extract appId from URL: /dashboard/reviews/[appId]
		const parts = $page.url.pathname.split('/');
		return parts.length >= 4 ? parts[3] : null;
	}
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Reviews" subtitle="Application review queue" badge={queue.length} />

	{#if queue.length === 0}
		<EmptyState message="All clear" subtitle="No pending applications" />
	{:else}
		<div class="review-layout">
			<!-- Queue list (320px) — persists across route changes -->
			<div class="queue-list">
				{#each queue as item (item.id)}
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

			<!-- Detail panel — renders children (placeholder or AppDetail) -->
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
		min-height: calc(100vh - 200px);
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
</style>
