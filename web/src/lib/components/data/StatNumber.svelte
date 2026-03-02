<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';

	let { value, label, trend }: {
		value: number;
		label: string;
		trend?: 'up' | 'down' | 'neutral';
	} = $props();

	const formatter = new Intl.NumberFormat();
	let reduced = prefersReducedMotion();

	// Split formatted number into characters for odometer effect
	let digits = $derived(formatter.format(value).split(''));

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
		<span class="odometer text-2xl font-bold text-[var(--text-primary)]">
			{#each digits as char, i (i)}
				{#if char.match(/\d/)}
					<span class="digit-wrapper">
						<span
							class="digit-column"
							class:no-transition={reduced}
							style:transform="translateY(-{Number(char) * 1.2}em)"
						>
							{#each Array(10) as _, n}
								<span class="digit">{n}</span>
							{/each}
						</span>
					</span>
				{:else}
					<span class="separator">{char}</span>
				{/if}
			{/each}
		</span>
		{#if trend}
			<span class="text-sm font-medium" style:color={trendColor[trend]}>
				{trendSymbol[trend]}
			</span>
		{/if}
	</div>
	<span class="text-sm text-[var(--text-secondary)]">{label}</span>
</div>

<style>
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
