<script lang="ts">
	import type { Tokens } from 'marked';
	import Inline from './Inline.svelte';
	import Self from './Lists.svelte';
	import Paragraph from './Paragraph.svelte';
	import CodeBlock from './CodeBlock.svelte';

	type Props = { token: Tokens.List };
	let { token }: Props = $props();
</script>

{#if token.ordered}
	<ol class="hb-list hb-list-ol" start={typeof token.start === 'number' ? token.start : 1}>
		{#each token.items as item, i (i)}
			<li>
				{#each item.tokens as child, j (j)}
					{#if child.type === 'text' && 'tokens' in child}
						<Inline tokens={(child as any).tokens} />
					{:else if child.type === 'paragraph'}
						<Paragraph token={child as Tokens.Paragraph} />
					{:else if child.type === 'list'}
						<Self token={child as Tokens.List} />
					{:else if child.type === 'code'}
						<CodeBlock token={child as Tokens.Code} />
					{:else}
						<Inline tokens={(child as any).tokens ?? []} />
					{/if}
				{/each}
			</li>
		{/each}
	</ol>
{:else}
	<ul class="hb-list hb-list-ul">
		{#each token.items as item, i (i)}
			<li>
				{#each item.tokens as child, j (j)}
					{#if child.type === 'text' && 'tokens' in child}
						<Inline tokens={(child as any).tokens} />
					{:else if child.type === 'paragraph'}
						<Paragraph token={child as Tokens.Paragraph} />
					{:else if child.type === 'list'}
						<Self token={child as Tokens.List} />
					{:else if child.type === 'code'}
						<CodeBlock token={child as Tokens.Code} />
					{:else}
						<Inline tokens={(child as any).tokens ?? []} />
					{/if}
				{/each}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.hb-list {
		margin: 0.6em 0 0.8em;
		padding-left: 1.4em;
		line-height: 1.65;
		color: var(--ink-2);
		font-size: 0.97rem;
	}
	.hb-list li {
		margin: 0.25em 0;
	}
	.hb-list-ul {
		list-style: none;
		padding-left: 0;
	}
	.hb-list-ul > li {
		position: relative;
		padding-left: 1.4em;
	}
	.hb-list-ul > li::before {
		content: '';
		position: absolute;
		left: 0.4em;
		top: 0.75em;
		width: 0.35em;
		height: 0.35em;
		background: var(--sage-deep);
		border-radius: 1px;
		transform: rotate(45deg);
	}
	.hb-list-ol {
		list-style: decimal;
	}
	.hb-list-ol > li::marker {
		color: var(--sage-deep);
		font-weight: 600;
	}
</style>
