<script lang="ts">
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import AppDetail from '$lib/components/review/AppDetail.svelte';

	let { data } = $props();
	let app = $derived(data.app);
	let modmail = $derived(data.modmail);
	let sessionUserId = $derived(data.sessionUserId);
	let canAdminUnclaim = $derived(data.canAdminUnclaim);
	let cachedProfile = $derived(data.cachedProfile);

	let isMobile = $derived(getIsMobile());
</script>

{#if isMobile}
	<a href="/dashboard/reviews" class="mobile-back-link">
		<span class="back-arrow">&#8592;</span> Back to queue
	</a>
{/if}

<SpringReveal stagger={30}>
	<AppDetail {app} {modmail} {sessionUserId} {canAdminUnclaim} {cachedProfile} />
</SpringReveal>

<style>
	.mobile-back-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0;
		font-size: 0.8rem;
		color: var(--accent);
		text-decoration: none;
		margin-bottom: 0.5rem;
	}

	.back-arrow {
		font-size: 1rem;
	}
</style>
