<script lang="ts">
	import type { Snippet } from 'svelte';

	let { selected = false, clickable = false, elevation = 'md', children, onclick }: {
		selected?: boolean;
		clickable?: boolean;
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="rounded-lg border bg-[var(--surface)] p-4 transition-shadow"
	class:cursor-pointer={clickable}
	class:border-l-4={selected}
	style:box-shadow={shadowVar[elevation]}
	style:border-color={selected ? 'var(--accent)' : 'var(--border)'}
	style:transition-duration="var(--duration-fast)"
	onmouseenter={(e) => { if (clickable) e.currentTarget.style.boxShadow = hoverShadowVar[elevation]; }}
	onmouseleave={(e) => { if (clickable) e.currentTarget.style.boxShadow = shadowVar[elevation]; }}
	onclick={() => { if (clickable && onclick) onclick(); }}
	onkeydown={(e) => { if (clickable && onclick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onclick(); } }}
	role={clickable ? 'button' : undefined}
	tabindex={clickable ? 0 : undefined}
>
	{@render children()}
</div>
