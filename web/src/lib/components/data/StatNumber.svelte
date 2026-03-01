<script lang="ts">
	import { onDestroy } from 'svelte';
	import gsap from 'gsap';
	import { DURATIONS, EASINGS, prefersReducedMotion } from '$lib/motion';

	let { value, label, trend }: {
		value: number;
		label: string;
		trend?: 'up' | 'down' | 'neutral';
	} = $props();

	let displayValue = $state(value);
	let tweenTarget = { val: value };
	let activeTween: gsap.core.Tween | null = null;

	const formatter = new Intl.NumberFormat();

	$effect(() => {
		if (prefersReducedMotion()) {
			displayValue = value;
			return;
		}

		activeTween?.kill();
		tweenTarget.val = displayValue;
		activeTween = gsap.to(tweenTarget, {
			val: value,
			duration: DURATIONS.COUNTER / 1000,
			ease: EASINGS.standard,
			onUpdate: () => {
				displayValue = Math.round(tweenTarget.val);
			}
		});
	});

	onDestroy(() => {
		activeTween?.kill();
	});

	const trendColor: Record<string, string> = {
		up: 'var(--status-success)',
		down: 'var(--status-danger)',
		neutral: 'var(--text-secondary)'
	};

	const trendSymbol: Record<string, string> = {
		up: '\u2191',
		down: '\u2193',
		neutral: '\u2014'
	};
</script>

<div class="flex flex-col">
	<div class="flex items-baseline gap-1.5">
		<span class="text-2xl font-bold text-[var(--text-primary)]">
			{formatter.format(displayValue)}
		</span>
		{#if trend}
			<span class="text-sm font-medium" style:color={trendColor[trend]}>
				{trendSymbol[trend]}
			</span>
		{/if}
	</div>
	<span class="text-sm text-[var(--text-secondary)]">{label}</span>
</div>
