<script lang="ts">
	import { onMount } from 'svelte';
	import { applyTheme, restoreCachedHue } from '$lib/stores/theme';
	import { connect, disconnect, onReconnect, offReconnect, subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import { startMonitoring, stopMonitoring } from '$lib/stores/bot-status.svelte';
	import { invalidateAll } from '$app/navigation';
	import type { SSEEvent } from '$lib/types/events';
	import Nav from '$lib/components/layout/Nav.svelte';

	let { data, children } = $props();
	let user = $derived(data.user);

	// Tier change toast
	const TIER_LABELS: Record<string, string> = {
		owner: 'Owner / Dev', cm: 'Community Manager', cdl: 'Community Dev Lead',
		sa: 'Senior Administrator', admin: 'Administrator', sm: 'Senior Moderator',
		mod: 'Moderator', jm: 'Junior Moderator', gk: 'Gatekeeper', viewer: 'Mod Team'
	};
	let tierToast = $state<string | null>(null);
	let tierToastTimer: ReturnType<typeof setTimeout> | undefined;

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
		restoreCachedHue(user.id);
		applyTheme(user.accentColor, user.avatarUrl, user.id);
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
		const oldTier = user.tier;
		fetch('/api/refresh-session')
			.then((r) => r.json())
			.then((result) => {
				if (result.tierChanged) {
					const label = TIER_LABELS[result.tier] ?? result.tier;
					const TIER_ORDER = ['owner','cm','cdl','sa','admin','sm','mod','jm','gk','viewer','none'];
					const promoted = TIER_ORDER.indexOf(result.tier) < TIER_ORDER.indexOf(oldTier);
					tierToast = promoted ? `${label} unlocked` : `Role updated to ${label}`;
					if (tierToastTimer) clearTimeout(tierToastTimer);
					tierToastTimer = setTimeout(() => { tierToast = null; }, 3000);
					invalidateAll();
				}
			})
			.catch(() => {});
	}

	onMount(() => {
		if ('Notification' in window && Notification.permission === 'default') {
			Notification.requestPermission();
		}
	});

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

	{#if tierToast}
		<div class="tier-toast">{tierToast}</div>
	{/if}
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

	/* Tier change toast */
	.tier-toast {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.75rem 1.5rem;
		border-radius: var(--radius-md);
		background: var(--accent);
		color: var(--bg);
		font-size: 0.875rem;
		font-weight: 600;
		box-shadow: 0 4px 24px oklch(0% 0 0 / 0.4);
		z-index: 100;
		animation: toast-in 300ms ease-out, toast-out 300ms ease-in 2.7s forwards;
	}

	@keyframes toast-in {
		from { opacity: 0; transform: translateX(-50%) translateY(1rem); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	@keyframes toast-out {
		from { opacity: 1; transform: translateX(-50%) translateY(0); }
		to { opacity: 0; transform: translateX(-50%) translateY(-0.5rem); }
	}
</style>
