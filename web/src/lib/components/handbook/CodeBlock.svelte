<script lang="ts">
	import type { Tokens } from 'marked';

	type Props = { token: Tokens.Code };
	let { token }: Props = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(token.text);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// clipboard may be blocked in private contexts; user can still select manually.
		}
	}
</script>

<figure class="hb-code">
	<div class="hb-code-bar">
		<span class="hb-code-lang">{token.lang || 'text'}</span>
		<button class="hb-code-copy" type="button" onclick={copy} aria-label="Copy code">
			{copied ? 'Copied' : 'Copy'}
		</button>
	</div>
	<pre><code>{token.text}</code></pre>
</figure>

<style>
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
		justify-content: space-between;
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
	.hb-code-copy {
		font-size: 0.78rem;
		font-family: inherit;
		padding: 0.25em 0.7em;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--ink-2);
		cursor: pointer;
		min-height: 32px;
	}
	.hb-code-copy:hover {
		color: var(--ink);
		border-color: var(--sage-deep);
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
