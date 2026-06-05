<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';

	let { value, label, suffix, trend, invertColors = false }: {
		value: number;
		label: string;
		suffix?: string;
		trend?: 'up' | 'down' | 'neutral';
		invertColors?: boolean;
	} = $props();

	const formatter = new Intl.NumberFormat();
	let reduced = prefersReducedMotion();

	// Split formatted number into characters for rolling effect.
	// Key from right so digit positions stay stable across boundary
	// transitions (e.g. 999 → 1,000 — rightmost digits keep their keys).
	let digits = $derived(
		formatter.format(value).split('').map((char, i, arr) => ({
			char,
			key: arr.length - 1 - i
		}))
	);

	const defaultTrendColor: Record<string, string> = {
		up: 'var(--good)',
		down: 'var(--danger)',
		neutral: 'var(--ink-2)'
	};

	const invertedTrendColor: Record<string, string> = {
		up: 'var(--danger)',
		down: 'var(--good)',
		neutral: 'var(--ink-2)'
	};

	let trendColor = $derived(invertColors ? invertedTrendColor : defaultTrendColor);

	const trendSymbol: Record<string, string> = {
		up: '\u2191',
		down: '\u2193',
		neutral: '\u2014'
	};
</script>

<div class="flex flex-col">
	<div class="flex items-baseline gap-1.5">
		<span class="roller stat-value">
			{#each digits as d (d.key)}
				{#if d.char.match(/\d/)}
					<span class="reel">
						<span
							class="reel-strip"
							class:no-motion={reduced}
							style:transform="translateY(-{Number(d.char) * 1.2}em)"
						>
							{#each Array(10) as _, n}
								<span class="reel-digit">{n}</span>
							{/each}
						</span>
					</span>
				{:else}
					<span class="sep">{d.char}</span>
				{/if}
			{/each}
			{#if suffix}<span class="suffix">{suffix}</span>{/if}
		</span>
		{#if trend}
			<span class="text-sm font-medium" style:color={trendColor[trend]}>
				{trendSymbol[trend]}
			</span>
		{/if}
	</div>
	{#if label}
		<span class="stat-label">{label}</span>
	{/if}
</div>

<style>
	.stat-value {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 700;
		color: var(--ink);
		line-height: 1.1;
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--sage-muted);
		margin-top: 0.15rem;
	}

	.roller {
		display: inline-flex;
		align-items: baseline;
	}

	.reel {
		display: inline-block;
		height: 1.2em;
		overflow: hidden;
		line-height: 1.2;
		/* Fade edges for depth: top and bottom of the reel window are slightly masked */
		mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
	}

	.reel-strip {
		display: flex;
		flex-direction: column;
		transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
		will-change: transform;
	}

	.reel-strip.no-motion {
		transition: none;
	}

	.reel-digit {
		display: block;
		height: 1.2em;
		line-height: 1.2;
	}

	.sep {
		line-height: 1.2;
		opacity: 0.4;
	}

	.suffix {
		font-size: 0.7em;
		font-weight: 600;
		color: var(--ink-2);
		margin-left: 0.1em;
		line-height: 1.2;
	}
</style>
