<script lang="ts">
	import { page } from '$app/stores';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';

	let { data, children } = $props();

	const TIER_ORDER = ['owner', 'cm', 'cdl', 'sa', 'admin', 'sm', 'mod', 'jm', 'gk', 'viewer', 'none'];
	function hasMinTier(userTier: string, minTier: string): boolean {
		const ui = TIER_ORDER.indexOf(userTier);
		const mi = TIER_ORDER.indexOf(minTier);
		return ui !== -1 && mi !== -1 && ui <= mi;
	}

	const TABS = [
		{ label: 'Activity', href: '/dashboard/audit', exact: true },
		{ label: 'Scans', href: '/dashboard/audit/scans' },
		{ label: 'Security', href: '/dashboard/audit/security', minTier: 'sa' as const },
		{ label: 'Findings', href: '/dashboard/audit/findings' },
	];

	let visibleTabs = $derived(TABS.filter(t => !t.minTier || hasMinTier(data.userTier, t.minTier)));

	function isActive(tab: typeof TABS[number]): boolean {
		const path = $page.url.pathname;
		if (tab.exact) return path === tab.href;
		return path === tab.href || path.startsWith(tab.href + '/');
	}
</script>

<PageHeader title="Audit" />

<nav class="audit-tabs" aria-label="Audit sections">
	{#each visibleTabs as tab (tab.href)}
		<a
			href={tab.href}
			class="audit-tab"
			class:audit-tab-active={isActive(tab)}
			aria-current={isActive(tab) ? 'page' : undefined}
		>
			{tab.label}
		</a>
	{/each}
</nav>

<div class="audit-content">
	{@render children()}
</div>

<style>
	.audit-tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
	}

	.audit-tab {
		padding: 0.5rem 1rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink-2);
		text-decoration: none;
		border-bottom: 2px solid transparent;
		transition: all var(--duration-fast) var(--ease-smooth);
		white-space: nowrap;
	}

	.audit-tab-active {
		color: var(--sage);
		border-bottom-color: var(--sage);
	}

	@media (hover: hover) {
		.audit-tab:not(.audit-tab-active):hover {
			color: var(--ink);
		}
	}

	.audit-content {
		min-height: 0;
	}

	@media (max-width: 767px) {
		.audit-tab {
			padding: 0.625rem 0.75rem;
			min-height: 44px;
			display: flex;
			align-items: center;
		}
	}
</style>
