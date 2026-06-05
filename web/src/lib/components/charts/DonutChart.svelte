<script lang="ts">
	import { onMount } from 'svelte';
	import { arc, pie } from 'd3-shape';
	import gsap from 'gsap';
	import { prefersReducedMotion } from '$lib/motion';

	interface Segment {
		label: string;
		value: number;
		color: string;
	}

	let {
		segments,
		size = 180,
		strokeWidth = 28
	}: { segments: Segment[]; size?: number; strokeWidth?: number } = $props();

	const total = $derived(segments.reduce((s, seg) => s + seg.value, 0));
	const radius = $derived(size / 2);
	const innerRadius = $derived(radius - strokeWidth);

	const pieGen = pie<Segment>()
		.value((d) => d.value)
		.sort(null)
		.padAngle(0.03);

	const arcGen = $derived(
		arc<{ startAngle: number; endAngle: number }>()
			.innerRadius(innerRadius)
			.outerRadius(radius)
			.cornerRadius(2)
	);

	const arcs = $derived(pieGen(segments.filter((s) => s.value > 0)));

	let pathEls: SVGPathElement[] = [];
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		if (prefersReducedMotion()) return;
		pathEls.forEach((el, i) => {
			if (!el) return;
			const length = el.getTotalLength();
			gsap.fromTo(
				el,
				{ strokeDasharray: `${length}`, strokeDashoffset: length },
				{
					strokeDashoffset: 0,
					duration: 0.8,
					delay: i * 0.08,
					ease: 'power2.out'
				}
			);
		});
	});
</script>

<div class="donut-container">
	<svg
		width={size}
		height={size}
		viewBox="{-radius} {-radius} {size} {size}"
		class="donut-svg"
	>
		{#each arcs as a, i}
			<path
				bind:this={pathEls[i]}
				d={arcGen(a) ?? ''}
				fill={a.data.color}
				opacity={mounted || prefersReducedMotion() ? 1 : 0}
			/>
		{/each}

		<!-- Center label -->
		<text class="center-value" text-anchor="middle" dominant-baseline="central" dy="-6">
			{total}
		</text>
		<text class="center-label" text-anchor="middle" dominant-baseline="central" dy="14">
			DECISIONS
		</text>
	</svg>

	<!-- Legend -->
	<div class="legend">
		{#each segments.filter((s) => s.value > 0) as seg}
			<div class="legend-item">
				<span class="legend-dot" style="background:{seg.color}"></span>
				<span class="legend-label">{seg.label}</span>
				<span class="legend-value">{seg.value}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.donut-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.donut-svg {
		filter: drop-shadow(0 0 8px oklch(72% 0.18 var(--hue) / 0.2));
	}

	.center-value {

		font-size: 1.8rem;
		font-weight: 700;
		fill: var(--ink);
	}

	.center-label {

		font-size: 0.5rem;
		letter-spacing: 0.15em;
		fill: var(--ink-2);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		justify-content: center;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;

		font-size: 0.7rem;
	}

	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.legend-label {
		color: var(--ink-2);
	}

	.legend-value {
		color: var(--ink);
		font-weight: 600;
	}
</style>
