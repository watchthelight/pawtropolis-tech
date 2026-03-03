<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ApplicationDetail } from '$lib/server/queries/reviews';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import RiskAura from '$lib/components/data/RiskAura.svelte';
	import ModmailViewer from '$lib/components/review/ModmailViewer.svelte';
	import DiscordProfileCard from '$lib/components/review/DiscordProfileCard.svelte';
	import type { CachedProfile } from '$lib/server/queries/reviews';
	import { setBotOffline, setBotOnline, getBotOnline } from '$lib/stores/bot-status.svelte';
	import { relativeTime } from '$lib/utils/time';
	import gsap from 'gsap';

	let {
		app,
		modmail = [],
		sessionUserId = null,
		canAdminUnclaim = false,
		cachedProfile = null
	}: {
		app: ApplicationDetail;
		modmail?: ModmailThreadSummary[];
		sessionUserId?: string | null;
		canAdminUnclaim?: boolean;
		cachedProfile?: CachedProfile | null;
	} = $props();

	let claimLoading = $state(false);
	let claimError = $state<string | null>(null);
	let detailBody: HTMLElement;

	// Flip state: 'answers' (front) or 'modmail' (back)
	let showModmail = $state(false);
	let openingModmail = $state(false);
	let openModmailError = $state<string | null>(null);

	async function handleOpenModmail() {
		if (openingModmail) return;
		openingModmail = true;
		openModmailError = null;
		try {
			const res = await fetch('/api/modmail/open', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId: app.userId })
			});
			const result = await res.json();
			if (!result.success) {
				openModmailError = result.error ?? 'Failed to open';
			} else {
				window.location.reload();
			}
		} catch {
			openModmailError = 'Failed to connect';
		} finally {
			openingModmail = false;
		}
	}

	// Reactive tick so stale claim indicator updates over time
	let now = $state(Date.now());
	let tickInterval: ReturnType<typeof setInterval> | undefined;
	onMount(() => { tickInterval = setInterval(() => { now = Date.now(); }, 60_000); });
	onDestroy(() => { if (tickInterval) clearInterval(tickInterval); });

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

	type DecisionAction = 'approve' | 'reject' | 'kick' | 'permreject';

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
	}

	async function executeDecision(action: DecisionAction, reason?: string) {
		decisionLoading = true;
		decisionError = null;
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 5000);
			const res = await fetch(`/api/review/${action}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId: app.id, ...(reason ? { reason } : {}) }),
				signal: controller.signal
			});
			clearTimeout(timeout);
			const result = await res.json();
			if (!result.success) {
				decisionError = result.error;
				decisionLoading = false;
				return;
			}

			setBotOnline();
			const labels: Record<DecisionAction, string> = { approve: 'Approved', reject: 'Rejected', kick: 'Kicked', permreject: 'Permanently Rejected' };
			decisionDone = labels[action];
			decisionError = null;
			activeAction = null;
			decisionLoading = false;

			// Sweep animation then navigate to unclaimed tab
			if (detailBody) {
				gsap.to(detailBody, {
					x: 80,
					opacity: 0,
					duration: 0.35,
					ease: 'power2.in',
					onComplete: () => goto('/dashboard/reviews?tab=unclaimed')
				});
			} else {
				setTimeout(() => goto('/dashboard/reviews?tab=unclaimed'), 400);
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				decisionError = 'Request timed out';
			} else {
				decisionError = 'Failed to connect';
				setBotOffline();
			}
			decisionLoading = false;
		}
	}

	onDestroy(() => { if (kickTimer) clearInterval(kickTimer); });
</script>

<div class="app-detail">
	<!-- Two-panel body -->
	<div class="detail-body" bind:this={detailBody}>
		<!-- Left: Discord Profile Card -->
		<div class="profile-col">
			<DiscordProfileCard userId={app.userId} avatarUrl={app.avatarUrl} applicantName={app.applicantName} {cachedProfile} />
		</div>

		<!-- Right: Answers / Modmail (flip) -->
		<div class="content-col">
			<!-- Header bar with meta + flip toggle -->
			<div class="content-header">
				<div class="content-meta">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span class="user-id" title="Click to copy" onclick={() => navigator.clipboard.writeText(app.userId)}>{app.userId}</span>
					{#if app.submittedAt}
						<span class="separator">·</span>
						<span>Submitted {relativeTime(app.submittedAt)}</span>
					{/if}
					{#if isClaimedByMe}
						<span class="separator">·</span>
						<span class="claimed-info" style:color={claimAgeColor(app.claimedAt)}>Claimed by you</span>
					{:else if isClaimedByOther}
						<span class="separator">·</span>
						<span class="claimed-info" style:color={canAdminUnclaim ? claimAgeColor(app.claimedAt) : undefined}>Claimed by {app.claimedByName ?? 'unknown'}</span>
					{/if}
				</div>
				<div class="content-tabs">
					<RiskAura variant="compact" riskScore={app.riskScore} />
					{#if modmail.length > 0}
						<button class="tab-btn" class:tab-btn-active={showModmail} onclick={() => showModmail = !showModmail}>
							Modmail ({modmail.reduce((a, t) => a + t.messageCount, 0)})
						</button>
					{:else}
						<button class="tab-btn" onclick={handleOpenModmail} disabled={openingModmail}>
							{openingModmail ? 'Opening...' : 'Open Modmail'}
						</button>
						{#if openModmailError}
							<span style="font-size:0.6rem;color:var(--status-danger)">{openModmailError}</span>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Content area: answers or modmail -->
			<div class="content-body">
				{#if showModmail}
					<ModmailViewer threads={modmail} targetUserId={app.userId} />
				{:else}
					<div class="section-label">Responses</div>
					{#each app.answers as qa}
						<div class="qa-block">
							<div class="qa-question">{qa.question}</div>
							<div class="qa-answer">{qa.answer}</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>

	<!-- Action bar (full width) -->
	<div class="action-bar">
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
				placeholder={activeAction === 'approve' ? 'Note (optional)' : 'Reason (required)'}
				onkeydown={(e) => { if (e.key === 'Enter') submitReason(); if (e.key === 'Escape') cancelDecision(); }}
				disabled={decisionLoading}
			/>
			<button class="btn btn-{activeAction}" onclick={submitReason} disabled={decisionLoading || (activeAction !== 'approve' && !reasonText.trim())}>
				{decisionLoading ? 'Sending...' : activeAction === 'approve' ? 'Approve' : activeAction === 'reject' ? 'Reject' : activeAction === 'permreject' ? 'Perm Reject' : 'Kick'}
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
				{#if canAdminUnclaim}
					<button class="btn btn-permreject" onclick={() => startDecision('permreject')} disabled={decisionLoading || !botOnline}>Perm Reject</button>
				{/if}
			</div>
		{:else if isResolved}
			<span class="action-resolved">{app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>
		{:else if isClaimedByOther && canAdminUnclaim}
			<span class="action-placeholder" style:color={claimAgeColor(app.claimedAt)}>Claimed by {app.claimedByName ?? 'unknown'}</span>
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

	/* Two-panel body */
	.detail-body {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.profile-col {
		width: 220px;
		flex-shrink: 0;
		padding: 0.5rem;
		overflow-y: auto;
		border-right: 1px solid var(--border-holdfast);
	}

	.content-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* Content header */
	.content-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem var(--space-card);
		border-bottom: 1px solid var(--border-holdfast);
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.content-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: var(--text-secondary);
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.content-tabs {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.tab-btn {
		padding: 0.25rem 0.6rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
		background: var(--surface-raised);
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms;
	}

	.tab-btn:hover {
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.tab-btn-active {
		background: var(--accent-dim);
		color: var(--accent);
		border-color: var(--accent);
	}

	/* Content body (scrollable) */
	.content-body {
		flex: 1;
		padding: var(--space-card);
		overflow-y: auto;
	}

	.user-id {
		font-family: monospace;
		font-size: 0.65rem;
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
		flex-shrink: 0;
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

	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-claim { background: var(--accent); color: var(--bg); }
	.btn-claim:hover:not(:disabled) { filter: brightness(1.1); box-shadow: var(--glow-accent); }

	.btn-unclaim { background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border-holdfast); }
	.btn-unclaim:hover:not(:disabled) { background: var(--surface); color: var(--text-primary); }

	.btn-admin-unclaim { background: var(--surface-raised); color: var(--status-warning); border: 1px solid var(--status-warning); margin-left: auto; }
	.btn-admin-unclaim:hover:not(:disabled) { background: var(--status-warning); color: var(--bg); }

	.decision-buttons { display: flex; gap: 0.5rem; margin-left: auto; }

	.btn-approve { background: var(--status-success); color: var(--bg); }
	.btn-reject { background: var(--status-warning); color: var(--bg); }
	.btn-kick { background: var(--status-danger); color: var(--bg); }
	.btn-permreject { background: var(--bg); color: var(--status-danger); border: 2px solid var(--status-danger); font-weight: 700; }
	.btn-permreject:hover:not(:disabled) { background: var(--status-danger); color: var(--bg); box-shadow: 0 0 16px oklch(70% 0.15 25 / 0.4); }
	.btn-cancel { background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border-holdfast); }
	.btn-cancel:hover:not(:disabled) { color: var(--text-primary); }
	.btn-undo { background: var(--surface-raised); color: var(--status-danger); border: 1px solid var(--status-danger); }
	.btn-undo:hover { background: var(--status-danger); color: var(--bg); }

	.btn-approve:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 12px oklch(70% 0.15 145 / 0.3); }
	.btn-reject:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 12px oklch(70% 0.15 80 / 0.3); }
	.btn-kick:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 12px oklch(70% 0.15 25 / 0.3); }

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

	.reason-input:focus { border-color: var(--accent); }
	.reason-input::placeholder { color: var(--text-secondary); opacity: 0.6; }

	.kick-countdown { font-size: 0.85rem; font-weight: 600; color: var(--status-danger); animation: pulse-text 1s ease infinite; }
	@keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

	.decision-done { font-size: 0.9rem; font-weight: 600; color: var(--status-success); }
	.action-resolved { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); opacity: 0.7; }
</style>
