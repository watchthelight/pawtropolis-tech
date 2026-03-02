<script lang="ts">
	import { page } from '$app/stores';
	import ConnectionIndicator from './ConnectionIndicator.svelte';

	let { user }: {
		user: {
			username: string;
			globalName: string | null;
			avatarUrl: string;
			tier: string;
		};
	} = $props();

	// Inline tier check — $lib/server/roles.ts can't be imported client-side
	const TIER_ORDER = ['owner', 'cm', 'sa', 'admin', 'sm', 'mod', 'jm', 'gk', 'viewer', 'none'];
	function hasMinTier(userTier: string, minTier: string): boolean {
		const userIdx = TIER_ORDER.indexOf(userTier);
		const minIdx = TIER_ORDER.indexOf(minTier);
		if (userIdx === -1 || minIdx === -1) return false;
		return userIdx <= minIdx;
	}

	const TIER_LABELS: Record<string, string> = {
		owner: 'Owner / Dev',
		cm: 'Community Manager',
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

<nav aria-label="Main navigation" class="flex h-full flex-col bg-[var(--bg)] border-r border-[var(--border-holdfast)]">
	<!-- Identity section -->
	<div class="flex items-center gap-3 p-4 border-b border-[var(--border-holdfast)]">
		<img
			src={user.avatarUrl}
			alt={user.globalName || user.username}
			class="w-12 h-12 rounded-[var(--radius-md)] ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]"
		/>
		<div class="min-w-0">
			<p class="truncate text-sm font-medium text-[var(--text-primary)]">
				{user.globalName || user.username}
			</p>
			<p class="text-xs text-[var(--text-secondary)]">
				{TIER_LABELS[user.tier] ?? user.tier}
			</p>
		</div>
	</div>

	<!-- Navigation items -->
	<ul class="flex-1 overflow-y-auto py-2">
		{#each visibleItems as item}
			{@const active = isActive(item.href)}
			<li>
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class="nav-item"
					class:nav-active={active}
					class:nav-inactive={!active}
				>
					{item.label}
				</a>
			</li>
		{/each}
	</ul>

	<!-- Footer section -->
	<div class="border-t border-[var(--border-holdfast)] p-4 space-y-3">
		<ConnectionIndicator />
		<a
			href="/auth/logout"
			class="block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
		>
			Logout
		</a>
	</div>
</nav>

<style>
	.nav-item {
		display: flex;
		align-items: center;
		padding: 0.5rem 1rem;
		margin: 0.125rem 0.5rem;
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition: all 150ms var(--ease-smooth);
	}

	.nav-active {
		color: var(--text-primary);
		font-weight: 500;
		background: var(--surface);
		box-shadow: inset 3px 0 0 var(--accent), var(--glow-accent);
	}

	.nav-inactive {
		color: var(--text-secondary);
	}

	.nav-inactive:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
		transform: translateX(2px);
	}
</style>
