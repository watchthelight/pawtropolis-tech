<script lang="ts">
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	let { data } = $props();
	let threads = $derived(data.threads);
</script>

<div class="placeholder">
	{#if threads.length > 0}
		<EmptyState message="Pick a thread" subtitle="Click any conversation on the left to read and reply." />
	{:else}
		<EmptyState message="Inbox empty" subtitle="No modmail threads to show right now." />
	{/if}
</div>

<style>
	.placeholder { display: flex; align-items: center; justify-content: center; height: 100%; padding: 2rem; }
</style>
