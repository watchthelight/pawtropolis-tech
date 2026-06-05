<script lang="ts">
	import { page } from '$app/stores';
	import ConnectionIndicator from './ConnectionIndicator.svelte';
	import { mode, nightDay, isLegacyMode, isLightMode } from '$lib/stores/appearanceStore.svelte';
	import {
		House, ClipboardCheck, BarChart3, Activity, Flag,
		Grid3x3, Palette, Settings, ScrollText, Server,
		MessageCircleQuestion, Mail, Sparkles, BookOpen,
		Moon, Sun, SlidersHorizontal
	} from 'lucide-svelte';

	let { user, collapsed = false, mobileOnly = false, isArtist = false, counts = {}, onOpenAppearance }: {
		user: { username: string; globalName: string | null; avatarUrl: string; tier: string };
		collapsed?: boolean;
		mobileOnly?: boolean;
		isArtist?: boolean;
		counts?: Record<string, number>;
		onOpenAppearance?: () => void;
	} = $props();

	const TIER_ORDER = ['owner', 'cm', 'cdl', 'sa', 'admin', 'sm', 'mod', 'jm', 'gk', 'viewer', 'none'];
	function hasMinTier(userTier: string, minTier: string): boolean {
		const u = TIER_ORDER.indexOf(userTier), m = TIER_ORDER.indexOf(minTier);
		return u !== -1 && m !== -1 && u <= m;
	}

	const TIER_LABELS: Record<string, string> = {
		owner: 'Owner / Dev', cm: 'Community Manager', cdl: 'Community Dev Lead',
		sa: 'Senior Administrator', admin: 'Administrator', sm: 'Senior Moderator',
		mod: 'Moderator', jm: 'Junior Moderator', gk: 'Gatekeeper',
		viewer: 'Mod Team (View Only)', none: 'No Access'
	};

	const ICON_MAP: Record<string, typeof House> = {
		Home: House, Reviews: ClipboardCheck, Stats: BarChart3, Modmail: Mail, Pulse: Activity,
		Flags: Flag, Heatmap: Grid3x3, Art: Palette, QOTD: MessageCircleQuestion,
		Quality: Sparkles, Config: Settings, Audit: ScrollText, System: Server, Handbook: BookOpen
	};

	const GROUP_LABELS: Record<string, string> = {
		ops: 'Operations', admin: 'Administration', docs: 'Reference'
	};

	const NAV_ITEMS = [
		{ label: 'Home',     href: '/dashboard',          minTier: 'gk',    group: 'ops',   key: 'home' },
		{ label: 'Reviews',  href: '/dashboard/reviews',  minTier: 'gk',    group: 'ops',   key: 'reviews' },
		{ label: 'Stats',    href: '/dashboard/stats',    minTier: 'gk',    group: 'ops',   key: 'stats' },
		{ label: 'Modmail',  href: '/dashboard/modmail',  minTier: 'gk',    group: 'ops',   key: 'modmail' },
		{ label: 'Pulse',    href: '/dashboard/pulse',    minTier: 'mod',   group: 'ops',   key: 'pulse' },
		{ label: 'Heatmap',  href: '/dashboard/heatmap',  minTier: 'sm',    group: 'ops',   key: 'heatmap' },
		{ label: 'Art',      href: '/dashboard/art',      minTier: 'sm',    group: 'ops',   key: 'art' },
		{ label: 'QOTD',     href: '/dashboard/qotd',     minTier: 'gk',    group: 'ops',   key: 'qotd' },
		{ label: 'Config',   href: '/dashboard/config',   minTier: 'admin', group: 'admin', key: 'config' },
		{ label: 'Audit',    href: '/dashboard/audit',    minTier: 'admin', group: 'admin', key: 'audit' },
		{ label: 'System',   href: '/dashboard/system',   minTier: 'owner', group: 'admin', key: 'system' },
		{ label: 'Backfill', href: '/dashboard/backfill', minTier: 'owner', group: 'admin', key: 'backfill' },
		{ label: 'Handbook', href: '/handbook',           minTier: 'none',  group: 'docs',  key: 'handbook' },
	] as const;

	const MOBILE_HREFS = new Set(['/dashboard', '/dashboard/reviews', '/dashboard/art']);
	let visibleItems = $derived(
		NAV_ITEMS.filter(item =>
			(hasMinTier(user.tier, item.minTier) || (item.href === '/dashboard/art' && isArtist)) &&
			(!mobileOnly || MOBILE_HREFS.has(item.href))
		)
	);

	function isActive(href: string): boolean {
		const path = $page.url.pathname;
		if (href === '/dashboard') return path === '/dashboard';
		return path === href || path.startsWith(href + '/');
	}

	let night = $derived(!isLegacyMode() && !isLightMode());
</script>

<nav aria-label="Main navigation" class="sidebar" class:collapsed>
	<!-- Brand -->
	<div class="brand" class:brand-collapsed={collapsed}>
		<img src="/paw-logo.png" alt="" class="brand-mark" width="26" height="26" />
		{#if !collapsed}
			<span class="brand-text">
				<span class="brand-name">Pawtropolis</span>
				<span class="brand-sub">Observatory</span>
			</span>
		{/if}
	</div>

	<!-- Identity -->
	<div class="identity" class:identity-collapsed={collapsed}>
		<img
			src={user.avatarUrl}
			alt={user.globalName || user.username}
			width="40" height="40" decoding="async" referrerpolicy="no-referrer"
			class="avatar" class:avatar-collapsed={collapsed}
		/>
		{#if !collapsed}
			<div class="identity-text">
				<p class="identity-name">{user.globalName || user.username}</p>
				<p class="identity-tier">
					{isArtist && user.tier === 'viewer' ? 'Server Artist' : (TIER_LABELS[user.tier] ?? user.tier)}
				</p>
			</div>
		{/if}
	</div>

	<!-- Navigation -->
	<ul class="nav-list">
		{#each visibleItems as item, i (item.href)}
			{@const active = isActive(item.href)}
			{@const prev = visibleItems[i - 1]}
			{#if !collapsed && (!prev || prev.group !== item.group)}
				<li class="nav-group-label">{GROUP_LABELS[item.group]}</li>
			{:else if collapsed && prev && prev.group !== item.group}
				<li class="nav-divider" aria-hidden="true"></li>
			{/if}
			<li>
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					title={collapsed ? item.label : undefined}
					class="nav-item"
					class:active
					class:nav-item-collapsed={collapsed}
				>
					<span class="nav-ico">
						<svelte:component this={ICON_MAP[item.label]} size={17} strokeWidth={active ? 2.1 : 1.75} />
						{#if collapsed && counts[item.key]}<span class="nav-dot" aria-hidden="true"></span>{/if}
					</span>
					{#if !collapsed}
						<span class="nav-label">{item.label}</span>
						{#if counts[item.key]}<span class="nav-count">{counts[item.key]}</span>{/if}
					{/if}
				</a>
			</li>
		{/each}
	</ul>

	<!-- Footer -->
	<div class="footer" class:footer-collapsed={collapsed}>
		{#if !collapsed}
			<div class="appearance-row">
				<button class="mode-btn" class:active={night} onclick={() => { if (!night) nightDay(); }} aria-pressed={night}>
					<Moon size={14} strokeWidth={1.75} /> Night
				</button>
				<button class="mode-btn" class:active={!night && !isLegacyMode()} onclick={() => { if (night) nightDay(); }} aria-pressed={!night}>
					<Sun size={14} strokeWidth={1.75} /> Day
				</button>
			</div>
			<button class="appearance-trigger" onclick={() => onOpenAppearance?.()}>
				<SlidersHorizontal size={14} strokeWidth={1.75} /> Appearance
			</button>
			<ConnectionIndicator />
			<a href="/auth/logout" class="signout">Sign out</a>
		{:else}
			<button class="mode-btn mode-btn-collapsed" onclick={() => nightDay()} title="Night / Day" aria-label="Toggle Night / Day">
				{#if night}<Moon size={15} strokeWidth={1.75} />{:else}<Sun size={15} strokeWidth={1.75} />{/if}
			</button>
			<button class="appearance-trigger appearance-trigger-collapsed" onclick={() => onOpenAppearance?.()} title="Appearance" aria-label="Appearance">
				<SlidersHorizontal size={15} strokeWidth={1.75} />
			</button>
		{/if}
	</div>
</nav>

<style>
	.sidebar {
		display: flex;
		height: 100%;
		flex-direction: column;
		background: var(--surface);
		border-right: 1px solid var(--line);
		overflow: hidden;
	}

	/* Brand */
	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.95rem 1rem 0.8rem;
	}
	.brand-collapsed { justify-content: center; padding: 0.8rem 0.5rem; }
	.brand-mark { flex-shrink: 0; border-radius: var(--radius); }
	.brand-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.1; }
	.brand-name {
		font-family: var(--font-head);
		font-weight: 600;
		font-size: 1rem;
		color: var(--ink);
		letter-spacing: -0.01em;
	}
	.brand-sub {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--sage-deep);
	}

	/* Identity */
	.identity {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem 1rem;
		margin: 0 0.6rem 0.3rem;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius);
		background: var(--void);
	}
	.identity-collapsed { justify-content: center; padding: 0.5rem; margin: 0 0.35rem 0.3rem; border: none; background: none; }
	.avatar {
		width: 2.5rem; height: 2.5rem;
		border-radius: var(--radius);
		border: 1px solid var(--line-strong);
		flex-shrink: 0;
		transition: width 200ms var(--ease-smooth), height 200ms var(--ease-smooth);
	}
	.avatar-collapsed { width: 2rem; height: 2rem; }
	.identity-text { min-width: 0; }
	.identity-name {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--ink);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.identity-tier {
		margin: 0;
		font-size: 0.72rem;
		color: var(--ink-3);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}

	/* Nav list */
	.nav-list { flex: 1; overflow-y: auto; padding: 0.3rem 0 0.6rem; list-style: none; margin: 0; }
	.nav-group-label {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding: 0.8rem 0.9rem 0.35rem;
	}
	.nav-divider { height: 1px; margin: 0.4rem 0.6rem; background: var(--line-soft); }

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.7rem;
		margin: 0.06rem 0.5rem;
		font-size: 0.875rem;
		color: var(--ink-2);
		border-radius: var(--radius);
		border-left: 2px solid transparent;
		transition: var(--motion-hover), color var(--duration-fast) var(--ease-smooth);
		white-space: nowrap;
		overflow: hidden;
	}
	.nav-item-collapsed { justify-content: center; padding: 0.5rem; margin: 0.06rem 0.3rem; gap: 0; }

	.nav-item.active {
		color: var(--ink);
		font-weight: 500;
		background: var(--sage-fill);
		box-shadow: inset 2px 0 0 var(--sage);
	}
	.nav-item-collapsed.active { box-shadow: inset 2px 0 0 var(--sage); }

	@media (hover: hover) {
		.nav-item:not(.active):hover {
			color: var(--ink);
			background: var(--surface-2);
			transform: translateX(1px);
		}
	}

	.nav-ico {
		position: relative;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
		color: var(--ink-3);
	}
	.nav-item.active .nav-ico { color: var(--sage); }
	@media (hover: hover) { .nav-item:not(.active):hover .nav-ico { color: var(--ink); } }

	.nav-dot {
		position: absolute;
		top: -2px; right: -3px;
		width: 6px; height: 6px;
		border-radius: var(--radius-pill);
		background: var(--sage);
	}

	.nav-label { overflow: hidden; text-overflow: ellipsis; flex: 1; }
	.nav-count {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--sage);
		background: var(--sage-fill);
		border-radius: var(--radius);
		padding: 0.02rem 0.34rem;
		flex-shrink: 0;
	}

	/* Footer */
	.footer {
		border-top: 1px solid var(--line-soft);
		padding: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.footer-collapsed { padding: 0.5rem; align-items: center; gap: 0.4rem; }

	.appearance-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
	.mode-btn {
		display: flex; align-items: center; justify-content: center; gap: 0.35rem;
		padding: 0.42rem;
		font-family: var(--font-body);
		font-size: 0.74rem;
		color: var(--ink-3);
		background: transparent;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius);
		cursor: pointer;
		transition: var(--motion-hover), color var(--duration-fast) var(--ease-smooth);
	}
	.mode-btn.active {
		color: var(--sage);
		background: var(--sage-fill);
		border-color: var(--sage-soft);
	}
	.mode-btn:not(.active):hover { color: var(--ink); border-color: var(--line); }
	.mode-btn-collapsed { width: 100%; }

	.appearance-trigger {
		display: flex; align-items: center; justify-content: center; gap: 0.4rem;
		padding: 0.42rem;
		font-family: var(--font-body);
		font-size: 0.74rem;
		color: var(--ink-2);
		background: transparent;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius);
		cursor: pointer;
		transition: var(--motion-hover), color var(--duration-fast) var(--ease-smooth);
	}
	.appearance-trigger:hover { color: var(--ink); border-color: var(--line); }
	.appearance-trigger-collapsed { width: 100%; }

	.signout {
		font-size: 0.78rem;
		color: var(--ink-3);
		text-decoration: none;
		transition: color var(--duration-fast) var(--ease-smooth);
	}
	.signout:hover { color: var(--ink); }

	@media (max-width: 767px) {
		.nav-item { padding: 0.625rem 0.7rem; min-height: 44px; }
	}
</style>
