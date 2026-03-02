<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import ReviewCard from '$lib/components/review/ReviewCard.svelte';

	let { data } = $props();
	const { queue, pendingCount } = data;
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Reviews" subtitle="Application review queue" badge={queue.length} />

	{#if queue.length === 0}
		<EmptyState message="All clear" subtitle="No pending applications" />
	{:else}
		<div class="review-layout">
			<!-- Queue list (320px) -->
			<div class="queue-list">
				{#each queue as item (item.id)}
					<ReviewCard
						applicantName={item.applicantName}
						status={item.status}
						submittedAt={item.submittedAt}
						claimedBy={item.claimedBy}
						riskScore={item.riskScore}
					/>
				{/each}
			</div>

			<!-- Detail panel (flex-1) -->
			<div class="detail-panel">
				<div class="detail-placeholder">
					<p class="detail-prompt">Select an application to review</p>
					<div class="detail-stats">
						<div class="detail-stat">
							<span class="detail-stat-value">{pendingCount}</span>
							<span class="detail-stat-label">Pending</span>
						</div>
						<div class="detail-stat">
							<span class="detail-stat-value">{queue.length - pendingCount}</span>
							<span class="detail-stat-label">Claimed</span>
						</div>
						<div class="detail-stat">
							<span class="detail-stat-value">{queue.length}</span>
							<span class="detail-stat-label">Total</span>
						</div>
					</div>
				</div>
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
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		border: 1px dashed var(--border-holdfast);
		background: var(--surface);
		min-height: 400px;
	}

	.detail-placeholder {
		text-align: center;
	}

	.detail-prompt {
		font-size: 1.1rem;
		color: var(--text-secondary);
		margin-bottom: 2rem;
	}

	.detail-stats {
		display: flex;
		gap: 2.5rem;
	}

	.detail-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.detail-stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.detail-stat-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}
</style>
