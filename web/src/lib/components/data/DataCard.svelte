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
		sm: 'var(--shadow-md)',
		md: 'var(--shadow-lg)',
		lg: 'var(--shadow-lg)'
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
		el.style.borderColor = 'var(--border-holdfast)';
		if (!prefersReducedMotion()) el.style.transform = 'translateY(-2px)';
	} : undefined}
	onmouseleave={canHover ? (e) => {
		const el = e.currentTarget;
		el.style.boxShadow = shadowVar[elevation];
		el.style.borderColor = '';
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
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.card-accent {
		background: var(--accent-glow-bg);
		border: 1px solid oklch(50% 0.04 var(--hue) / 0.3);
		border-top: 2px solid var(--accent);
	}

	.card-selected {
		border-left: 4px solid var(--accent);
	}
</style>
