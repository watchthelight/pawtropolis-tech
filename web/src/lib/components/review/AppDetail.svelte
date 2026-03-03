<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ApplicationDetail } from '$lib/server/queries/reviews';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import RiskAura from '$lib/components/data/RiskAura.svelte';
	import ModmailViewer from '$lib/components/review/ModmailViewer.svelte';
	import gsap from 'gsap';
	import { SPRINGS } from '$lib/motion';
	import { setBotOffline, setBotOnline, getBotOnline } from '$lib/stores/bot-status.svelte';

	let {
		app,
		modmail = [],
		sessionUserId = null,
		canAdminUnclaim = false
	}: {
		app: ApplicationDetail;
		modmail?: ModmailThreadSummary[];
		sessionUserId?: string | null;
		canAdminUnclaim?: boolean;
	} = $props();

	let claimLoading = $state(false);
	let claimError = $state<string | null>(null);
	let actionBar: HTMLElement;

	// Reactive tick so stale claim indicator updates over time
	let now = $state(Date.now());
	let tickInterval: ReturnType<typeof setInterval> | undefined;
	onMount(() => { tickInterval = setInterval(() => { now = Date.now(); }, 60_000); });
	onDestroy(() => { if (tickInterval) clearInterval(tickInterval); });

	function animateActionBar() {
		if (!actionBar) return;
		gsap.from(actionBar.children, {
			opacity: 0,
			y: 8,
			duration: 0.4,
			ease: SPRINGS.gentle,
			stagger: 0.06
		});
	}

	let botOnline = $derived(getBotOnline());
	const REVIEWABLE_STATUSES = ['submitted', 'needs_info'];
	let isReviewable = $derived(REVIEWABLE_STATUSES.includes(app.status));
	let isClaimedByMe = $derived(isReviewable && app.claimedBy != null && app.claimedBy === sessionUserId);
	let isClaimedByOther = $derived(isReviewable && app.claimedBy != null && app.claimedBy !== sessionUserId);
	let isUnclaimed = $derived(isReviewable && app.claimedBy == null);
	let isResolved = $derived(!isReviewable);

	function claimAgeColor(claimedAt: number | null): string {
		if (!claimedAt) return 'var(--text-secondary)';
		const hours = (now - claimedAt) / 3_600_000;
		if (hours < 2) return 'var(--status-success)';
		if (hours < 8) return 'var(--status-warning)';
		return 'var(--status-danger)';
	}

	function relativeTime(ms: number | null): string {
		if (!ms) return '';
		const diff = now - ms;
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	// === Claim/Unclaim ===

	async function handleClaim() {
		claimLoading = true;
		claimError = null;
		try {
			const res = await fetch('/api/review/claim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId: app.id })
			});
			const result = await res.json();
			if (!result.success) {
				claimError = result.error;
				invalidateAll();
			} else {
				setBotOnline();
				// Navigate to My Claims tab with this app selected
				goto(`/dashboard/reviews/${app.id}?tab=mine`);
			}
		} catch {
			claimError = 'Failed to connect';
			setBotOffline();
		} finally {
			claimLoading = false;
		}
	}

	async function handleUnclaim() {
		claimLoading = true;
		claimError = null;
		try {
			const res = await fetch('/api/review/unclaim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId: app.id })
			});
			const result = await res.json();
			if (!result.success) {
				claimError = result.error;
			} else {
				setBotOnline();
				app.claimedBy = null;
				app.claimedByName = null;
				app.claimedAt = null;
			}
		} catch {
			claimError = 'Failed to connect';
			setBotOffline();
		} finally {
			claimLoading = false;
		}
	}

	// === Decision Actions ===

	type DecisionAction = 'approve' | 'reject' | 'kick';

	let activeAction = $state<DecisionAction | null>(null);
	let reasonText = $state('');
	let decisionLoading = $state(false);
	let decisionError = $state<string | null>(null);
	let decisionDone = $state<string | null>(null);
	let kickCountdown = $state(0);
	let kickTimer: ReturnType<typeof setInterval> | undefined;
	let reasonInput: HTMLInputElement;

	function startDecision(action: DecisionAction) {
		activeAction = action;
		reasonText = '';
		decisionError = null;
		// Focus the input after it renders
		requestAnimationFrame(() => reasonInput?.focus());
	}

	function cancelDecision() {
		activeAction = null;
		reasonText = '';
		decisionError = null;
		kickCountdown = 0;
		if (kickTimer) { clearInterval(kickTimer); kickTimer = undefined; }
	}

	function submitReason() {
		if (!activeAction) return;
		const trimmed = reasonText.trim();
		// Approve allows empty reason; reject/kick require it
		if (activeAction !== 'approve' && !trimmed) return;
		if (activeAction === 'kick') {
			startKickCountdown();
		} else {
			executeDecision(activeAction, trimmed || undefined);
		}
	}

	function startKickCountdown() {
		kickCountdown = 3;
		kickTimer = setInterval(() => {
			kickCountdown--;
			if (kickCountdown <= 0) {
				clearInterval(kickTimer);
				kickTimer = undefined;
				executeDecision('kick', reasonText.trim());
			}
		}, 1000);
	}

	function undoKick() {
		if (kickTimer) { clearInterval(kickTimer); kickTimer = undefined; }
		kickCountdown = 0;
		// Stay in reason input mode so they can re-submit or cancel
	}

	async function executeDecision(action: DecisionAction, reason?: string) {
		decisionLoading = true;
		decisionError = null;
		try {
			const res = await fetch(`/api/review/${action}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId: app.id, ...(reason ? { reason } : {}) })
			});
			const result = await res.json();
			if (!result.success) {
				decisionError = result.error;
				decisionLoading = false;
				return;
			}

			setBotOnline();

			// Success — show confirmation then navigate away
			const labels: Record<DecisionAction, string> = { approve: 'Approved', reject: 'Rejected', kick: 'Kicked' };
			decisionDone = labels[action];
			decisionError = null;
			activeAction = null;

			// Brief pause to show success, then go back to queue
			setTimeout(() => goto('/dashboard/reviews'), 800);
		} catch {
			decisionError = 'Failed to connect';
			decisionLoading = false;
			setBotOffline();
		}
	}

	onDestroy(() => { if (kickTimer) clearInterval(kickTimer); });
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
				<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="user-id" title="Click to copy" onclick={() => navigator.clipboard.writeText(app.userId)}>{app.userId}</span>
				{#if app.submittedAt}
					<span class="separator">·</span>
					<span>Submitted {relativeTime(app.submittedAt)}</span>
				{/if}
			</p>
			{#if isClaimedByMe}
				<p class="claimed-info" style:color={claimAgeColor(app.claimedAt)}>
					Claimed by you · {relativeTime(app.claimedAt)}
				</p>
			{:else if isClaimedByOther}
				<p class="claimed-info" style:color={canAdminUnclaim ? claimAgeColor(app.claimedAt) : 'var(--text-secondary)'}>
				Claimed by {app.claimedByName ?? 'unknown'}{canAdminUnclaim ? ` · ${relativeTime(app.claimedAt)}` : ''}
			</p>
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
		{#each app.answers as qa}
			<div class="qa-block">
				<div class="qa-question">{qa.question}</div>
				<div class="qa-answer">{qa.answer}</div>
			</div>
		{/each}

		{#if modmail.length > 0}
			<ModmailViewer threads={modmail} />
		{/if}
	</div>

	<!-- Action bar -->
	<div class="action-bar" bind:this={actionBar}>
		{#if decisionDone}
			<span class="decision-done">{decisionDone}</span>
		{:else if claimError || decisionError}
			<span class="claim-error">{claimError || decisionError}</span>
		{/if}

		{#if decisionDone}
			<!-- Success state — navigating away -->
		{:else if kickCountdown > 0}
			<span class="kick-countdown">Kicking in {kickCountdown}s...</span>
			<button class="btn btn-undo" onclick={undoKick}>Undo</button>
		{:else if activeAction}
			<input
				bind:this={reasonInput}
				bind:value={reasonText}
				class="reason-input"
				type="text"
				placeholder={activeAction === 'approve' ? 'Note (optional)' : activeAction === 'reject' ? 'Reason (required)' : 'Reason (required)'}
				onkeydown={(e) => { if (e.key === 'Enter') submitReason(); if (e.key === 'Escape') cancelDecision(); }}
				disabled={decisionLoading}
			/>
			<button class="btn btn-{activeAction}" onclick={submitReason} disabled={decisionLoading || (activeAction !== 'approve' && !reasonText.trim())}>
				{decisionLoading ? 'Sending...' : activeAction === 'approve' ? 'Approve' : activeAction === 'reject' ? 'Reject' : 'Kick'}
			</button>
			<button class="btn btn-cancel" onclick={cancelDecision} disabled={decisionLoading}>Cancel</button>
		{:else if isUnclaimed}
			<button class="btn btn-claim" onclick={handleClaim} disabled={claimLoading || !botOnline}>
				{claimLoading ? 'Claiming...' : !botOnline ? 'Bot offline' : 'Claim'}
			</button>
		{:else if isClaimedByMe}
			<button class="btn btn-unclaim" onclick={handleUnclaim} disabled={claimLoading || decisionLoading || !botOnline}>
				{claimLoading ? 'Releasing...' : 'Unclaim'}
			</button>
			<div class="decision-buttons">
				<button class="btn btn-approve" onclick={() => startDecision('approve')} disabled={decisionLoading || !botOnline}>
					{decisionLoading && activeAction === 'approve' ? 'Approving...' : 'Approve'}
				</button>
				<button class="btn btn-reject" onclick={() => startDecision('reject')} disabled={decisionLoading || !botOnline}>Reject</button>
				<button class="btn btn-kick" onclick={() => startDecision('kick')} disabled={decisionLoading || !botOnline}>Kick</button>
			</div>
		{:else if isResolved}
			<span class="action-resolved">{app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>
		{:else if isClaimedByOther && canAdminUnclaim}
			<span class="action-placeholder">Claimed by {app.claimedByName ?? 'unknown'}</span>
			<button class="btn btn-admin-unclaim" onclick={handleUnclaim} disabled={claimLoading || !botOnline}>
				{claimLoading ? 'Releasing...' : !botOnline ? 'Bot offline' : 'Unclaim (Admin)'}
			</button>
		{:else}
			<span class="action-placeholder">Claimed by {app.claimedByName ?? 'unknown'}</span>
		{/if}
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
		cursor: pointer;
		transition: opacity 150ms;
	}

	.user-id:hover {
		opacity: 1;
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
		gap: 0.75rem;
	}

	.action-placeholder {
		font-size: 0.8rem;
		color: var(--text-secondary);
		opacity: 0.5;
	}

	.claim-error {
		font-size: 0.75rem;
		color: var(--status-danger);
	}

	/* Buttons */
	.btn {
		padding: 0.5rem 1.25rem;
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-claim {
		background: var(--accent);
		color: var(--bg);
	}

	.btn-claim:hover:not(:disabled) {
		filter: brightness(1.1);
		box-shadow: var(--glow-accent);
	}

	.btn-unclaim {
		background: var(--surface-raised);
		color: var(--text-secondary);
		border: 1px solid var(--border-holdfast);
	}

	.btn-unclaim:hover:not(:disabled) {
		background: var(--surface);
		color: var(--text-primary);
	}

	.btn-admin-unclaim {
		background: var(--surface-raised);
		color: var(--status-warning);
		border: 1px solid var(--status-warning);
		margin-left: auto;
	}

	.btn-admin-unclaim:hover:not(:disabled) {
		background: var(--status-warning);
		color: var(--bg);
	}

	.decision-buttons {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}

	.btn-approve {
		background: var(--status-success);
		color: var(--bg);
	}

	.btn-reject {
		background: var(--status-warning);
		color: var(--bg);
	}

	.btn-kick {
		background: var(--status-danger);
		color: var(--bg);
	}

	.btn-cancel {
		background: var(--surface-raised);
		color: var(--text-secondary);
		border: 1px solid var(--border-holdfast);
	}

	.btn-cancel:hover:not(:disabled) {
		color: var(--text-primary);
	}

	.btn-undo {
		background: var(--surface-raised);
		color: var(--status-danger);
		border: 1px solid var(--status-danger);
	}

	.btn-undo:hover {
		background: var(--status-danger);
		color: var(--bg);
	}

	.btn-approve:hover:not(:disabled) {
		filter: brightness(1.15);
		box-shadow: 0 0 12px oklch(70% 0.15 145 / 0.3);
	}

	.btn-reject:hover:not(:disabled) {
		filter: brightness(1.15);
		box-shadow: 0 0 12px oklch(70% 0.15 80 / 0.3);
	}

	.btn-kick:hover:not(:disabled) {
		filter: brightness(1.15);
		box-shadow: 0 0 12px oklch(70% 0.15 25 / 0.3);
	}

	.reason-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		color: var(--text-primary);
		font-size: 0.8rem;
		outline: none;
		transition: border-color 150ms;
	}

	.reason-input:focus {
		border-color: var(--accent);
	}

	.reason-input::placeholder {
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.kick-countdown {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--status-danger);
		animation: pulse-text 1s ease infinite;
	}

	@keyframes pulse-text {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}

	.decision-done {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--status-success);
	}

	.action-resolved {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		opacity: 0.7;
	}
</style>
