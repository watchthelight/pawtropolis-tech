<script lang="ts">
	import { applyTheme } from '$lib/stores/theme';
	import { connect, disconnect, onReconnect, offReconnect } from '$lib/stores/sse.svelte';
	import { startMonitoring, stopMonitoring } from '$lib/stores/bot-status.svelte';
	import { invalidateAll } from '$app/navigation';
	import Nav from '$lib/components/layout/Nav.svelte';

	let { data, children } = $props();
	const { user } = data;

	$effect(() => {
		applyTheme(user.accentColor);
	});

	$effect(() => {
		const refreshOnReconnect = () => invalidateAll();
		connect();
		startMonitoring();
		onReconnect(refreshOnReconnect);
		return () => {
			offReconnect(refreshOnReconnect);
			stopMonitoring();
			disconnect();
		};
	});
</script>

<div class="flex min-h-screen bg-[var(--bg)]">
	<aside class="sticky top-0 h-screen w-60 shrink-0 overflow-y-auto">
		<Nav {user} />
	</aside>

	<main class="flex-1 p-8">
		{@render children()}
	</main>
</div>
