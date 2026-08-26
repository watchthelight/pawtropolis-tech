<script lang="ts">
	import type { CommandSectionToken } from '$lib/server/handbook/decorator';
	import MdNode from './MdNode.svelte';
	import PermissionBadge from './PermissionBadge.svelte';
	import LoginCta from './LoginCta.svelte';
	import BookmarkToggle from './BookmarkToggle.svelte';

	type Props = { token: CommandSectionToken };
	let { token }: Props = $props();
</script>

<section
	class="hb-cmd"
	data-locked={!token.canRun}
	data-logged-out-locked={token.lockedForLoggedOut}
	id={token.headingSlug}
>
	<header class="hb-cmd-head">
		<h3 class="hb-cmd-title">
			<span class="hb-cmd-slash">/</span>{token.commandName}
		</h3>
		<div class="hb-cmd-head-right">
			<PermissionBadge
				tier={token.requiredTier}
				canRun={token.canRun}
				exactOnly={token.permission?.exactOnly ?? false}
			/>
			<BookmarkToggle headingSlug={token.headingSlug} label={'/' + token.commandName} />
		</div>
	</header>

	{#if token.lockedForLoggedOut}
		<LoginCta headingText={'/' + token.commandName} />
	{:else}
		<div class="hb-cmd-body">
			{#each token.body as t, i (i)}
				<MdNode token={t} />
			{/each}
		</div>
	{/if}
</section>

<style>
	.hb-cmd {
		margin: 1.8em 0 1.2em;
		padding: 1em 1.1em 0.6em;
		border-radius: var(--radius-md);
		border: 1px solid var(--line-soft);
		background: var(--surface);
		scroll-margin-top: 5rem;
		position: relative;
		transition: border-color 0.18s ease;
	}
	.hb-cmd:hover {
		border-color: var(--line-strong);
	}
	.hb-cmd[data-locked='true'] .hb-cmd-body {
		opacity: 0.55;
	}
	.hb-cmd-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
		margin-bottom: 0.4em;
	}
	.hb-cmd-head-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.hb-cmd-title {
		margin: 0;
		font-size: clamp(1.15rem, 2.5vw, 1.35rem);
		color: var(--sage);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.hb-cmd-slash {
		color: var(--ink-3);
		font-weight: 500;
	}
	.hb-cmd-body {
		transition: opacity 0.2s ease;
	}
</style>
