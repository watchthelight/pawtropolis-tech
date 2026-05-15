<script lang="ts">
	import type { Token, Tokens } from 'marked';
	import Inline from './Inline.svelte';
	import Paragraph from './Paragraph.svelte';
	import Callout from './Callout.svelte';

	type Props = { token: Tokens.Blockquote };
	let { token }: Props = $props();

	function detectVariant(raw: string): 'note' | 'warning' | 'tip' | 'info' | null {
		const stripped = raw.replace(/^>\s*/gm, '').trim().toLowerCase();
		if (stripped.startsWith('**warning')) return 'warning';
		if (stripped.startsWith('**tip')) return 'tip';
		if (stripped.startsWith('**note')) return 'note';
		if (stripped.startsWith('**info')) return 'info';
		return null;
	}
	let variant = $derived(detectVariant(token.raw ?? ''));
</script>

{#if variant}
	<Callout {variant}>
		{#each token.tokens as t, i (i)}
			{#if t.type === 'paragraph'}
				<Paragraph token={t as Tokens.Paragraph} />
			{:else if t.type === 'text'}
				<p><Inline tokens={(t as any).tokens ?? []} /></p>
			{/if}
		{/each}
	</Callout>
{:else}
	<blockquote class="hb-blockquote">
		{#each token.tokens as t, i (i)}
			{#if t.type === 'paragraph'}
				<Paragraph token={t as Tokens.Paragraph} />
			{:else if t.type === 'text'}
				<p><Inline tokens={(t as any).tokens ?? []} /></p>
			{/if}
		{/each}
	</blockquote>
{/if}

<style>
	.hb-blockquote {
		margin: 0.7em 0;
		padding: 0.4em 1em;
		border-left: 3px solid var(--accent-dim);
		background: var(--surface);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		color: var(--text-secondary);
	}
	.hb-blockquote :global(p) {
		color: var(--text-secondary);
	}
</style>
