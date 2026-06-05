<script lang="ts">
	let { data } = $props();
	let tabCounts = $derived(data.tabCounts);
</script>

<!-- No application selected — show placeholder with queue stats -->
<div class="detail-placeholder">
	<p class="detail-prompt">Select an application to review</p>
	<div class="detail-stats">
		<div class="detail-stat">
			<span class="detail-stat-value">{tabCounts.unclaimed}</span>
			<span class="detail-stat-label">Unclaimed</span>
		</div>
		<div class="detail-stat">
			<span class="detail-stat-value">{tabCounts.mine}</span>
			<span class="detail-stat-label">My Claims</span>
		</div>
		<div class="detail-stat">
			<span class="detail-stat-value">{tabCounts.all}</span>
			<span class="detail-stat-label">Total Open</span>
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
		color: var(--ink-2);
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
		color: var(--ink);
	}

	.detail-stat-label {
		font-size: 0.75rem;
		color: var(--ink-2);
		margin-top: 0.25rem;
	}
</style>
