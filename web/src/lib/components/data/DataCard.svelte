<script lang="ts">
	import type { Snippet } from 'svelte';
	import { prefersReducedMotion } from '$lib/motion';

	let { selected = false, clickable = false, accent = false, elevation = 'md', children, onclick }: {
		selected?: boolean;
		clickable?: boolean;
		accent?: boolean;
		elevation?: 'sm' | 'md' | 'lg';
		children: Snippet;
		onclick?: () => void;
	} = $props();

	const shadowVar = {
		sm: 'var(--shadow-sm)',
		md: 'var(--shadow-md)',
		lg: 'var(--shadow-lg)'
	} as const;

	const hoverShadowVar = {
		sm: 'var(--shadow-md), var(--glow-accent)',
		md: 'var(--shadow-lg), var(--glow-accent)',
		lg: 'var(--shadow-lg), var(--glow-accent)'
	} as const;

	const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="card"
	class:card-accent={accent}
	class:card-selected={selected}
	class:cursor-pointer={clickable}
	style:box-shadow={shadowVar[elevation]}
	style:transition-duration="var(--duration-fast)"
	onmouseenter={canHover ? (e) => {
		const el = e.currentTarget;
		el.style.boxShadow = hoverShadowVar[elevation];
		if (!prefersReducedMotion()) el.style.transform = 'translateY(-2px)';
	} : undefined}
	onmouseleave={canHover ? (e) => {
		const el = e.currentTarget;
		el.style.boxShadow = shadowVar[elevation];
		if (!prefersReducedMotion()) el.style.transform = 'translateY(0)';
	} : undefined}
	onclick={() => { if (clickable && onclick) onclick(); }}
	onkeydown={(e) => { if (clickable && onclick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onclick(); } }}
	role={clickable ? 'button' : undefined}
	tabindex={clickable ? 0 : undefined}
>
	{@render children()}
</div>

<style>
	.card {
		background: var(--surface);
		background-image: linear-gradient(180deg, oklch(100% 0 0 / 0.03) 0%, transparent 50%);
		border: 1px solid color-mix(in oklch, var(--accent) 15%, var(--border-holdfast));
		border-radius: var(--radius-md);
		padding: var(--space-card);
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.card-accent {
		background: var(--accent-glow-bg);
		border-top: 3px solid var(--accent);
		border-color: color-mix(in oklch, var(--accent) 30%, var(--border-holdfast));
		border-top-color: var(--accent);
	}

	.card-accent {
		animation: accent-breathe 3s ease-in-out infinite;
	}

	@keyframes accent-breathe {
		0%, 100% { border-top-color: var(--accent); }
		50% { border-top-color: var(--accent-dim); }
	}

	.card-selected {
		border-left: 4px solid var(--accent);
		box-shadow: var(--glow-accent);
	}
</style>
