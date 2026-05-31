<script lang="ts">
	let { data }: { data: { html: string } } = $props();
</script>

<svelte:head>
	<title>Changelog - Pawtropolis</title>
	<meta name="description" content="Every change to Pawtropolis Tech, newest first." />
</svelte:head>

<main class="changelog">
	<header class="cl-head">
		<a class="cl-back" href="/">&larr; Pawtropolis</a>
		<h1 class="cl-title">Changelog</h1>
		<p class="cl-sub">Every change to the bot and dashboard, newest first.</p>
	</header>

	<!-- Content is the project's own committed CHANGELOG.md, inlined at build time. -->
	<article class="prose">
		{@html data.html}
	</article>
</main>

<style>
	.changelog {
		max-width: 52rem;
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 4rem) clamp(1.1rem, 4vw, 2rem) 6rem;
		color: var(--text-secondary);
	}

	.cl-head {
		margin-bottom: 2.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.cl-back {
		display: inline-block;
		margin-bottom: 1.25rem;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.15s ease;
	}
	.cl-back:hover {
		color: var(--accent);
	}
	.cl-title {
		margin: 0;
		font-size: clamp(2rem, 6vw, 2.75rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-primary);
	}
	.cl-sub {
		margin: 0.5rem 0 0;
		color: var(--text-tertiary);
		font-size: 0.95rem;
	}

	/* ---- Rendered markdown ---- */
	.prose {
		font-size: 0.95rem;
		line-height: 1.7;
	}

	.prose :global(h1) {
		margin: 3rem 0 1rem;
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.01em;
	}
	.prose :global(h2) {
		margin: 3rem 0 1rem;
		padding-top: 1.75rem;
		border-top: 1px solid var(--border);
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.01em;
		scroll-margin-top: 1.5rem;
	}
	.prose :global(h2:first-of-type) {
		border-top: none;
		padding-top: 0;
	}
	.prose :global(h3) {
		margin: 2rem 0 0.75rem;
		font-size: 1.05rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
		scroll-margin-top: 1.5rem;
	}
	.prose :global(h4) {
		margin: 1.5rem 0 0.5rem;
		font-size: 0.95rem;
		font-weight: 650;
		color: var(--text-primary);
	}

	.prose :global(p) {
		margin: 0.9rem 0;
	}
	.prose :global(a) {
		color: var(--accent);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: border-color 0.15s ease;
	}
	.prose :global(a:hover) {
		border-bottom-color: var(--accent);
	}

	.prose :global(ul),
	.prose :global(ol) {
		margin: 0.9rem 0;
		padding-left: 1.4rem;
	}
	.prose :global(li) {
		margin: 0.4rem 0;
	}
	.prose :global(li::marker) {
		color: var(--text-muted);
	}

	.prose :global(strong) {
		color: var(--text-primary);
		font-weight: 650;
	}

	.prose :global(code) {
		font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
		font-size: 0.86em;
		padding: 0.12em 0.4em;
		border-radius: 5px;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text-primary);
	}
	.prose :global(pre) {
		margin: 1rem 0;
		padding: 1rem 1.1rem;
		overflow-x: auto;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.prose :global(pre code) {
		padding: 0;
		border: none;
		background: none;
	}

	.prose :global(hr) {
		margin: 2.5rem 0;
		border: none;
		border-top: 1px solid var(--border);
	}

	.prose :global(blockquote) {
		margin: 1rem 0;
		padding: 0.5rem 1rem;
		border-left: 3px solid var(--accent-dim);
		color: var(--text-tertiary);
	}

	.prose :global(table) {
		width: 100%;
		margin: 1rem 0;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	.prose :global(th),
	.prose :global(td) {
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border);
		text-align: left;
	}
	.prose :global(th) {
		background: var(--surface-raised);
		color: var(--text-primary);
	}
</style>
