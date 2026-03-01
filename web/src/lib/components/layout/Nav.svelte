<script lang="ts">
	import { page } from '$app/stores';

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
		return TIER_ORDER.indexOf(userTier) <= TIER_ORDER.indexOf(minTier);
	}

	const TIER_LABELS: Record<string, string> = {
		owner: 'Owner / Dev',
		cm: 'Community Manager',
		sa: 'Senior Admin',
		admin: 'Administrator',
		sm: 'Senior Mod',
		mod: 'Moderator',
		jm: 'Junior Mod',
		gk: 'Gatekeeper',
		viewer: 'View Only',
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

<nav aria-label="Main navigation" class="flex h-full flex-col bg-[var(--bg)] border-r border-[var(--border)]">
	<!-- Identity section -->
	<div class="flex items-center gap-3 p-4 border-b border-[var(--border)]">
		<img
			src={user.avatarUrl}
			alt={user.username}
			class="w-10 h-10 rounded-full ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]"
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
					class="flex items-center px-4 py-2 text-sm transition-colors"
					class:border-l-[3px]={active}
					class:border-l-[var(--accent)]={active}
					class:text-[var(--text-primary)]={active}
					class:font-medium={active}
					class:bg-[var(--surface)]={active}
					class:text-[var(--text-secondary)]={!active}
					class:border-l-[3px]={!active}
					class:border-l-transparent={!active}
					class:hover:bg-[var(--surface-raised)]={!active}
					class:hover:text-[var(--text-primary)]={!active}
				>
					{item.label}
				</a>
			</li>
		{/each}
	</ul>

	<!-- Footer section -->
	<div class="border-t border-[var(--border)] p-4 space-y-3">
		<div class="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
			<span class="inline-block w-2 h-2 rounded-full bg-[var(--status-success)]"></span>
			Connected
		</div>
		<a
			href="/auth/logout"
			class="block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
		>
			Logout
		</a>
	</div>
</nav>
