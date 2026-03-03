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

<div class="layout-root">
	<aside class="sidebar-aside" class:sidebar-aside-collapsed={sidebarCollapsed}>
		<Nav {user} collapsed={sidebarCollapsed} />
	</aside>

	<!-- Edge toggle on the divider -->
	<button
		class="edge-toggle"
		class:edge-toggle-collapsed={sidebarCollapsed}
		onclick={toggleSidebar}
		title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
	>
		<span class="edge-arrow" class:edge-arrow-flipped={sidebarCollapsed}>&#9666;</span>
	</button>

	<main class="flex-1 p-8">
		{@render children()}
	</main>
</div>

<style>
	.layout-root {
		display: flex;
		min-height: 100vh;
		background: var(--bg);
		position: relative;
	}

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

	/* Edge toggle — small arrow on the sidebar border */
	.edge-toggle {
		position: sticky;
		top: 50%;
		z-index: 10;
		width: 14px;
		height: 40px;
		margin-left: -7px;
		margin-right: -7px;
		align-self: flex-start;
		margin-top: calc(50vh - 20px);
		border: 1px solid var(--border-holdfast);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-secondary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 150ms;
		opacity: 0;
		flex-shrink: 0;
	}

	.layout-root:hover .edge-toggle,
	.edge-toggle:focus-visible {
		opacity: 1;
	}

	.edge-toggle:hover {
		background: var(--surface-raised);
		color: var(--text-primary);
		border-color: var(--accent);
		box-shadow: var(--glow-accent);
	}

	.edge-arrow {
		font-size: 0.55rem;
		line-height: 1;
		transition: transform 200ms;
	}

	.edge-arrow-flipped {
		transform: rotate(180deg);
	}
</style>
