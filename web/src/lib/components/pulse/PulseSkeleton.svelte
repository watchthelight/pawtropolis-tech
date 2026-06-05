<script lang="ts">
	import SkeletonBlock from '$lib/components/feedback/SkeletonBlock.svelte';
</script>

<div class="pulse-skel" aria-busy="true" aria-label="Loading pulse data">
	<div class="pulse-skel-head">
		<div>
			<SkeletonBlock width="6rem" height="1.1rem" />
			<div class="row-gap"><SkeletonBlock width="14rem" height="0.85rem" /></div>
		</div>
		<SkeletonBlock width="11rem" height="2rem" radius="8px" />
	</div>

	<div class="pulse-skel-grid">
		{#each Array(8) as _, i (i)}
			<div class="pulse-skel-card">
				<div class="row"><SkeletonBlock width="1rem" height="1rem" radius="4px" /></div>
				<div class="row"><SkeletonBlock width="80%" height="0.78rem" /></div>
				<div class="row"><SkeletonBlock width="60%" height="1.6rem" /></div>
				<div class="row"><SkeletonBlock width="70%" height="0.72rem" /></div>
			</div>
		{/each}
	</div>

	<div class="pulse-skel-row">
		<div class="pulse-skel-wide">
			<SkeletonBlock width="40%" height="1rem" />
			<div class="row-gap"><SkeletonBlock width="100%" height="14rem" radius="10px" /></div>
		</div>
		<div class="pulse-skel-wide">
			<SkeletonBlock width="40%" height="1rem" />
			<div class="row-gap"><SkeletonBlock width="100%" height="14rem" radius="10px" /></div>
		</div>
	</div>
</div>

<style>
	.pulse-skel {
		display: flex;
		flex-direction: column;
		gap: var(--space-section);
	}
	.pulse-skel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.pulse-skel-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-card);
	}
	.pulse-skel-card {
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-height: 120px;
	}
	.pulse-skel-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: var(--space-card);
	}
	.pulse-skel-wide {
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
	}
	.row {
		display: block;
	}
	.row-gap {
		margin-top: 0.5rem;
	}
</style>
