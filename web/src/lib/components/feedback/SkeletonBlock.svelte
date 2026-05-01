<script lang="ts">
	let { width = '100%', height = '1rem', radius = '6px' }: { width?: string; height?: string; radius?: string } = $props();
</script>

<span class="skel" style:width style:height style:border-radius={radius} aria-hidden="true"></span>

<style>
	.skel {
		display: inline-block;
		background: linear-gradient(
			90deg,
			oklch(20% 0.01 var(--hue, 330) / 0.4) 0%,
			oklch(28% 0.01 var(--hue, 330) / 0.6) 50%,
			oklch(20% 0.01 var(--hue, 330) / 0.4) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	@keyframes shimmer {
		0%   { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.skel { animation: none; }
	}
</style>
