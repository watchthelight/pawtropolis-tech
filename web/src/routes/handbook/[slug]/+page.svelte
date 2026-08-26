<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import MdNode from '$lib/components/handbook/MdNode.svelte';
	import BookmarkToggle from '$lib/components/handbook/BookmarkToggle.svelte';
	import { HANDBOOK_TIER_LABELS } from '$lib/handbook-shared';

	let { data } = $props();
	let tocOpen = $state(false);

	let activeHeading = $state<string | null>(null);

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) activeHeading = visible[0].target.id;
			},
			{ rootMargin: '-80px 0px -60% 0px' }
		);
		document.querySelectorAll<HTMLElement>('[id]').forEach((el) => observer.observe(el));
		return () => observer.disconnect();
	});

	function jumpTo(slug: string) {
		tocOpen = false;
		const el = document.getElementById(slug);
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>{data.title} · Handbook</title>
	<meta name="description" content={data.tagline} />
</svelte:head>

<article class="hb-doc">
	<header class="hb-doc-head">
		<small class="hb-doc-eyebrow">Handbook</small>
		<h1>{data.title}</h1>
		<p class="hb-doc-tagline">{data.tagline}</p>
		<div class="hb-doc-meta">
			<span>
				<strong>{data.toc.length}</strong> section{data.toc.length === 1 ? '' : 's'}
			</span>
			<span>
				Default tier: <strong>{HANDBOOK_TIER_LABELS[data.defaultTier as keyof typeof HANDBOOK_TIER_LABELS]}</strong>
			</span>
			{#if data.isLoggedOut}
				<span class="hb-doc-public">Showing public-tier content. Sign in for the rest.</span>
			{/if}
		</div>
	</header>

	<div class="hb-doc-body">
		{#each data.tokens as t, i (i)}
			<MdNode token={t} />
		{/each}
	</div>
</article>

<button
	type="button"
	class="hb-toc-fab"
	aria-label="Show section index"
	onclick={() => (tocOpen = !tocOpen)}
>
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 6h12M4 12h12M4 18h12M20 6h.01M20 12h.01M20 18h.01" />
	</svg>
	<span>On this page</span>
</button>

{#if tocOpen}
	<div class="hb-toc-sheet">
		<header class="hb-toc-head">
			<strong>On this page</strong>
			<button type="button" aria-label="Close" onclick={() => (tocOpen = false)}>×</button>
		</header>
		<ul class="hb-toc-list">
			{#each data.toc as entry, i (i)}
				<li class="hb-toc-d{entry.depth}">
					<button
						type="button"
						class:active={activeHeading === entry.slug}
						onclick={() => jumpTo(entry.slug)}
					>
						<span class="hb-toc-text">{entry.text}</span>
						<span class="hb-toc-tier" data-tier={entry.tier}>
							{HANDBOOK_TIER_LABELS[entry.tier as keyof typeof HANDBOOK_TIER_LABELS]}
						</span>
					</button>
					<BookmarkToggle headingSlug={entry.slug} label={entry.text} />
				</li>
			{/each}
		</ul>
	</div>
	<button class="hb-toc-backdrop" type="button" aria-label="Close" onclick={() => (tocOpen = false)}></button>
{/if}

<aside class="hb-toc-desktop" aria-label="Section index">
	<h3>On this page</h3>
	<ul>
		{#each data.toc as entry, i (i)}
			<li class="hb-toc-d{entry.depth}">
				<a
					href={`#${entry.slug}`}
					class:active={activeHeading === entry.slug}
					data-tier={entry.tier}
				>
					{entry.text}
				</a>
				<BookmarkToggle headingSlug={entry.slug} label={entry.text} compact />
			</li>
		{/each}
	</ul>
</aside>

<style>
	.hb-doc {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.hb-doc-head {
		margin-bottom: 0.5rem;
	}
	.hb-doc-eyebrow {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--sage);
		font-weight: 700;
	}
	.hb-doc-head h1 {
		margin: 0.3rem 0 0;
		font-size: clamp(2rem, 5vw, 2.8rem);
		color: var(--ink);
		letter-spacing: -0.02em;
	}
	.hb-doc-tagline {
		margin: 0.4rem 0 0;
		color: var(--ink-2);
		font-size: 1.02rem;
	}
	.hb-doc-meta {
		margin-top: 0.8rem;
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.88rem;
		color: var(--ink-3);
	}
	.hb-doc-meta strong {
		color: var(--ink);
		font-weight: 600;
	}
	.hb-doc-public {
		color: var(--sage);
	}
	.hb-doc-body {
		font-size: 1rem;
	}

	.hb-toc-desktop {
		display: none;
		position: fixed;
		right: 2rem;
		top: 6rem;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
		width: 14rem;
		padding: 1rem;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.hb-toc-desktop h3 {
		margin: 0 0 0.6rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--ink-3);
	}
	.hb-toc-desktop ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hb-toc-desktop li {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.hb-toc-desktop a {
		flex: 1;
		min-width: 0;
		display: block;
		padding: 0.3rem 0.5rem;
		border-radius: var(--radius-sm);
		color: var(--ink-3);
		text-decoration: none;
		font-size: 0.85rem;
		line-height: 1.3;
	}
	.hb-toc-desktop a:hover {
		color: var(--ink);
	}
	.hb-toc-desktop a.active {
		color: var(--sage);
		background: var(--sage-soft);
	}
	.hb-toc-desktop .hb-toc-d3 a,
	.hb-toc-desktop .hb-toc-d4 a {
		padding-left: 1.1rem;
		font-size: 0.8rem;
	}

	@media (min-width: 1280px) {
		.hb-toc-desktop {
			display: block;
		}
	}

	.hb-toc-fab {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		padding: 0.65rem 1rem;
		border-radius: 999px;
		background: var(--sage);
		color: var(--on-sage);
		border: none;
		box-shadow: var(--shadow-md);
		font-size: 0.92rem;
		font-weight: 600;
		cursor: pointer;
		z-index: 25;
		min-height: 44px;
	}
	.hb-toc-fab svg {
		width: 18px;
		height: 18px;
	}
	@media (min-width: 1280px) {
		.hb-toc-fab {
			display: none;
		}
	}
	.hb-toc-sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 75vh;
		background: var(--surface-2);
		border-top-left-radius: var(--radius-lg);
		border-top-right-radius: var(--radius-lg);
		border-top: 1px solid var(--line);
		z-index: 50;
		display: flex;
		flex-direction: column;
		animation: hb-slide-up 0.22s ease;
	}
	@keyframes hb-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	.hb-toc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.8rem 1.1rem;
		border-bottom: 1px solid var(--line-soft);
		color: var(--ink);
	}
	.hb-toc-head button {
		background: none;
		border: none;
		font-size: 1.4rem;
		color: var(--ink-2);
		cursor: pointer;
		min-height: 44px;
		min-width: 44px;
	}
	.hb-toc-list {
		list-style: none;
		margin: 0;
		padding: 0.4rem 0.6rem 1rem;
		overflow-y: auto;
	}
	.hb-toc-list li {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	.hb-toc-list button {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		padding: 0.6rem 0.7rem;
		border: none;
		background: transparent;
		text-align: left;
		color: var(--ink-2);
		font-size: 0.93rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		min-height: 44px;
	}
	.hb-toc-list button:hover {
		background: var(--hover-bg);
		color: var(--ink);
	}
	.hb-toc-list button.active {
		color: var(--sage);
	}
	.hb-toc-list .hb-toc-d3 button {
		padding-left: 1.4rem;
		font-size: 0.88rem;
	}
	.hb-toc-list .hb-toc-d4 button {
		padding-left: 2rem;
		font-size: 0.85rem;
	}
	.hb-toc-tier {
		font-size: 0.7rem;
		padding: 0.15em 0.5em;
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink-3);
		border: 1px solid var(--line-soft);
	}
	.hb-toc-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0% 0 0 / 0.5);
		border: none;
		z-index: 45;
		cursor: pointer;
	}
</style>
