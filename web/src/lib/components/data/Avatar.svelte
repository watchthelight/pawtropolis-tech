<script lang="ts">
	let {
		src,
		name,
		size = 48,
		rounded = 'sm',
		lazy = true,
		clickable = false,
		onclick,
		class: extraClass = ''
	}: {
		src: string | null | undefined;
		name: string;
		size?: number;
		rounded?: 'sm' | 'md' | 'full';
		lazy?: boolean;
		clickable?: boolean;
		onclick?: (e: MouseEvent) => void;
		class?: string;
	} = $props();

	let failed = $state(false);
	let resolved = $derived(src && !failed ? src : null);
	let initials = $derived(name?.charAt(0)?.toUpperCase() ?? '?');
	let radiusVar = $derived(
		rounded === 'full' ? '50%' : rounded === 'md' ? 'var(--radius-md)' : 'var(--radius-sm)'
	);
</script>

{#if resolved}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<img
		src={resolved}
		alt={name}
		width={size}
		height={size}
		loading={lazy ? 'lazy' : 'eager'}
		decoding="async"
		referrerpolicy="no-referrer"
		class="av {extraClass}"
		class:av-clickable={clickable}
		style:width="{size}px"
		style:height="{size}px"
		style:border-radius={radiusVar}
		onerror={() => { failed = true; }}
		{onclick}
	/>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="av av-ph {extraClass}"
		class:av-clickable={clickable}
		style:width="{size}px"
		style:height="{size}px"
		style:border-radius={radiusVar}
		style:font-size="{Math.round(size * 0.42)}px"
		aria-label={name}
		{onclick}
	>{initials}</div>
{/if}

<style>
	.av {
		object-fit: cover;
		flex-shrink: 0;
		display: block;
	}
	.av-ph {
		background: var(--sage-deep);
		color: var(--sage);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
	}
	.av-clickable {
		cursor: zoom-in;
		transition: transform 150ms var(--ease-smooth);
	}
	.av-clickable:hover {
		transform: scale(1.08);
	}
</style>
