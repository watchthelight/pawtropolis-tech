<script lang="ts">
	import type { EvidenceEntry } from '$lib/server/queries/reviews';
	import { prefersReducedMotion } from '$lib/motion';

	let { riskScore, reason, evidence, variant = 'compact' }: {
		riskScore: number;
		reason?: string;
		evidence?: { hard: EvidenceEntry[]; soft: EvidenceEntry[]; safe: EvidenceEntry[] };
		variant?: 'compact' | 'expanded';
	} = $props();

	type RiskTier = 'safe' | 'elevated' | 'high';

	const tier: RiskTier = $derived(
		riskScore >= 50 ? 'high' : riskScore >= 20 ? 'elevated' : 'safe'
	);

	const tierLabel = $derived(
		tier === 'high' ? 'High risk' : tier === 'elevated' ? 'Elevated risk' : 'All clear'
	);

	const tierColor = $derived(
		tier === 'high' ? 'var(--status-danger)' : tier === 'elevated' ? 'var(--status-warning)' : 'var(--status-success)'
	);

	const ariaLabel = $derived(
		tier === 'safe'
			? 'Low risk — all clear'
			: tier === 'elevated'
				? `Elevated risk — ${riskScore}%`
				: `High risk — ${reason ?? 'flagged'}`
	);

	const reducedMotion = $derived(prefersReducedMotion());

	const glowIntensity = $derived(riskScore / 100);

	const hasEvidence = $derived(
		evidence && (evidence.hard.length > 0 || evidence.soft.length > 0)
	);
</script>

{#if riskScore > 0}
	{#if variant === 'compact'}
		<span class="risk-aura-compact" role="img" aria-label={ariaLabel} title={ariaLabel}>
			<svg class="risk-shape" width="12" height="12" viewBox="0 0 12 12" style:color={tierColor}>
				{#if tier === 'safe'}
					<circle cx="6" cy="6" r="5" fill="currentColor" />
				{:else if tier === 'elevated'}
					<rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" transform="rotate(45 6 6)" />
				{:else}
					<polygon points="6,1 11,11 1,11" fill="currentColor" />
				{/if}
			</svg>
			<span class="risk-score" style:color={tierColor}>{riskScore}%</span>
		</span>
	{:else}
		<div
			class="risk-aura-expanded"
			class:risk-glow-elevated={tier === 'elevated'}
			class:risk-glow-high={tier === 'high'}
			class:risk-no-animate={reducedMotion}
			aria-label={ariaLabel}
			style:--glow-intensity={glowIntensity}
		>
			<div class="risk-header">
				<svg class="risk-shape-lg" width="16" height="16" viewBox="0 0 12 12" style:color={tierColor}>
					{#if tier === 'safe'}
						<circle cx="6" cy="6" r="5" fill="currentColor" />
					{:else if tier === 'elevated'}
						<rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" transform="rotate(45 6 6)" />
					{:else}
						<polygon points="6,1 11,11 1,11" fill="currentColor" />
					{/if}
				</svg>
				<span class="risk-value" style:color={tierColor}>{riskScore}%</span>
				<span class="risk-label">{tierLabel}</span>
			</div>

			{#if hasEvidence}
				<div class="risk-evidence">
					<div class="evidence-label">Evidence</div>
					{#if evidence}
						{#each evidence.hard as entry}
							<span class="evidence-tag evidence-hard">{entry.tag}: {Math.round(entry.p * 100)}%</span>
						{/each}
						{#each evidence.soft as entry}
							<span class="evidence-tag evidence-soft">{entry.tag}: {Math.round(entry.p * 100)}%</span>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{/if}

<style>
	/* ── Compact variant ────────────────────────────────────── */
	.risk-aura-compact {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.risk-shape {
		flex-shrink: 0;
	}

	.risk-score {
		font-weight: 600;
		font-size: 0.7rem;
	}

	/* ── Expanded variant ───────────────────────────────────── */
	.risk-aura-expanded {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
	}

	.risk-glow-elevated {
		animation: glow-elevated 2s ease-in-out infinite;
	}

	.risk-glow-high {
		animation: glow-high 1.5s ease-in-out infinite;
	}

	.risk-no-animate.risk-glow-elevated {
		animation: none;
		box-shadow: 0 0 12px oklch(70% 0.15 85 / calc(var(--glow-intensity) * 0.7));
	}

	.risk-no-animate.risk-glow-high {
		animation: none;
		box-shadow: 0 0 16px oklch(60% 0.15 25 / calc(var(--glow-intensity) * 0.7));
	}

	@keyframes glow-elevated {
		0%, 100% { box-shadow: 0 0 8px oklch(70% 0.15 85 / calc(var(--glow-intensity) * 0.5)); }
		50% { box-shadow: 0 0 16px oklch(70% 0.15 85 / var(--glow-intensity)); }
	}

	@keyframes glow-high {
		0%, 100% { box-shadow: 0 0 12px oklch(60% 0.15 25 / calc(var(--glow-intensity) * 0.5)); }
		50% { box-shadow: 0 0 20px oklch(60% 0.15 25 / var(--glow-intensity)); }
	}

	.risk-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.risk-shape-lg {
		flex-shrink: 0;
	}

	.risk-value {
		font-weight: 700;
		font-size: 0.9rem;
	}

	.risk-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	/* ── Evidence section ───────────────────────────────────── */
	.risk-evidence {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-holdfast);
	}

	.evidence-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin-bottom: 0.375rem;
	}

	.evidence-tag {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		margin-right: 0.25rem;
		margin-bottom: 0.25rem;
	}

	.evidence-hard {
		color: var(--status-danger);
		background: oklch(60% 0.05 25 / 0.15);
	}

	.evidence-soft {
		color: var(--status-warning);
		background: oklch(70% 0.05 85 / 0.15);
	}
</style>
