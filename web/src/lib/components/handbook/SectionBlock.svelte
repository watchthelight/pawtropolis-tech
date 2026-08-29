<script lang="ts">
	import type { SectionToken } from '$lib/server/handbook/decorator';
	import MdNode from './MdNode.svelte';
	import PermissionBadge from './PermissionBadge.svelte';
	import LoginCta from './LoginCta.svelte';
	import BookmarkToggle from './BookmarkToggle.svelte';
	import NewBadge from './NewBadge.svelte';

	type Props = { token: SectionToken };
	let { token }: Props = $props();

	let showBadge = $derived(token.requiredTier !== 'public');
</script>

<section
	class="hb-section"
	data-locked={!token.canRun}
	data-logged-out-locked={token.lockedForLoggedOut}
	id={token.headingSlug}
>
	<header class="hb-section-head">
		{#if token.headingDepth === 2}
			<h2 class="hb-section-title hb-section-title-2">{token.headingText}</h2>
		{:else}
			<h3 class="hb-section-title hb-section-title-3">{token.headingText}</h3>
		{/if}
		{#if token.isNew && token.newSince}
			<NewBadge since={token.newSince} />
		{/if}
		{#if showBadge}
			<PermissionBadge tier={token.requiredTier} canRun={token.canRun} />
		{/if}
		<BookmarkToggle headingSlug={token.headingSlug} label={token.headingText} />
	</header>

	{#if token.lockedForLoggedOut}
		<LoginCta headingText={token.headingText} />
	{:else}
		<div class="hb-section-body">
			{#each token.body as t, i (i)}
				<MdNode token={t} />
			{/each}
		</div>
	{/if}
</section>

<style>
	.hb-section {
		margin: 1.6em 0 1em;
		scroll-margin-top: 5rem;
	}
	.hb-section[data-locked='true'] .hb-section-body {
		opacity: 0.55;
		transition: opacity 0.2s ease;
	}
	.hb-section-head {
		display: flex;
		align-items: baseline;
		gap: 0.8rem;
		flex-wrap: wrap;
		margin-bottom: 0.3em;
		border-bottom: 1px solid var(--line-soft);
		padding-bottom: 0.3em;
	}
	.hb-section-head :global(.hb-bm) {
		margin-left: auto;
		align-self: center;
	}
	.hb-section-title {
		margin: 0;
		color: var(--ink);
		font-weight: 700;
		letter-spacing: -0.01em;
		font-family: 'Inter Variable', system-ui, sans-serif;
	}
	.hb-section-title-2 {
		font-size: clamp(1.4rem, 3vw, 1.8rem);
	}
	.hb-section-title-3 {
		font-size: clamp(1.15rem, 2.5vw, 1.35rem);
		color: var(--sage);
	}
</style>
