<script lang="ts">
	import { page } from '$app/stores';
	import { slide } from 'svelte/transition';
	import ConnectionIndicator from './ConnectionIndicator.svelte';

	let { user, collapsed = false }: {
		user: {
			username: string;
			globalName: string | null;
			avatarUrl: string;
			tier: string;
		};
		collapsed?: boolean;
	} = $props();

	// Inline tier check — $lib/server/roles.ts can't be imported client-side
	const TIER_ORDER = ['owner', 'cm', 'cdl', 'sa', 'admin', 'sm', 'mod', 'jm', 'gk', 'viewer', 'none'];
	function hasMinTier(userTier: string, minTier: string): boolean {
		const userIdx = TIER_ORDER.indexOf(userTier);
		const minIdx = TIER_ORDER.indexOf(minTier);
		if (userIdx === -1 || minIdx === -1) return false;
		return userIdx <= minIdx;
	}

	const TIER_LABELS: Record<string, string> = {
		owner: 'Owner / Dev',
		cm: 'Community Manager',
		cdl: 'Community Dev Lead',
		sa: 'Senior Administrator',
		admin: 'Administrator',
		sm: 'Senior Moderator',
		mod: 'Moderator',
		jm: 'Junior Moderator',
		gk: 'Gatekeeper',
		viewer: 'Mod Team (View Only)',
		none: 'No Access'
	};

	const NAV_ITEMS = [
		{ label: 'Home',     href: '/dashboard',          minTier: 'gk' },
		{ label: 'Reviews',  href: '/dashboard/reviews',  minTier: 'gk' },
		{ label: 'Stats',    href: '/dashboard/stats',    minTier: 'gk' },
		{ label: 'Pulse',    href: '/dashboard/pulse',    minTier: 'mod' },
		{ label: 'Flags',    href: '/dashboard/flags',    minTier: 'sm' },
		{ label: 'Heatmap',  href: '/dashboard/heatmap',  minTier: 'sm' },
		{ label: 'Art',      href: '/dashboard/art',      minTier: 'sm' },
		{ label: 'Config',   href: '/dashboard/config',   minTier: 'admin' },
		{ label: 'Audit',    href: '/dashboard/audit',    minTier: 'admin' },
		{ label: 'Security', href: '/dashboard/security', minTier: 'sa' },
		{ label: 'System',   href: '/dashboard/system',   minTier: 'owner' },
	] as const;

	let visibleItems = $derived(NAV_ITEMS.filter(item => hasMinTier(user.tier, item.minTier)));

	function isActive(href: string): boolean {
		const path = $page.url.pathname;
		if (href === '/dashboard') return path === '/dashboard';
		return path === href || path.startsWith(href + '/');
	}
</script>

<nav aria-label="Main navigation" class="sidebar" class:sidebar-collapsed={collapsed}>
	<!-- Identity section -->
	<div class="identity" class:identity-collapsed={collapsed}>
		<img
			src={user.avatarUrl}
			alt={user.globalName || user.username}
			class="avatar"
			class:avatar-collapsed={collapsed}
		/>
		{#if !collapsed}
			<div class="min-w-0">
				<p class="truncate text-sm font-medium text-[var(--text-primary)]">
					{user.globalName || user.username}
				</p>
				<p class="text-xs text-[var(--text-secondary)]">
					{TIER_LABELS[user.tier] ?? user.tier}
				</p>
			</div>
		{/if}
	</div>

	<!-- Navigation items -->
	<ul class="flex-1 overflow-y-auto py-2">
		{#each visibleItems as item (item.href)}
			{@const active = isActive(item.href)}
			<li transition:slide={{ duration: 200 }}>
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					title={collapsed ? item.label : undefined}
					class="nav-item"
					class:nav-active={active}
					class:nav-inactive={!active}
					class:nav-item-collapsed={collapsed}
				>
					<span class="nav-letter" class:nav-letter-show={collapsed}>{item.label.charAt(0)}</span>
					{#if !collapsed}
						<span class="nav-label">{item.label}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>

	<!-- Footer section -->
	<div class="footer" class:footer-collapsed={collapsed}>
		{#if !collapsed}
			<ConnectionIndicator />
			<a
				href="/auth/logout"
				class="block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
			>
				Logout
			</a>
		{/if}
	</div>
</nav>

<style>
	.sidebar {
		display: flex;
		height: 100%;
		flex-direction: column;
		background: var(--bg);
		border-right: 1px solid var(--border-holdfast);
		overflow: hidden;
	}

	/* Identity */
	.identity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border-bottom: 1px solid var(--border-holdfast);
	}

	.identity-collapsed {
		justify-content: center;
		padding: 0.75rem;
	}

	.avatar {
		width: 3rem;
		height: 3rem;
		border-radius: var(--radius-md);
		ring: 2px solid var(--accent);
		flex-shrink: 0;
		transition: width 200ms var(--ease-smooth), height 200ms var(--ease-smooth);
	}

	.avatar-collapsed {
		width: 2rem;
		height: 2rem;
	}

	/* Nav items */
	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		margin: 0.125rem 0.5rem;
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition: all 150ms var(--ease-smooth);
		white-space: nowrap;
		overflow: hidden;
	}

	.nav-item-collapsed {
		justify-content: center;
		padding: 0.5rem;
		margin: 0.125rem 0.25rem;
	}

	.nav-active {
		color: var(--text-primary);
		font-weight: 500;
		background: var(--surface);
		box-shadow: inset 3px 0 0 var(--accent), var(--glow-accent);
	}

	.nav-item-collapsed.nav-active {
		box-shadow: var(--glow-accent);
	}

	.nav-inactive {
		color: var(--text-secondary);
	}

	.nav-inactive:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	.nav-inactive:not(.nav-item-collapsed):hover {
		transform: translateX(2px);
	}

	/* Letter icon (shown when collapsed) */
	.nav-letter {
		display: none;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		font-weight: 600;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.nav-letter-show {
		display: flex;
	}

	.nav-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Footer */
	.footer {
		border-top: 1px solid var(--border-holdfast);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.footer-collapsed {
		padding: 0.5rem;
		align-items: center;
	}

	/* Toggle button */
	.toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
		width: 100%;
	}

	.toggle-btn:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	.toggle-icon {
		font-size: 0.7rem;
		transition: transform 200ms var(--ease-smooth);
	}

	.toggle-icon-flipped {
		transform: rotate(180deg);
	}

	.toggle-label {
		font-size: 0.75rem;
	}
</style>
