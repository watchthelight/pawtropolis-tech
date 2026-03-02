<script lang="ts">
	let { title, subtitle, badge }: {
		title: string;
		subtitle?: string;
		badge?: number;
	} = $props();
</script>

<header class="mb-[var(--space-section)]">
	<div class="flex items-center gap-2">
		<h1 class="text-xl font-semibold text-[var(--text-primary)]" style="letter-spacing: -0.01em">{title}</h1>
		{#if badge != null}
			<span class="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
				{badge}
			</span>
		{/if}
	</div>
	{#if subtitle}
		<p class="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</p>
	{/if}
</header>
