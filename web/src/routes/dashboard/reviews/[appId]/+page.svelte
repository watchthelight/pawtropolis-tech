<script lang="ts">
	import { page } from '$app/stores';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import AppDetail from '$lib/components/review/AppDetail.svelte';

	let { data } = $props();
	let app = $derived(data.app);
	let modmail = $derived(data.modmail);
	let sessionUserId = $derived(data.sessionUserId);
	let canAdminUnclaim = $derived(data.canAdminUnclaim);
	let cachedProfile = $derived(data.cachedProfile);
	let priorDecisions = $derived(data.priorDecisions);
	let voteOutInfo = $derived(data.voteOutInfo);

	let isMobile = $derived(getIsMobile());

	// Prev/next navigation within queue (mobile)
	let queue = $derived((data as any).queue ?? []);
	let currentIdx = $derived(queue.findIndex((q: any) => q.id === app.id));
	let prevApp = $derived(currentIdx > 0 ? queue[currentIdx - 1] : null);
	let nextApp = $derived(currentIdx >= 0 && currentIdx < queue.length - 1 ? queue[currentIdx + 1] : null);
	// Next unclaimed app (excluding current). Powers the click-click-click claim flow.
	let nextUnclaimedId = $derived.by(() => {
		const pool = queue.filter((q: any) => q.id !== app.id && q.claimedBy == null);
		return pool.length ? pool[0].id : null;
	});
</script>

{#if isMobile}
	<div class="mobile-nav-bar">
		<a href="/dashboard/reviews" class="mobile-back-link">
			<span class="back-arrow">&#8592;</span> Queue
		</a>
		<div class="mobile-pager">
			{#if prevApp}
				<a href="/dashboard/reviews/{prevApp.id}" class="pager-btn" title="Previous review">&#9664;</a>
			{:else}
				<span class="pager-btn pager-disabled">&#9664;</span>
			{/if}
			<span class="pager-count">{currentIdx + 1}/{queue.length}</span>
			{#if nextApp}
				<a href="/dashboard/reviews/{nextApp.id}" class="pager-btn" title="Next review">&#9654;</a>
			{:else}
				<span class="pager-btn pager-disabled">&#9654;</span>
			{/if}
		</div>
	</div>
{/if}

<SpringReveal stagger={30}>
	<AppDetail {app} {modmail} {sessionUserId} {canAdminUnclaim} {cachedProfile} {priorDecisions} {voteOutInfo} {nextUnclaimedId} />
</SpringReveal>

<style>
	.mobile-nav-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 0;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--line);
	}

	.mobile-back-link {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--sage);
		text-decoration: none;
		min-height: 44px;
	}

	.back-arrow {
		font-size: 1rem;
	}

	.mobile-pager {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.pager-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		min-height: 44px;
		min-width: 44px;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		border: 1px solid var(--line);
		color: var(--ink);
		font-size: 0.7rem;
		text-decoration: none;
		transition: all 150ms;
	}

	.pager-btn:active {
		background: var(--sage-deep);
	}

	.pager-disabled {
		opacity: 0.3;
		pointer-events: none;
	}

	.pager-count {
		font-size: 0.7rem;
		color: var(--ink-2);
		min-width: 2.5rem;
		text-align: center;
	}
</style>
