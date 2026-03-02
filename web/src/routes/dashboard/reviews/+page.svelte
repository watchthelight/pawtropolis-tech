<script lang="ts">
	let { data } = $props();
	const { queue, pendingCount } = data;
</script>

<!-- No application selected — show placeholder with queue stats -->
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

<style>
	.detail-placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		height: 100%;
		min-height: 400px;
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
