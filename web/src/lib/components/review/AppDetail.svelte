<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ApplicationDetail, PriorDecision } from '$lib/server/queries/reviews';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import RiskAura from '$lib/components/data/RiskAura.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import ModmailViewer from '$lib/components/review/ModmailViewer.svelte';
	import DiscordProfileCard from '$lib/components/review/DiscordProfileCard.svelte';
	import type { CachedProfile } from '$lib/server/queries/reviews';
	import { setBotOffline, setBotOnline, getBotOnline } from '$lib/stores/bot-status.svelte';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import { relativeTime } from '$lib/utils/time';
	import gsap from 'gsap';

	let {
		app,
		modmail = [],
		sessionUserId = null,
		canAdminUnclaim = false,
		cachedProfile = null,
		priorDecisions = []
	}: {
		app: ApplicationDetail;
		modmail?: ModmailThreadSummary[];
		sessionUserId?: string | null;
		canAdminUnclaim?: boolean;
		cachedProfile?: CachedProfile | null;
		priorDecisions?: PriorDecision[];
	} = $props();

	let claimLoading = $state(false);
	let claimError = $state<string | null>(null);
	let detailBody: HTMLElement;
	let isMobile = $derived(getIsMobile());
	let profileExpanded = $state(false);

	// Flip state: 'answers' (front) or 'modmail' (back)
	let showModmail = $state(false);
	let openingModmail = $state(false);
	let openModmailError = $state<string | null>(null);

	// Reset modmail view when navigating to a different application
	$effect(() => {
		app.id; // track app identity
		showModmail = false;
	});

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
		if (detailBody) gsap.killTweensOf(detailBody);
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

	onDestroy(() => {
		if (kickTimer) clearInterval(kickTimer);
		if (detailBody) gsap.killTweensOf(detailBody);
	});
</script>

<div class="app-detail">
	<!-- Prior decision warning banner -->
	{#if priorDecisions.length > 0}
		{@const hasBan = priorDecisions.some(d => d.action === 'perm_reject')}
		{@const hasReject = priorDecisions.some(d => d.action === 'reject')}
		{@const hasKick = priorDecisions.some(d => d.action === 'kick')}
		<div class="prior-warning" class:prior-warning-severe={hasBan}>
			<div class="prior-warning-header">
				<span class="prior-warning-icon">{hasBan ? '&#9888;' : '&#9432;'}</span>
				<strong>
					{hasBan ? 'Previously Permanently Rejected' : hasKick ? 'Previously Kicked' : hasReject ? 'Previously Rejected' : 'Prior Application History'}
				</strong>
				<span class="prior-warning-count">{priorDecisions.length} prior {priorDecisions.length === 1 ? 'decision' : 'decisions'}</span>
			</div>
			<div class="prior-warning-list">
				{#each priorDecisions as decision}
					<div class="prior-item">
						<span class="prior-action" class:prior-action-ban={decision.action === 'perm_reject'} class:prior-action-reject={decision.action === 'reject' || decision.action === 'kick'} class:prior-action-approve={decision.action === 'approve'}>
							{decision.action === 'perm_reject' ? 'PERM REJECT' : decision.action === 'reject' ? 'REJECTED' : decision.action === 'kick' ? 'KICKED' : 'APPROVED'}
						</span>
						{#if decision.reason}
							<span class="prior-reason">{decision.reason}</span>
						{/if}
						{#if decision.moderatorName}
							<span class="prior-mod">by {decision.moderatorName}</span>
						{/if}
						{#if decision.decidedAt}
							<span class="prior-date">{relativeTime(decision.decidedAt)}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Two-panel body -->
	<div class="detail-body" bind:this={detailBody}>
		<!-- Left/Top: Discord Profile Card -->
		<div class="profile-col" class:profile-collapsed={isMobile && !profileExpanded}>
			<DiscordProfileCard userId={app.userId} avatarUrl={app.avatarUrl} applicantName={app.applicantName} {cachedProfile} />
			{#if isMobile}
				<button class="profile-toggle" onclick={() => profileExpanded = !profileExpanded}>
					{profileExpanded ? 'Hide profile' : 'Show full profile'}
				</button>
			{/if}
		</div>

		<!-- Right: Answers / Modmail (flip) -->
		<div class="content-col">
			<!-- Header bar with meta + flip toggle -->
			<div class="content-header">
				<div class="content-meta">
					<CopyableId value={app.userId} />
					{#if app.submittedAt}
						<span class="separator">·</span>
						<span>Submitted {relativeTime(app.submittedAt)}</span>
					{/if}
					{#if isClaimedByMe}
						<span class="separator">·</span>
						<span class="claimed-info" style:color={claimAgeColor(app.claimedAt)}>
							{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
							Claimed by you
						</span>
					{:else if isClaimedByOther}
						<span class="separator">·</span>
						<span class="claimed-info" style:color={canAdminUnclaim ? claimAgeColor(app.claimedAt) : undefined}>
							{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
							Claimed by {app.claimedByName ?? 'unknown'}
						</span>
					{/if}
				</div>
				<div class="content-tabs">
					<RiskAura variant="compact" riskScore={app.riskScore} />
					{#if modmail.length > 0}
						<button class="tab-btn" class:tab-btn-active={showModmail} onclick={() => showModmail = !showModmail}>
							Modmail ({modmail.reduce((a, t) => a + t.messageCount, 0)})
						</button>
					{:else if isReviewable}
						<button class="tab-btn" onclick={handleOpenModmail} disabled={openingModmail || !botOnline}>
							{openingModmail ? 'Opening...' : !botOnline ? 'Bot offline' : 'Open Modmail'}
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
			<span class="action-resolved">
				{app.status.charAt(0).toUpperCase() + app.status.slice(1)}
				{#if app.claimedByName}
					{' '}by{' '}
					{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
					{app.claimedByName}
				{/if}
			</span>
		{:else if isClaimedByOther && canAdminUnclaim}
			<span class="action-placeholder" style:color={claimAgeColor(app.claimedAt)}>
				{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
				Claimed by {app.claimedByName ?? 'unknown'}
			</span>
			<button class="btn btn-admin-unclaim" onclick={handleUnclaim} disabled={claimLoading || !botOnline}>
				{claimLoading ? 'Releasing...' : !botOnline ? 'Bot offline' : 'Unclaim (Admin)'}
			</button>
		{:else}
			<span class="action-placeholder">
				{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
				Claimed by {app.claimedByName ?? 'unknown'}
			</span>
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

	.separator {
		opacity: 0.4;
	}

	.claimed-info {
		font-size: 0.7rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.claimer-avatar {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
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
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
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
	.btn-unclaim { background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border-holdfast); }
	.btn-admin-unclaim { background: var(--surface-raised); color: var(--status-warning); border: 1px solid var(--status-warning); margin-left: auto; }

	.decision-buttons { display: flex; gap: 0.5rem; margin-left: auto; }

	.btn-approve { background: var(--status-success); color: var(--bg); }
	.btn-reject { background: var(--status-warning); color: var(--bg); }
	.btn-kick { background: var(--status-danger); color: var(--bg); }
	.btn-permreject { background: var(--bg); color: var(--status-danger); border: 2px solid var(--status-danger); font-weight: 700; }
	.btn-cancel { background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border-holdfast); }
	.btn-undo { background: var(--surface-raised); color: var(--status-danger); border: 1px solid var(--status-danger); }

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
	.action-resolved { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); opacity: 0.7; display: inline-flex; align-items: center; gap: 0.25rem; }

	/* ── Mobile ── */
	@media (max-width: 767px) {
		.detail-body {
			flex-direction: column;
		}

		.profile-col {
			width: 100%;
			border-right: none;
			border-bottom: 1px solid var(--border-holdfast);
			overflow: hidden;
			transition: max-height 300ms var(--ease-smooth);
		}

		.profile-collapsed {
			max-height: 80px;
		}

		.profile-toggle {
			display: block;
			width: 100%;
			padding: 0.4rem;
			background: var(--surface-raised);
			border: none;
			border-top: 1px solid var(--border-holdfast);
			color: var(--accent);
			font-size: 0.7rem;
			font-weight: 500;
			cursor: pointer;
			text-align: center;
		}

		.content-header {
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
		}

		.content-meta {
			flex-wrap: wrap;
		}

		.action-bar {
			flex-wrap: wrap;
			padding: var(--mobile-pad);
			gap: 0.5rem;
		}

		.decision-buttons {
			margin-left: 0;
			width: 100%;
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.5rem;
		}

		.reason-input {
			width: 100%;
			flex: none;
		}

		.btn {
			min-height: 44px;
			padding: 0.625rem 1rem;
		}
	}

	@media (hover: hover) {
		.btn-claim:hover:not(:disabled) { filter: brightness(1.1); box-shadow: var(--glow-accent); }
		.btn-unclaim:hover:not(:disabled) { background: var(--surface); color: var(--text-primary); }
		.btn-approve:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 12px oklch(70% 0.15 145 / 0.3); }
		.btn-reject:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 12px oklch(70% 0.15 80 / 0.3); }
		.btn-kick:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 12px oklch(70% 0.15 25 / 0.3); }
		.btn-permreject:hover:not(:disabled) { background: var(--status-danger); color: var(--bg); box-shadow: 0 0 16px oklch(70% 0.15 25 / 0.4); }
		.btn-cancel:hover:not(:disabled) { color: var(--text-primary); }
		.btn-undo:hover { background: var(--status-danger); color: var(--bg); }
		.btn-admin-unclaim:hover:not(:disabled) { background: var(--status-warning); color: var(--bg); }
		.tab-btn:hover { color: var(--text-primary); border-color: var(--accent); }
	}

	/* Prior decision warning banner */
	.prior-warning {
		border: 1px solid var(--status-warning);
		border-left: 4px solid var(--status-warning);
		background: oklch(25% 0.04 85 / 0.3);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.prior-warning-severe {
		border-color: var(--status-danger);
		border-left-color: var(--status-danger);
		background: oklch(22% 0.04 25 / 0.3);
	}

	.prior-warning-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}

	.prior-warning-icon {
		font-size: 1.1rem;
	}

	.prior-warning-count {
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-left: auto;
	}

	.prior-warning-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.prior-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		flex-wrap: wrap;
	}

	.prior-action {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.prior-action-ban {
		background: var(--status-danger);
		color: var(--bg);
	}

	.prior-action-reject {
		background: oklch(50% 0.08 25);
		color: var(--bg);
	}

	.prior-action-approve {
		background: oklch(40% 0.08 145);
		color: var(--bg);
	}

	.prior-reason {
		color: var(--text-primary);
	}

	.prior-mod {
		color: var(--text-secondary);
	}

	.prior-date {
		color: var(--text-muted);
		margin-left: auto;
	}
</style>
