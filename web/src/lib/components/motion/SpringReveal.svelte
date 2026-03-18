<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import gsap from 'gsap';
	import { SPRINGS, prefersReducedMotion } from '$lib/motion';

	let { delay = 0, stagger = 0, y = 20, children }: {
		delay?: number;
		stagger?: number;
		y?: number;
		children: Snippet;
	} = $props();

	let container: HTMLElement;
	let tl: gsap.core.Timeline | null = null;

	onMount(() => {
		if (prefersReducedMotion() || !container) return;

		tl = gsap.timeline();
		tl.from(container, {
			opacity: 0,
			y: 10,
			duration: 0.3,
			ease: 'power2.out',
			delay: delay / 1000
		});
	});

	onDestroy(() => {
		tl?.kill();
	});
</script>

<div bind:this={container}>
	{@render children()}
</div>
