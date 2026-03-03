<script lang="ts">
	import type { ApplicationDetail } from '$lib/server/queries/reviews';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import RiskAura from '$lib/components/data/RiskAura.svelte';
	import ModmailViewer from '$lib/components/review/ModmailViewer.svelte';

	let { app, modmail = [] }: { app: ApplicationDetail; modmail?: ModmailThreadSummary[] } = $props();

	function relativeTime(ms: number | null): string {
		if (!ms) return '';
		const diff = Date.now() - ms;
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

<div class="app-detail">
	<!-- Applicant header -->
	<div class="applicant-header">
		<div class="applicant-avatar">
			{#if app.avatarUrl}
				<img src={app.avatarUrl} alt={app.applicantName} class="avatar-img" />
			{:else}
				<div class="avatar-placeholder">{app.applicantName.charAt(0).toUpperCase()}</div>
			{/if}
		</div>
		<div class="applicant-info">
			<h2 class="applicant-name">{app.applicantName}</h2>
			<p class="applicant-meta">
				<span class="user-id">{app.userId}</span>
				{#if app.submittedAt}
					<span class="separator">·</span>
					<span>Submitted {relativeTime(app.submittedAt)}</span>
				{/if}
			</p>
			{#if app.claimedBy}
				<p class="claimed-info">Claimed by {app.claimedBy}</p>
			{/if}
		</div>
		<RiskAura
			variant="expanded"
			riskScore={app.riskScore}
			reason={app.scan?.reason}
			evidence={app.scan ? { hard: app.scan.evidenceHard, soft: app.scan.evidenceSoft, safe: app.scan.evidenceSafe } : undefined}
		/>
	</div>

	<!-- Answers section -->
	<div class="answers-section">
		<div class="section-label">Responses</div>
		{#each app.answers as qa, i}
			<div class="qa-block">
				<div class="qa-question">{qa.question}</div>
				<div class="qa-answer">{qa.answer}</div>
			</div>
		{/each}

		{#if modmail.length > 0}
			<ModmailViewer threads={modmail} />
		{/if}
	</div>

	<!-- Action bar placeholder -->
	<div class="action-bar">
		<span class="action-placeholder">Decision actions coming soon</span>
	</div>
</div>

<style>
	.app-detail {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* Applicant header */
	.applicant-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: var(--space-card);
		border-bottom: 1px solid var(--border-holdfast);
	}

	.applicant-avatar {
		flex-shrink: 0;
	}

	.avatar-img {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		object-fit: cover;
	}

	.avatar-placeholder {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		background: var(--accent-dim);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1.25rem;
	}

	.applicant-info {
		flex: 1;
		min-width: 0;
	}

	.applicant-name {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.applicant-meta {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin: 0.25rem 0 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.user-id {
		font-family: monospace;
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.separator {
		opacity: 0.4;
	}

	.claimed-info {
		font-size: 0.7rem;
		color: var(--status-warning);
		margin: 0.25rem 0 0;
	}

	/* Answers */
	.answers-section {
		flex: 1;
		padding: var(--space-card);
		overflow-y: auto;
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-holdfast);
	}

	.qa-block {
		margin-bottom: 1.25rem;
	}

	.qa-question {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.qa-answer {
		font-size: 0.95rem;
		color: var(--text-primary);
		line-height: 1.5;
	}

	/* Action bar */
	.action-bar {
		padding: var(--space-card);
		border-top: 1px solid var(--border-holdfast);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.action-placeholder {
		font-size: 0.8rem;
		color: var(--text-secondary);
		opacity: 0.5;
	}
</style>
