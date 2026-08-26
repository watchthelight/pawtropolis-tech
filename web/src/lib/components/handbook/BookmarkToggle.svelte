<script lang="ts">
	import { page } from '$app/stores';
	import { isBookmarked, toggle } from '$lib/stores/handbookBookmarks.svelte';

	type Props = { headingSlug: string; label: string; compact?: boolean };
	let { headingSlug, label, compact = false }: Props = $props();

	let docSlug = $derived(($page.params as Record<string, string>)?.slug ?? '');
	let docTitle = $derived(($page.data as { title?: string })?.title ?? docSlug);
	let saved = $derived(docSlug !== '' && isBookmarked(docSlug, headingSlug));

	function onclick(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (!docSlug) return;
		toggle({ docSlug, headingSlug, label, docTitle });
	}
</script>

<button
	type="button"
	class="hb-bm"
	class:hb-bm-compact={compact}
	class:hb-bm-on={saved}
	aria-pressed={saved}
	aria-label={saved ? `Remove bookmark for ${label}` : `Bookmark ${label}`}
	title={saved ? 'Remove bookmark' : 'Bookmark this section'}
	{onclick}
>
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"
			fill={saved ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linejoin="round"
		/>
	</svg>
</button>

<style>
	.hb-bm {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		border: none;
		background: none;
		border-radius: var(--radius-sm);
		color: var(--ink-3);
		cursor: pointer;
		transition: color 0.15s ease, background 0.15s ease;
	}
	.hb-bm svg {
		width: 18px;
		height: 18px;
	}
	.hb-bm:hover {
		color: var(--sage);
		background: var(--hover-bg);
	}
	.hb-bm:focus-visible {
		outline: 2px solid var(--sage);
		outline-offset: -2px;
	}
	.hb-bm-on {
		color: var(--sage);
	}
	.hb-bm-compact {
		min-width: 32px;
		min-height: 32px;
	}
	.hb-bm-compact svg {
		width: 15px;
		height: 15px;
	}
</style>
