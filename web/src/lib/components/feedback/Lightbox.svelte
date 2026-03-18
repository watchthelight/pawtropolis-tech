<script lang="ts">
	import { fade } from 'svelte/transition';
	import { getLightboxUrl, closeLightbox } from '$lib/stores/lightbox.svelte';

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') closeLightbox();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if getLightboxUrl()}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="lightbox" onclick={closeLightbox} transition:fade={{ duration: 150 }}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<img
			src={getLightboxUrl()}
			alt="Full resolution"
			class="lightbox-img"
			onclick={(e) => e.stopPropagation()}
		/>
	</div>
{/if}

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: oklch(5% 0 0 / 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.lightbox-img {
		max-width: 90vw;
		max-height: 90vh;
		border-radius: var(--radius-md);
		box-shadow: 0 0 60px oklch(0% 0 0 / 0.5);
		cursor: default;
		object-fit: contain;
	}
</style>
