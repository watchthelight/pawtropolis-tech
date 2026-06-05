<script lang="ts">
	import type { Tokens } from 'marked';
	import { onMount } from 'svelte';

	type Props = { token: Tokens.Code };
	let { token }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let failed = $state(false);

	let domId = `mmd-${Math.random().toString(36).slice(2)}`;

	onMount(async () => {
		try {
			const { default: mermaid } = await import('mermaid');
			mermaid.initialize({
				startOnLoad: false,
				theme: 'dark',
				securityLevel: 'strict',
				fontFamily: "'JetBrains Mono', ui-monospace, monospace"
			});
			const { svg } = await mermaid.render(domId, token.text);
			if (host) host.innerHTML = svg;
		} catch {
			failed = true;
		}
	});
</script>

{#if failed}
	<figure class="hb-code">
		<div class="hb-code-bar">
			<span class="hb-code-lang">mermaid</span>
		</div>
		<pre><code>{token.text}</code></pre>
	</figure>
{:else}
	<div class="hb-mermaid" bind:this={host} role="img" aria-label="Diagram"></div>
{/if}

<style>
	.hb-mermaid {
		margin: 0.8em 0 1em;
		padding: 1em;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--surface);
		overflow-x: auto;
		display: flex;
		justify-content: center;
	}
	.hb-mermaid :global(svg) {
		max-width: 100%;
		height: auto;
	}
	.hb-code {
		margin: 0.8em 0 1em;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--void);
		overflow: hidden;
	}
	.hb-code-bar {
		display: flex;
		align-items: center;
		padding: 0.4em 0.8em;
		background: var(--surface);
		border-bottom: 1px solid var(--line-soft);
		font-size: 0.78rem;
	}
	.hb-code-lang {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: var(--ink-3);
		text-transform: lowercase;
		letter-spacing: 0.04em;
	}
	pre {
		margin: 0;
		padding: 1em;
		overflow-x: auto;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--ink);
		background: var(--void);
	}
</style>
