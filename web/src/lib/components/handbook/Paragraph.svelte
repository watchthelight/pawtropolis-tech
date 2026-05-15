<script lang="ts">
	import type { Tokens } from 'marked';
	import Inline from './Inline.svelte';

	type Props = { token: Tokens.Paragraph };
	let { token }: Props = $props();
</script>

<p class="hb-p"><Inline tokens={token.tokens} /></p>

<style>
	.hb-p {
		margin: 0.6em 0;
		line-height: 1.7;
		color: var(--text-secondary);
		font-size: 0.97rem;
	}
</style>
