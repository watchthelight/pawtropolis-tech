<script lang="ts">
	import { onMount } from 'svelte';
	import { applyTheme, restoreCachedHue } from '$lib/stores/theme';
	import { connect, disconnect, onReconnect, offReconnect, subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import { startMonitoring, stopMonitoring } from '$lib/stores/bot-status.svelte';
	import { initViewport, getIsMobile } from '$lib/stores/viewport.svelte';
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import type { SSEEvent } from '$lib/types/events';
	import Nav from '$lib/components/layout/Nav.svelte';
	import ConnectionIndicator from '$lib/components/layout/ConnectionIndicator.svelte';

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
		initViewport();
	});
	function toggleSidebar() {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem('sidebar-collapsed', sidebarCollapsed ? '1' : '0');
	}

	// Mobile drawer
	let isMobile = $derived(getIsMobile());
	let drawerOpen = $state(false);

	afterNavigate(() => { drawerOpen = false; });

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.body.classList.toggle('drawer-open', isMobile && drawerOpen);
	});

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

{#if isMobile}
	<header class="mobile-header">
		<button class="mobile-menu-btn" onclick={() => drawerOpen = !drawerOpen} aria-label="Menu">
			<span class="menu-line" class:menu-open={drawerOpen}></span>
			<span class="menu-line" class:menu-open={drawerOpen}></span>
			<span class="menu-line" class:menu-open={drawerOpen}></span>
		</button>
		<img src="/paw-logo.png" alt="" class="mobile-logo" />
		<ConnectionIndicator />
	</header>
{/if}

<div class="layout-root">
	<aside
		class="sidebar-aside"
		class:sidebar-aside-collapsed={!isMobile && sidebarCollapsed}
		class:sidebar-mobile={isMobile}
		class:sidebar-mobile-open={isMobile && drawerOpen}
	>
		<Nav {user} collapsed={!isMobile && sidebarCollapsed} />
	</aside>

	{#if isMobile && drawerOpen}
		<div class="drawer-backdrop" role="presentation" onclick={() => drawerOpen = false}></div>
	{/if}

	{#if !isMobile}
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
	{/if}

	<main class="flex-1 p-8 max-md:p-4 max-md:pt-[calc(var(--mobile-header-h)+1rem)]">
		{@render children()}
	</main>

	{#if tierToast}
		<div class="tier-toast">{tierToast}</div>
	{/if}
</div>

<style>
	.layout-root {
		display: flex;
		min-height: var(--vh-full);
		background: var(--bg);
		position: relative;
	}

	/* ── Desktop sidebar ── */
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

	/* ── Mobile header bar ── */
	.mobile-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: var(--mobile-header-h);
		background: var(--bg);
		border-bottom: 1px solid var(--border-holdfast);
		display: flex;
		align-items: center;
		padding: 0 var(--mobile-pad);
		gap: 0.75rem;
		z-index: 50;
	}

	.mobile-logo {
		width: 28px;
		height: 28px;
		filter: drop-shadow(0 2px 8px oklch(50% 0.2 330 / 0.25));
	}

	.mobile-menu-btn {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
		background: none;
		border: none;
		cursor: pointer;
	}

	.menu-line {
		width: 20px;
		height: 2px;
		background: var(--text-primary);
		border-radius: 1px;
		transition: transform 200ms var(--ease-smooth), opacity 200ms;
	}

	.menu-line:nth-child(1).menu-open { transform: translateY(6px) rotate(45deg); }
	.menu-line:nth-child(2).menu-open { opacity: 0; }
	.menu-line:nth-child(3).menu-open { transform: translateY(-6px) rotate(-45deg); }

	/* ── Mobile drawer ── */
	.sidebar-mobile {
		position: fixed;
		top: var(--mobile-header-h);
		left: 0;
		bottom: 0;
		width: 16rem;
		height: auto;
		z-index: 40;
		transform: translateX(-100%);
		transition: transform 250ms var(--ease-smooth);
	}

	.sidebar-mobile-open {
		transform: translateX(0);
	}

	.drawer-backdrop {
		position: fixed;
		inset: 0;
		top: var(--mobile-header-h);
		background: oklch(5% 0.01 var(--hue) / 0.6);
		z-index: 35;
		backdrop-filter: blur(2px);
	}

	/* ── Edge toggle — small arrow on the sidebar border ── */
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

	/* ── Tier change toast ── */
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
