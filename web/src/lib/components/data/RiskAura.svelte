<script lang="ts">
	import type { EvidenceEntry } from '$lib/server/queries/reviews';
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
		tier === 'high' ? 'var(--danger)' : tier === 'elevated' ? 'var(--warn)' : 'var(--good)'
	);

	const ariaLabel = $derived(
		tier === 'safe'
			? 'Low risk — all clear'
			: tier === 'elevated'
				? `Elevated risk — ${riskScore}%`
				: `High risk — ${reason ?? 'flagged'}`
	);

	const hasEvidence = $derived(
		evidence && (evidence.hard.length > 0 || evidence.soft.length > 0 || evidence.safe.length > 0)
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
			{#if reason && reason !== 'none'}
				<span class="risk-reason" style:color={tierColor}>{reason.replace(/_/g, ' ')}</span>
			{/if}
		</span>
	{:else}
		<div
			class="risk-aura-expanded"
			class:risk-glow-elevated={tier === 'elevated'}
			class:risk-glow-high={tier === 'high'}
			aria-label={ariaLabel}
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
						{#each evidence.safe as entry}
							<span class="evidence-tag evidence-safe">{entry.tag}: {Math.round(entry.p * 100)}%</span>
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

	.risk-reason {
		font-size: 0.6rem;
		font-weight: 500;
		text-transform: capitalize;
		opacity: 0.8;
	}

	/* ── Expanded variant ───────────────────────────────────── */
	.risk-aura-expanded {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}

	.risk-glow-elevated {
		border-left: 3px solid oklch(70% 0.15 85);
	}

	.risk-glow-high {
		border-left: 3px solid oklch(60% 0.15 25);
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
		color: var(--ink-2);
	}

	/* ── Evidence section ───────────────────────────────────── */
	.risk-evidence {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line);
	}

	.evidence-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
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
		color: var(--danger);
		background: oklch(60% 0.05 25 / 0.15);
	}

	.evidence-soft {
		color: var(--warn);
		background: oklch(70% 0.05 85 / 0.15);
	}

	.evidence-safe {
		color: var(--good);
		background: oklch(65% 0.05 145 / 0.15);
	}
</style>
