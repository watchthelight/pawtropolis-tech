<script lang="ts">
	import type { Token, Tokens } from 'marked';
	import type { DecoratedToken, CommandSectionToken, SectionToken } from '$lib/server/handbook/decorator';
	import Heading from './Heading.svelte';
	import Paragraph from './Paragraph.svelte';
	import Lists from './Lists.svelte';
	import Table from './Table.svelte';
	import CodeBlock from './CodeBlock.svelte';
	import Blockquote from './Blockquote.svelte';
	import CommandSection from './CommandSection.svelte';
	import SectionBlock from './SectionBlock.svelte';

	type Props = { token: DecoratedToken };
	let { token }: Props = $props();
</script>

{#if token.type === 'command_section'}
	<CommandSection token={token as CommandSectionToken} />
{:else if token.type === 'section'}
	<SectionBlock token={token as SectionToken} />
{:else if token.type === 'heading'}
	<Heading token={token as Tokens.Heading & { headingSlug?: string }} />
{:else if token.type === 'paragraph'}
	<Paragraph token={token as Tokens.Paragraph} />
{:else if token.type === 'list'}
	<Lists token={token as Tokens.List} />
{:else if token.type === 'table'}
	<Table token={token as Tokens.Table} />
{:else if token.type === 'code'}
	<CodeBlock token={token as Tokens.Code} />
{:else if token.type === 'blockquote'}
	<Blockquote token={token as Tokens.Blockquote} />
{:else if token.type === 'hr'}
	<hr class="hb-hr" />
{:else if token.type === 'space'}
	<span aria-hidden="true"></span>
{:else if token.type === 'html'}
	<!-- HTML in markdown intentionally skipped — docs don't rely on it for content. -->
{:else}
	<!-- Unknown token type: skip silently to keep rendering robust. -->
{/if}

<style>
	.hb-hr {
		border: none;
		margin: 1.8em 0;
		height: 1px;
		background: var(--border-holdfast);
	}
</style>
