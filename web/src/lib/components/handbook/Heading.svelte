<script lang="ts">
	import type { Tokens } from 'marked';
	import Inline from './Inline.svelte';

	type Props = {
		token: Tokens.Heading & { headingSlug?: string };
	};
	let { token }: Props = $props();
	let slug = $derived(token.headingSlug ?? '');
</script>

{#if token.depth === 1}
	<h1 id={slug} class="hb-h hb-h1"><Inline tokens={token.tokens} /></h1>
{:else if token.depth === 2}
	<h2 id={slug} class="hb-h hb-h2"><Inline tokens={token.tokens} /></h2>
{:else if token.depth === 3}
	<h3 id={slug} class="hb-h hb-h3"><Inline tokens={token.tokens} /></h3>
{:else if token.depth === 4}
	<h4 id={slug} class="hb-h hb-h4"><Inline tokens={token.tokens} /></h4>
{:else if token.depth === 5}
	<h5 id={slug} class="hb-h hb-h5"><Inline tokens={token.tokens} /></h5>
{:else}
	<h6 id={slug} class="hb-h hb-h6"><Inline tokens={token.tokens} /></h6>
{/if}

<style>
	.hb-h {
		font-family: 'Inter Variable', system-ui, sans-serif;
		font-weight: 700;
		color: var(--ink);
		letter-spacing: -0.01em;
		margin: 1.6em 0 0.5em;
		scroll-margin-top: 5rem;
	}
	.hb-h1 {
		font-size: clamp(1.75rem, 4vw, 2.4rem);
		margin-top: 0;
		border-bottom: 1px solid var(--line);
		padding-bottom: 0.3em;
	}
	.hb-h2 {
		font-size: clamp(1.4rem, 3vw, 1.8rem);
	}
	.hb-h3 {
		font-size: clamp(1.15rem, 2.5vw, 1.35rem);
		color: var(--sage);
	}
	.hb-h4 {
		font-size: 1.05rem;
		color: var(--ink);
	}
	.hb-h5,
	.hb-h6 {
		font-size: 0.95rem;
		color: var(--ink-2);
	}
</style>
