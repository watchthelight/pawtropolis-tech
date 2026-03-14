<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';

	let { value, label, trend, invertColors = false }: {
		value: number;
		label: string;
		trend?: 'up' | 'down' | 'neutral';
		invertColors?: boolean;
	} = $props();

	const formatter = new Intl.NumberFormat();
	let reduced = prefersReducedMotion();

	// Split formatted number into characters for odometer effect.
	// Key from right so digit positions stay stable across boundary
	// transitions (e.g. 999 → 1,000 — rightmost digits keep their keys).
	let digits = $derived(
		formatter.format(value).split('').map((char, i, arr) => ({
			char,
			key: arr.length - 1 - i // key from right: rightmost = 0, leftmost = len-1
		}))
	);

	const defaultTrendColor: Record<string, string> = {
		up: 'var(--status-success)',
		down: 'var(--status-danger)',
		neutral: 'var(--text-secondary)'
	};

	const invertedTrendColor: Record<string, string> = {
		up: 'var(--status-danger)',
		down: 'var(--status-success)',
		neutral: 'var(--text-secondary)'
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
		<span class="odometer stat-value">
			{#each digits as d (d.key)}
				{#if d.char.match(/\d/)}
					<span class="digit-wrapper">
						<span
							class="digit-column"
							class:no-transition={reduced}
							style:transform="translateY(-{Number(d.char) * 1.2}em)"
						>
							{#each Array(10) as _, n}
								<span class="digit">{n}</span>
							{/each}
						</span>
					</span>
				{:else}
					<span class="separator">{d.char}</span>
				{/if}
			{/each}
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
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.1;
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--accent-muted);
		margin-top: 0.15rem;
	}

	.odometer {
		display: inline-flex;
		align-items: baseline;
	}

	.digit-wrapper {
		display: inline-block;
		height: 1.2em;
		overflow: hidden;
		line-height: 1.2;
	}

	.digit-column {
		display: flex;
		flex-direction: column;
		transition: transform 0.4s var(--ease-spring);
	}

	.digit-column.no-transition {
		transition: none;
	}

	.digit {
		display: block;
		height: 1.2em;
		line-height: 1.2;
	}

	.separator {
		line-height: 1.2;
	}
</style>
