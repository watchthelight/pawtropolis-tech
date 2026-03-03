<script lang="ts">
	import { applyTheme } from '$lib/stores/theme';
	import { connect, disconnect, onReconnect, offReconnect } from '$lib/stores/sse.svelte';
	import { startMonitoring, stopMonitoring } from '$lib/stores/bot-status.svelte';
	import { invalidateAll } from '$app/navigation';
	import Nav from '$lib/components/layout/Nav.svelte';

	let { data, children } = $props();
	let user = $derived(data.user);

	$effect(() => {
		applyTheme(user.accentColor, user.avatarUrl);
	});

	// Refresh Discord profile data once per browser session
	$effect(() => {
		if (typeof sessionStorage === 'undefined') return;
		if (sessionStorage.getItem('profileRefreshed')) return;
		sessionStorage.setItem('profileRefreshed', '1');

		fetch('/api/refresh-session')
			.then((r) => r.json())
			.then((result) => {
				if (result.changed) {
					applyTheme(result.accentColor ?? user.accentColor, user.avatarUrl);
				}
			})
			.catch(() => {}); // silent on failure
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
