<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { applyTheme } from '$lib/stores/theme';
	import { initViewport, getIsMobile } from '$lib/stores/viewport.svelte';
	import { getBookmarks, initBookmarks, remove } from '$lib/stores/handbookBookmarks.svelte';

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
		viewer: 'Mod Team / Ambassador',
		none: 'Signed in'
	};

	let { data, children } = $props();
	let user = $derived(data.user);
	let docs = $derived(data.docs);
	let currentSlug = $derived(($page.params as Record<string, string>)?.slug ?? null);
	let docIndexOpen = $state(false);

	onMount(() => {
		if (user?.accentColor != null) {
			applyTheme(user.accentColor);
		}
		initViewport();
		initBookmarks(data.bookmarks ?? [], data.user?.id ?? null);
	});

	let isMobile = $derived(getIsMobile());
	let bookmarks = $derived(getBookmarks());
</script>

<div class="hb-shell" class:hb-mobile={isMobile}>
	<header class="hb-topbar">
		<a class="hb-brand" href="/handbook" aria-label="Handbook home">
			<svg viewBox="0 0 32 32" aria-hidden="true">
				<rect x="3" y="5" width="22" height="22" rx="3" fill="var(--sage-deep)" />
				<rect x="6" y="5" width="22" height="22" rx="3" fill="var(--sage)" />
				<rect x="9" y="9" width="14" height="2" fill="var(--on-sage)" opacity="0.85" />
				<rect x="9" y="13" width="14" height="2" fill="var(--on-sage)" opacity="0.6" />
				<rect x="9" y="17" width="14" height="2" fill="var(--on-sage)" opacity="0.4" />
			</svg>
			<span class="hb-brand-text">
				Handbook
				<small>Pawtropolis Tech</small>
			</span>
		</a>

		<div class="hb-topbar-right">
			{#if user}
				<span class="hb-tier-chip" data-tier={user.tier}>
					{TIER_LABELS[user.tier as keyof typeof TIER_LABELS] ?? 'Signed in'}
				</span>
				<a class="hb-link" href="/dashboard">Dashboard</a>
			{:else}
				<a class="hb-cta" href="/auth/login?return=/handbook">Sign in with Discord</a>
			{/if}
		</div>

		<button
			class="hb-drawer-toggle"
			type="button"
			aria-label="Toggle doc index"
			aria-expanded={docIndexOpen}
			onclick={() => (docIndexOpen = !docIndexOpen)}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
			</svg>
		</button>
	</header>

	<div class="hb-body">
		<aside class="hb-rail" class:hb-rail-open={docIndexOpen}>
			<nav class="hb-rail-nav" aria-label="Handbook contents">
				{#if bookmarks.length > 0}
					<h2 class="hb-rail-title">Bookmarks</h2>
					<ul class="hb-rail-list hb-rail-bookmarks">
						{#each bookmarks as bm (bm.docSlug + '#' + bm.headingSlug)}
							<li>
								<a
									href={`/handbook/${bm.docSlug}#${bm.headingSlug}`}
									onclick={() => (docIndexOpen = false)}
								>
									<span class="hb-rail-doc-title">{bm.label}</span>
									<span class="hb-rail-doc-tagline">{bm.docTitle}</span>
								</a>
								<button
									type="button"
									class="hb-rail-remove"
									aria-label={`Remove bookmark for ${bm.label}`}
									title="Remove bookmark"
									onclick={() => remove(bm.docSlug, bm.headingSlug)}
								>
									×
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<h2 class="hb-rail-title">Documents</h2>
				<ul class="hb-rail-list">
					{#each docs as doc (doc.slug)}
						<li>
							<a
								href={`/handbook/${doc.slug}`}
								class:active={currentSlug === doc.slug}
								class:locked={doc.isLockedForLoggedOut}
								onclick={() => (docIndexOpen = false)}
							>
								<span class="hb-rail-doc-title">{doc.title}</span>
								<span class="hb-rail-doc-tagline">{doc.tagline}</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if !user}
					<p class="hb-rail-foot">
						Sign in to unlock the staff-only sections inline.
					</p>
				{/if}
			</nav>
		</aside>

		<main class="hb-main">
			{@render children?.()}
		</main>
	</div>

	{#if docIndexOpen}
		<button
			class="hb-backdrop"
			type="button"
			aria-label="Close doc index"
			onclick={() => (docIndexOpen = false)}
		></button>
	{/if}
</div>

<style>
	.hb-shell {
		min-height: 100vh;
		background: var(--void);
		color: var(--ink);
		font-family: 'Inter Variable', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}
	.hb-topbar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1.25rem;
		border-bottom: 1px solid var(--line-soft);
		background: var(--surface);
		position: sticky;
		top: 0;
		z-index: 20;
	}
	.hb-brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		text-decoration: none;
		color: var(--ink);
		flex: 1;
	}
	.hb-brand svg {
		width: 28px;
		height: 28px;
	}
	.hb-brand-text {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.hb-brand-text small {
		font-size: 0.7rem;
		color: var(--ink-3);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.hb-topbar-right {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.hb-tier-chip {
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.3em 0.7em;
		border-radius: var(--radius-sm);
		background: var(--sage-soft);
		color: var(--ink);
		border: 1px solid var(--sage-deep);
	}
	.hb-link {
		color: var(--ink-2);
		text-decoration: none;
		font-size: 0.92rem;
	}
	.hb-link:hover {
		color: var(--sage);
	}
	.hb-cta {
		display: inline-flex;
		align-items: center;
		padding: 0.5em 1em;
		border-radius: var(--radius-sm);
		background: var(--sage);
		color: var(--on-sage);
		font-weight: 600;
		text-decoration: none;
		font-size: 0.9rem;
		min-height: 36px;
	}
	.hb-cta:hover {
		background: var(--sage-bright);
	}
	.hb-drawer-toggle {
		display: none;
		background: none;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-sm);
		color: var(--ink);
		padding: 0.4rem;
		cursor: pointer;
	}
	.hb-drawer-toggle svg {
		width: 20px;
		height: 20px;
	}
	.hb-body {
		flex: 1;
		display: grid;
		grid-template-columns: 18rem minmax(0, 1fr);
		gap: 0;
		min-height: 0;
	}
	.hb-rail {
		border-right: 1px solid var(--line-soft);
		background: var(--surface);
		padding: 1rem 0.75rem 2rem;
		min-height: calc(100vh - 4rem);
		position: sticky;
		top: 4rem;
		align-self: start;
		overflow-y: auto;
		max-height: calc(100vh - 4rem);
	}
	.hb-rail-title {
		margin: 0 0 0.6rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--ink-3);
		padding: 0 0.5rem;
	}
	.hb-rail-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hb-rail-list li {
		margin: 0;
	}
	.hb-rail-bookmarks {
		margin-bottom: 1.2rem;
		padding-bottom: 0.8rem;
		border-bottom: 1px solid var(--line-soft);
	}
	.hb-rail-bookmarks li {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.hb-rail-bookmarks li a {
		flex: 1;
		min-width: 0;
	}
	.hb-rail-remove {
		flex: none;
		min-width: 32px;
		min-height: 32px;
		border: none;
		background: none;
		color: var(--ink-3);
		font-size: 1.1rem;
		line-height: 1;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.hb-rail-remove:hover {
		color: var(--ink);
		background: var(--hover-bg);
	}
	.hb-rail-list a {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.55rem 0.6rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--ink-2);
		border: 1px solid transparent;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}
	.hb-rail-list a:hover {
		background: var(--hover-bg);
		color: var(--ink);
	}
	.hb-rail-list a.active {
		background: var(--sage-soft);
		color: var(--ink);
		border-color: var(--sage-deep);
	}
	.hb-rail-list a.locked {
		opacity: 0.7;
	}
	.hb-rail-doc-title {
		font-weight: 600;
		font-size: 0.92rem;
	}
	.hb-rail-doc-tagline {
		font-size: 0.78rem;
		color: var(--ink-3);
	}
	.hb-rail-foot {
		margin: 1rem 0.6rem 0;
		padding-top: 0.8rem;
		font-size: 0.78rem;
		color: var(--ink-3);
		border-top: 1px solid var(--line-soft);
	}
	.hb-main {
		padding: 2rem clamp(1rem, 4vw, 2.5rem) 5rem;
		min-width: 0;
		max-width: 72ch;
		margin: 0 auto;
		width: 100%;
	}
	.hb-backdrop {
		display: none;
	}

	@media (max-width: 900px) {
		.hb-drawer-toggle {
			display: inline-flex;
		}
		.hb-body {
			grid-template-columns: 1fr;
		}
		.hb-rail {
			position: fixed;
			top: 0;
			left: 0;
			height: 100vh;
			width: min(20rem, 86vw);
			max-height: 100vh;
			transform: translateX(-105%);
			transition: transform 0.22s ease;
			z-index: 40;
			padding-top: 4.5rem;
		}
		.hb-rail-open {
			transform: translateX(0);
		}
		.hb-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: oklch(0% 0 0 / 0.5);
			z-index: 30;
			border: none;
			cursor: pointer;
		}
		.hb-main {
			padding: 1.2rem 1rem 4rem;
		}
	}
</style>
