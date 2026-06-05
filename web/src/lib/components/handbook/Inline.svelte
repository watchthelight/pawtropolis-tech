<script lang="ts">
	import type { Token } from 'marked';
	import Self from './Inline.svelte';
	import { rewriteHandbookHref } from '$lib/handbook-shared';

	type Props = { tokens: Token[] | undefined };
	let { tokens }: Props = $props();
</script>

{#if tokens}
	{#each tokens as t, i (i)}
		{#if t.type === 'text'}
			{#if 'tokens' in t && Array.isArray((t as any).tokens) && (t as any).tokens.length > 0}
				<Self tokens={(t as any).tokens} />
			{:else}
				{(t as any).text}
			{/if}
		{:else if t.type === 'strong'}
			<strong><Self tokens={(t as any).tokens} /></strong>
		{:else if t.type === 'em'}
			<em><Self tokens={(t as any).tokens} /></em>
		{:else if t.type === 'codespan'}
			<code class="inline-code">{(t as any).text}</code>
		{:else if t.type === 'del'}
			<del><Self tokens={(t as any).tokens} /></del>
		{:else if t.type === 'link'}
			<a
				href={rewriteHandbookHref((t as any).href)}
				title={(t as any).title ?? undefined}
				target={(t as any).href?.startsWith('http') ? '_blank' : undefined}
				rel={(t as any).href?.startsWith('http') ? 'noopener noreferrer' : undefined}
			>
				<Self tokens={(t as any).tokens} />
			</a>
		{:else if t.type === 'image'}
			<img src={(t as any).href} alt={(t as any).text ?? ''} loading="lazy" />
		{:else if t.type === 'br'}
			<br />
		{:else if t.type === 'html'}
			<!-- Raw HTML in markdown is intentionally skipped; the docs only use it for
				 <details>/<summary> which renders fine as plain children otherwise. -->
		{:else if t.type === 'space'}
			&nbsp;
		{:else}
			{(t as any).raw ?? ''}
		{/if}
	{/each}
{/if}

<style>
	.inline-code {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.92em;
		padding: 0.1em 0.4em;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		color: var(--sage);
		border: 1px solid var(--line-soft);
	}
	a {
		color: var(--sage);
		text-decoration: underline;
		text-underline-offset: 2px;
		text-decoration-thickness: 1px;
	}
	a:hover {
		color: var(--sage-bright);
	}
	img {
		max-width: 100%;
		border-radius: var(--radius-sm);
	}
</style>
