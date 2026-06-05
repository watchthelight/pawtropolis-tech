<script lang="ts">
	import ModmailViewer from '$lib/components/review/ModmailViewer.svelte';
	import Avatar from '$lib/components/data/Avatar.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';

	let { data } = $props();
	let thread = $derived(data.thread);
	let userId = $derived(data.userId);
	let username = $derived(data.username);
	let avatarUrl = $derived(data.avatarUrl);
	let appCode = $derived(data.appCode);
</script>

<div class="conversation">
	<header class="convo-header">
		<Avatar src={avatarUrl} name={username} size={44} />
		<div class="convo-id">
			<div class="convo-name-row">
				<span class="convo-name">{username}</span>
				{#if appCode}
					<span class="convo-code">#{appCode}</span>
				{/if}
				<span class="convo-status" class:status-open={thread.status === 'open'}>
					{thread.status}
				</span>
			</div>
			<CopyableId value={userId} />
		</div>
	</header>

	<div class="convo-body">
		<ModmailViewer threads={[thread]} targetUserId={userId} />
	</div>
</div>

<style>
	.conversation {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.convo-header {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}
	.convo-id { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
	.convo-name-row { display: flex; align-items: center; gap: 0.5rem; }
	.convo-name { font-size: 0.95rem; font-weight: 600; color: var(--ink); }
	.convo-code { font-size: 0.75rem; color: var(--ink-3); }
	.convo-status {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--ink-2);
	}
	.convo-status.status-open { background: oklch(28% 0.06 145); color: oklch(80% 0.14 145); }
	.convo-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0; }
</style>
