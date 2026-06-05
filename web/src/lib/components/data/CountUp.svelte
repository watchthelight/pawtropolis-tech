<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from '$lib/motion';

	let { value = 0, duration = 850 }: { value?: number; duration?: number } = $props();

	const fmt = new Intl.NumberFormat();
	let display = $state(0);

	onMount(() => {
		// Guarantee the final value lands even if rAF never fires (hidden tab,
		// reduced motion). The animation below overrides this when it runs.
		if (prefersReducedMotion()) {
			display = value;
			return;
		}
		const to = value;
		const ease = (t: number) => 1 - Math.pow(1 - t, 3);
		let raf = 0;
		let start: number | null = null;
		function step(ts: number) {
			if (start === null) start = ts;
			const t = Math.min(1, (ts - start) / duration);
			display = Math.round(to * ease(t));
			if (t < 1) raf = requestAnimationFrame(step);
			else display = to;
		}
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	// If the value updates after mount, reflect it (no re-animation needed).
	$effect(() => {
		if (prefersReducedMotion()) display = value;
	});
</script>

<span class="countup">{fmt.format(display)}</span>

<style>
	.countup {
		font-family: var(--font-head);
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.1;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
</style>
