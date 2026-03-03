<script lang="ts">
	import { onMount } from 'svelte';
	import { applyTheme } from '$lib/stores/theme';
	import { connect, disconnect, onReconnect, offReconnect, subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import { startMonitoring, stopMonitoring } from '$lib/stores/bot-status.svelte';
	import { invalidateAll } from '$app/navigation';
	import type { SSEEvent } from '$lib/types/events';
	import Nav from '$lib/components/layout/Nav.svelte';

	let { data, children } = $props();
	let user = $derived(data.user);

	// Sidebar collapse state — persisted to localStorage
	let sidebarCollapsed = $state(false);
	onMount(() => {
		sidebarCollapsed = localStorage.getItem('sidebar-collapsed') === '1';
	});
	function toggleSidebar() {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem('sidebar-collapsed', sidebarCollapsed ? '1' : '0');
	}

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

	// Live tier expansion — refresh session and reload on role change
	function onRoleChanged(_event: SSEEvent) {
		fetch('/api/refresh-session')
			.then((r) => r.json())
			.then((result) => {
				if (result.tierChanged) invalidateAll();
			})
			.catch(() => {});
	}

	$effect(() => {
		const refreshOnReconnect = () => invalidateAll();
		connect();
		startMonitoring();
		subscribe('role:changed', onRoleChanged);
		onReconnect(refreshOnReconnect);
		return () => {
			offReconnect(refreshOnReconnect);
			unsubscribe('role:changed', onRoleChanged);
			stopMonitoring();
			disconnect();
		};
	});
</script>

<div class="flex min-h-screen bg-[var(--bg)]">
	<aside class="sidebar-aside" class:sidebar-aside-collapsed={sidebarCollapsed}>
		<Nav {user} collapsed={sidebarCollapsed} ontoggle={toggleSidebar} />
	</aside>

	<main class="flex-1 p-8">
		{@render children()}
	</main>
</div>

<style>
	.sidebar-aside {
		position: sticky;
		top: 0;
		height: 100vh;
		width: 15rem;
		flex-shrink: 0;
		overflow-y: auto;
		transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.sidebar-aside-collapsed {
		width: 3.5rem;
	}
</style>
