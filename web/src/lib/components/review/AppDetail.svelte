<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ApplicationDetail, PriorDecision } from '$lib/server/queries/reviews';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import RiskAura from '$lib/components/data/RiskAura.svelte';
	import ScanPanel from '$lib/components/review/ScanPanel.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import ModmailViewer from '$lib/components/review/ModmailViewer.svelte';
	import DiscordProfileCard from '$lib/components/review/DiscordProfileCard.svelte';
	import type { CachedProfile, VoteOutInfo } from '$lib/server/queries/reviews';
	import { setBotOffline, setBotOnline, getBotOnline } from '$lib/stores/bot-status.svelte';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { slide } from 'svelte/transition';
	import gsap from 'gsap';

	let {
		app,
		modmail = [],
		sessionUserId = null,
		canAdminUnclaim = false,
		cachedProfile = null,
		priorDecisions = [],
		voteOutInfo = { count: 0, threshold: 2, voters: [] },
		nextUnclaimedId = null
	}: {
		app: ApplicationDetail;
		modmail?: ModmailThreadSummary[];
		sessionUserId?: string | null;
		canAdminUnclaim?: boolean;
		cachedProfile?: CachedProfile | null;
		priorDecisions?: PriorDecision[];
		voteOutInfo?: VoteOutInfo;
		nextUnclaimedId?: string | null;
	} = $props();

	let claimLoading = $state(false);
	let claimError = $state<string | null>(null);
	let detailBody: HTMLElement;
	let isMobile = $derived(getIsMobile());
	let profileExpanded = $state(true);
	let moreOpen = $state(false);

	// Flip state: 'answers' (front) or 'modmail' (back)
	let showModmail = $state(false);
	let openingModmail = $state(false);
	let openModmailError = $state<string | null>(null);
	let memberLeft = $state(false);
	let lastAppId = $state(app.id);

	// Reset view state only when navigating to a DIFFERENT application
	$effect(() => {
		if (app.id !== lastAppId) {
			showModmail = false;
			memberLeft = false;
			moreOpen = false;
			lastAppId = app.id;
		}
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
				await invalidateAll();
				showModmail = true;
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
	const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
	let isStale = $derived(app.submittedAt != null && now - app.submittedAt > TWENTY_FOUR_HOURS);
	let isReviewable = $derived(REVIEWABLE_STATUSES.includes(app.status));
	let isClaimedByMe = $derived(isReviewable && app.claimedBy != null && app.claimedBy === sessionUserId);
	let isClaimedByOther = $derived(isReviewable && app.claimedBy != null && app.claimedBy !== sessionUserId);
	let isUnclaimed = $derived(isReviewable && app.claimedBy == null);
	let isResolved = $derived(!isReviewable);

	// === Vote Out ===

	let hasVoted = $derived(voteOutInfo.voters.some(v => v.id === sessionUserId));
	let voteOutLoading = $state(false);
	let voteOutError = $state<string | null>(null);
	let voteOutReasonOpen = $state(false);
	let voteOutReason = $state('');

	function openVoteOutReason() {
		if (voteOutLoading || hasVoted) return;
		voteOutError = null;
		voteOutReason = '';
		voteOutReasonOpen = true;
	}

	function cancelVoteOut() {
		voteOutReasonOpen = false;
		voteOutReason = '';
		voteOutError = null;
	}

	async function handleVoteOut() {
		if (voteOutLoading || hasVoted) return;
		const reason = voteOutReason.trim();
		if (!reason) {
			voteOutError = 'Reason is required.';
			return;
		}
		voteOutLoading = true;
		voteOutError = null;
		try {
			const res = await fetch('/api/review/vote_out', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId: app.id, reason })
			});
			const result = await res.json();
			if (!result.success) {
				voteOutError = result.error;
				voteOutLoading = false;
				return;
			}
			setBotOnline();
			voteOutLoading = false;
			voteOutReasonOpen = false;
			voteOutReason = '';
			if (result.data?.thresholdMet) {
				decisionDone = 'Voted Out';
				if (detailBody) {
					gsap.to(detailBody, {
						x: 80, opacity: 0, duration: 0.35, ease: 'power2.in',
						onComplete: () => {
						void goto('/dashboard/reviews?tab=unclaimed');
					}
					});
				} else {
					setTimeout(() => goto('/dashboard/reviews?tab=unclaimed'), 400);
				}
			} else {
				await invalidateAll();
			}
		} catch {
			voteOutError = 'Failed to connect';
			setBotOffline();
			voteOutLoading = false;
		}
	}

	function claimAgeColor(claimedAt: number | null): string {
		if (!claimedAt) return 'var(--ink-2)';
		const hours = (now - claimedAt) / 3_600_000;
		if (hours < 2) return 'var(--good)';
		if (hours < 8) return 'var(--warn)';
		return 'var(--danger)';
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
				// click-click-click: jump straight to the next unclaimed app so a mod can
				// claim N apps in a row without dipping back to the queue. If nothing is
				// queued, stay on the just-claimed app under the "mine" filter.
				if (nextUnclaimedId && nextUnclaimedId !== app.id) {
					goto(`/dashboard/reviews/${nextUnclaimedId}?tab=unclaimed`);
				} else {
					goto(`/dashboard/reviews/${app.id}?tab=mine`);
				}
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

	type DecisionAction = 'approve' | 'reject' | 'wrong_password' | 'stale_modmail' | 'kick' | 'permreject';

	let activeAction = $state<DecisionAction | null>(null);
	let reasonText = $state('');
	let decisionLoading = $state(false);
	let decisionError = $state<string | null>(null);
	let decisionDone = $state<string | null>(null);
	let kickCountdown = $state(0);
	let kickTimer: ReturnType<typeof setInterval> | undefined;
	let reasonInput: HTMLInputElement;
	let reasonTextarea: HTMLTextAreaElement;

	const ACTION_LABELS: Record<DecisionAction, string> = {
		approve: 'Approve',
		reject: 'Reject',
		wrong_password: 'Wrong Password',
		stale_modmail: 'Stale Modmail',
		kick: 'Kick',
		permreject: 'Perm Reject'
	};
	type ActionTone = 'success' | 'warning' | 'danger';
	const ACTION_TONES: Record<DecisionAction, ActionTone> = {
		approve: 'success',
		reject: 'warning',
		wrong_password: 'warning',
		stale_modmail: 'warning',
		kick: 'danger',
		permreject: 'danger'
	};

	let requiresReason = $derived(activeAction === 'kick' || activeAction === 'permreject');
	let activeActionLabel = $derived(activeAction ? ACTION_LABELS[activeAction] : '');
	let activeActionTone = $derived<ActionTone>(activeAction ? ACTION_TONES[activeAction] : 'success');
	let canSubmitReason = $derived(
		!decisionLoading && (!requiresReason || reasonText.trim().length > 0)
	);
	let voteOutLabel = $derived(
		hasVoted ? 'Voted' : voteOutLoading ? 'Voting…' : `Vote Out (${voteOutInfo.count}/${voteOutInfo.threshold})`
	);
	let dockError = $derived(claimError || decisionError || voteOutError || null);

	function startDecision(action: DecisionAction) {
		activeAction = action;
		reasonText = '';
		decisionError = null;
		moreOpen = false;
		if (action === 'wrong_password' || action === 'stale_modmail') {
			executeDecision(action);
			return;
		}
		requestAnimationFrame(() => {
			(isMobile ? reasonTextarea : reasonInput)?.focus();
		});
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
		if (activeAction === 'kick' && !trimmed) return;
		if (activeAction === 'permreject' && !trimmed) return;
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
			const labels: Record<DecisionAction, string> = { approve: 'Approved', reject: 'Rejected', wrong_password: 'Rejected (Wrong Password)', stale_modmail: 'Rejected (Stale Modmail)', kick: 'Kicked', permreject: 'Permanently Rejected' };
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
					onComplete: () => {
						void goto('/dashboard/reviews?tab=unclaimed');
					}
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
				<span class="prior-warning-icon">{hasBan ? '⚠' : 'ℹ'}</span>
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
			<DiscordProfileCard userId={app.userId} avatarUrl={app.avatarUrl} applicantName={app.applicantName} {cachedProfile} onMemberStatus={(inServer) => { memberLeft = !inServer; }} />
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
					<RiskAura variant="compact" riskScore={app.riskScore} reason={app.scan?.reason} evidence={app.scan ? { hard: app.scan.evidenceHard, soft: app.scan.evidenceSoft, safe: app.scan.evidenceSafe } : undefined} />
					{#if modmail.length > 0}
						<button class="tab-btn" class:tab-btn-active={showModmail} onclick={() => showModmail = !showModmail}>
							Modmail ({modmail.reduce((a, t) => a + t.messageCount, 0)})
						</button>
					{:else if isReviewable}
						<button class="tab-btn" onclick={handleOpenModmail} disabled={openingModmail || !botOnline}>
							{openingModmail ? 'Opening...' : !botOnline ? 'Bot offline' : 'Open Modmail'}
						</button>
						{#if openModmailError}
							<span style="font-size:0.6rem;color:var(--danger)">{openModmailError}</span>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Content area: answers or modmail -->
			<div class="content-body">
				{#if showModmail}
					<ModmailViewer threads={modmail} targetUserId={app.userId} {memberLeft} />
				{:else}
					<div class="section-label">Image Scans</div>
					<ScanPanel appId={app.id} scan={app.scan} scanScores={app.scanScores} riskScore={app.riskScore} />
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
		{:else if claimError || decisionError || voteOutError}
			<span class="claim-error">{claimError || decisionError || voteOutError}</span>
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
				placeholder={activeAction === 'approve' || activeAction === 'reject' ? 'Reason (optional)' : 'Reason (required)'}
				onkeydown={(e) => { if (e.key === 'Enter') submitReason(); if (e.key === 'Escape') cancelDecision(); }}
				disabled={decisionLoading}
			/>
			<button class="btn btn-{activeAction}" onclick={submitReason} disabled={decisionLoading || ((activeAction === 'kick' || activeAction === 'permreject') && !reasonText.trim())}>
				{decisionLoading ? 'Sending...' : activeAction === 'approve' ? 'Approve' : activeAction === 'reject' ? 'Reject' : activeAction === 'permreject' ? 'Perm Reject' : 'Kick'}
			</button>
			<button class="btn btn-cancel" onclick={cancelDecision} disabled={decisionLoading}>Cancel</button>
		{:else if voteOutReasonOpen}
			<input
				bind:value={voteOutReason}
				class="reason-input"
				type="text"
				maxlength="300"
				placeholder="Reason for vote out (required, max 300)"
				onkeydown={(e) => { if (e.key === 'Enter') handleVoteOut(); if (e.key === 'Escape') cancelVoteOut(); }}
				disabled={voteOutLoading}
			/>
			<button class="btn btn-vote-out" onclick={handleVoteOut} disabled={voteOutLoading || !voteOutReason.trim()}>
				{voteOutLoading ? 'Voting...' : 'Submit Vote'}
			</button>
			<button class="btn btn-cancel" onclick={cancelVoteOut} disabled={voteOutLoading}>Cancel</button>
		{:else if isUnclaimed}
			<button class="btn btn-claim" onclick={handleClaim} disabled={claimLoading || !botOnline}>
				{claimLoading ? 'Claiming...' : !botOnline ? 'Bot offline' : 'Claim'}
			</button>
			<button class="btn btn-vote-out" onclick={openVoteOutReason} disabled={voteOutLoading || hasVoted || !botOnline}>
				{hasVoted ? 'Voted' : voteOutLoading ? 'Voting...' : `Vote Out (${voteOutInfo.count}/${voteOutInfo.threshold})`}
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
				<button class="btn btn-reject" onclick={() => startDecision('wrong_password')} disabled={decisionLoading || !botOnline}>Wrong Password</button>
				{#if isStale}
					<button class="btn btn-stale-modmail" onclick={() => startDecision('stale_modmail')} disabled={decisionLoading || !botOnline}>Stale Modmail</button>
				{/if}
				<button class="btn btn-kick" onclick={() => startDecision('kick')} disabled={decisionLoading || !botOnline}>Kick</button>
				{#if canAdminUnclaim}
					<button class="btn btn-permreject" onclick={() => startDecision('permreject')} disabled={decisionLoading || !botOnline}>Perm Reject</button>
				{/if}
				<button class="btn btn-vote-out" onclick={openVoteOutReason} disabled={voteOutLoading || hasVoted || !botOnline}>
					{hasVoted ? 'Voted' : voteOutLoading ? 'Voting...' : `Vote Out (${voteOutInfo.count}/${voteOutInfo.threshold})`}
				</button>
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
			<button class="btn btn-vote-out" onclick={openVoteOutReason} disabled={voteOutLoading || hasVoted || !botOnline}>
				{hasVoted ? 'Voted' : voteOutLoading ? 'Voting...' : `Vote Out (${voteOutInfo.count}/${voteOutInfo.threshold})`}
			</button>
		{:else}
			<span class="action-placeholder">
				{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
				Claimed by {app.claimedByName ?? 'unknown'}
			</span>
			<button class="btn btn-vote-out" onclick={openVoteOutReason} disabled={voteOutLoading || hasVoted || !botOnline}>
				{hasVoted ? 'Voted' : voteOutLoading ? 'Voting...' : `Vote Out (${voteOutInfo.count}/${voteOutInfo.threshold})`}
			</button>
		{/if}

		{#if !isResolved && voteOutInfo.voters.length > 0}
			<span class="vote-out-voters">{voteOutInfo.voters.map(v => v.name).join(', ')}</span>
		{/if}
	</div>

	<!-- Mobile Review Dock (mobile-only, CSS-hidden on desktop) -->
	<div class="mobile-review-dock" aria-label="Review actions">
		{#if decisionDone}
			<div class="mobile-dock-status">
				<span class="dock-status-pill dock-status-success">{decisionDone}</span>
			</div>
		{:else if kickCountdown > 0}
			<div class="mobile-kick-countdown">
				<span class="kick-countdown-label">Kicking in {kickCountdown}s…</span>
				<button class="mobile-btn mobile-btn-undo" onclick={undoKick}>Undo</button>
			</div>
		{:else if voteOutReasonOpen}
			<div class="mobile-decision-sheet sheet-tone-danger" transition:slide={{ duration: 180 }}>
				<div class="sheet-header">
					<strong>Vote Out</strong>
					<span class="sheet-hint">Reason required (max 300)</span>
				</div>
				<textarea
					bind:value={voteOutReason}
					class="sheet-textarea"
					rows="3"
					maxlength="300"
					placeholder="Why are you voting to reject this applicant?"
					onkeydown={(e) => { if (e.key === 'Escape') cancelVoteOut(); }}
					disabled={voteOutLoading}
				></textarea>
				{#if dockError}
					<div class="mobile-dock-error">{dockError}</div>
				{/if}
				<div class="sheet-actions">
					<button class="sheet-btn sheet-btn-cancel" onclick={cancelVoteOut} disabled={voteOutLoading}>Cancel</button>
					<button
						class="sheet-btn sheet-btn-confirm sheet-btn-confirm-danger"
						onclick={handleVoteOut}
						disabled={voteOutLoading || !voteOutReason.trim()}
					>
						{voteOutLoading ? 'Voting…' : 'Submit Vote'}
					</button>
				</div>
			</div>
		{:else if activeAction}
			<div class="mobile-decision-sheet sheet-tone-{activeActionTone}" transition:slide={{ duration: 180 }}>
				<div class="sheet-header">
					<strong>{activeActionLabel}</strong>
					<span class="sheet-hint">{requiresReason ? 'Reason required' : 'Reason optional'}</span>
				</div>
				<textarea
					bind:this={reasonTextarea}
					bind:value={reasonText}
					class="sheet-textarea"
					rows="3"
					placeholder={requiresReason ? 'Explain why…' : 'Optional context…'}
					onkeydown={(e) => { if (e.key === 'Escape') cancelDecision(); }}
					disabled={decisionLoading}
				></textarea>
				{#if dockError}
					<div class="mobile-dock-error">{dockError}</div>
				{/if}
				<div class="sheet-actions">
					<button class="sheet-btn sheet-btn-cancel" onclick={cancelDecision} disabled={decisionLoading}>Cancel</button>
					<button
						class="sheet-btn sheet-btn-confirm sheet-btn-confirm-{activeActionTone}"
						onclick={submitReason}
						disabled={!canSubmitReason}
					>
						{decisionLoading ? 'Sending…' : activeAction === 'kick' ? 'Kick (3s undo)' : activeActionLabel}
					</button>
				</div>
			</div>
		{:else}
			{#if moreOpen && isClaimedByMe}
				<div class="mobile-more-panel" id="mobile-more-panel" transition:slide={{ duration: 180 }}>
					<button class="more-btn" onclick={handleUnclaim} disabled={claimLoading || !botOnline}>
						{claimLoading ? 'Releasing…' : 'Unclaim'}
					</button>
					<button class="more-btn" onclick={() => startDecision('wrong_password')} disabled={decisionLoading || !botOnline}>
						Wrong Password
					</button>
					{#if isStale}
						<button class="more-btn more-btn-warn" onclick={() => startDecision('stale_modmail')} disabled={decisionLoading || !botOnline}>
							Stale Modmail
						</button>
					{/if}
					<button class="more-btn more-btn-danger" onclick={() => startDecision('kick')} disabled={decisionLoading || !botOnline}>
						Kick
					</button>
					{#if canAdminUnclaim}
						<button class="more-btn more-btn-danger" onclick={() => startDecision('permreject')} disabled={decisionLoading || !botOnline}>
							Perm Reject
						</button>
					{/if}
					<button
						class="more-btn more-btn-danger more-btn-full"
						onclick={openVoteOutReason}
						disabled={voteOutLoading || hasVoted || !botOnline}
					>
						{voteOutLabel}
					</button>
				</div>
			{/if}

			{#if dockError}
				<div class="mobile-dock-error">{dockError}</div>
			{/if}

			<div class="mobile-dock-status">
				{#if isResolved}
					<span class="dock-status-pill dock-status-resolved">
						{app.status.charAt(0).toUpperCase() + app.status.slice(1)}
					</span>
					{#if app.claimedByName}
						<span class="dock-status-meta">
							by
							{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
							{app.claimedByName}
						</span>
					{/if}
				{:else if isClaimedByMe}
					<span class="dock-status-pill dock-status-claimed-me" style:color={claimAgeColor(app.claimedAt)}>
						Claimed by you
					</span>
					{#if voteOutInfo.voters.length > 0}
						<span class="dock-status-meta">Vote-out: {voteOutInfo.voters.map(v => v.name).join(', ')}</span>
					{/if}
				{:else if isClaimedByOther}
					<span class="dock-status-pill dock-status-claimed-other">
						{#if app.claimedByAvatar}<img src={app.claimedByAvatar} alt="" class="claimer-avatar" />{/if}
						Claimed by {app.claimedByName ?? 'unknown'}
					</span>
				{:else if isUnclaimed}
					<span class="mobile-dock-hint">Claim this application to unlock decisions.</span>
				{/if}
			</div>

			{#if isUnclaimed}
				<div class="mobile-primary-actions layout-claim">
					<button
						class="mobile-btn mobile-btn-primary"
						onclick={handleClaim}
						disabled={claimLoading || !botOnline}
					>
						{claimLoading ? 'Claiming…' : !botOnline ? 'Bot offline' : 'Claim'}
					</button>
					<button
						class="mobile-btn mobile-btn-danger-outline"
						onclick={openVoteOutReason}
						disabled={voteOutLoading || hasVoted || !botOnline}
					>
						{voteOutLabel}
					</button>
				</div>
			{:else if isClaimedByMe}
				<div class="mobile-primary-actions layout-claim-mine">
					<button
						class="mobile-btn mobile-btn-approve"
						onclick={() => startDecision('approve')}
						disabled={decisionLoading || !botOnline}
						aria-label="Approve this application"
					>
						{!botOnline ? 'Bot offline' : 'Approve'}
					</button>
					<button
						class="mobile-btn mobile-btn-reject"
						onclick={() => startDecision('reject')}
						disabled={decisionLoading || !botOnline}
					>
						Reject
					</button>
					<button
						class="mobile-btn mobile-btn-more"
						onclick={() => moreOpen = !moreOpen}
						aria-expanded={moreOpen}
						aria-controls="mobile-more-panel"
					>
						{moreOpen ? 'Close' : 'More'}
					</button>
				</div>
			{:else if isClaimedByOther && canAdminUnclaim}
				<div class="mobile-primary-actions layout-admin">
					<button
						class="mobile-btn mobile-btn-admin"
						onclick={handleUnclaim}
						disabled={claimLoading || !botOnline}
					>
						{claimLoading ? 'Releasing…' : !botOnline ? 'Bot offline' : 'Unclaim (Admin)'}
					</button>
					<button
						class="mobile-btn mobile-btn-danger-outline"
						onclick={openVoteOutReason}
						disabled={voteOutLoading || hasVoted || !botOnline}
					>
						{voteOutLabel}
					</button>
				</div>
			{:else if isClaimedByOther}
				<div class="mobile-primary-actions layout-other">
					<button
						class="mobile-btn mobile-btn-danger-outline"
						onclick={openVoteOutReason}
						disabled={voteOutLoading || hasVoted || !botOnline}
					>
						{voteOutLabel}
					</button>
				</div>
			{/if}
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
		width: 200px;
		flex-shrink: 0;
		padding: 0.5rem;
		overflow-y: auto;
		border-right: 1px solid var(--line);
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
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--line);
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.content-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: var(--ink-2);
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
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--ink-2);
		font-size: 0.7rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms;
	}

	.tab-btn-active {
		background: var(--sage-deep);
		color: var(--sage);
		border-color: var(--sage);
	}

	/* Content body (scrollable) */
	.content-body {
		flex: 1;
		padding: 1rem;
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
		width: 20px;
		height: 20px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
		margin-bottom: 0.75rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid var(--line);
	}

	.qa-block {
		margin-bottom: 1rem;
	}

	.qa-question {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink-2);
		margin-bottom: 0.25rem;
	}

	.qa-answer {
		font-size: 0.95rem;
		color: var(--ink);
		line-height: 1.5;
	}

	/* Action bar */
	.action-bar {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--line);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.action-placeholder {
		font-size: 0.8rem;
		color: var(--ink-2);
		opacity: 0.5;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.claim-error {
		font-size: 0.75rem;
		color: var(--danger);
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

	.btn-claim { background: var(--sage); color: var(--void); }
	.btn-unclaim { background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); }
	.btn-admin-unclaim { background: var(--surface-2); color: var(--warn); border: 1px solid var(--warn); margin-left: auto; }

	.decision-buttons { display: flex; gap: 0.5rem; margin-left: auto; }

	.btn-approve { background: var(--good); color: var(--void); }
	.btn-reject { background: var(--warn); color: var(--void); }
	.btn-kick { background: var(--danger); color: var(--void); }
	.btn-stale-modmail { background: var(--danger); color: var(--void); }
	.btn-permreject { background: var(--void); color: var(--danger); border: 2px solid var(--danger); font-weight: 700; }
	.btn-vote-out { background: var(--void); color: var(--danger); border: 2px solid var(--danger); }
	.btn-cancel { background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); }
	.btn-undo { background: var(--surface-2); color: var(--danger); border: 1px solid var(--danger); }

	.reason-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
		font-size: 0.8rem;
		outline: none;
		transition: border-color 150ms;
	}

	.reason-input:focus { border-color: var(--sage); }
	.reason-input::placeholder { color: var(--ink-2); opacity: 0.6; }

	.kick-countdown { font-size: 0.85rem; font-weight: 600; color: var(--danger); animation: pulse-text 1s ease infinite; }
	@keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

	.decision-done { font-size: 0.9rem; font-weight: 600; color: var(--good); }
	.action-resolved { font-size: 0.8rem; font-weight: 500; color: var(--ink-2); opacity: 0.7; display: inline-flex; align-items: center; gap: 0.25rem; }
	.vote-out-voters { font-size: 0.65rem; color: var(--ink-2); opacity: 0.7; margin-left: auto; }

	/* ── Mobile Review Dock (display:none on desktop, shown inside mobile @media below) ── */
	.mobile-review-dock {
		display: none;
		flex-direction: column;
		gap: 0.625rem;
		position: sticky;
		bottom: 0;
		z-index: 10;
		flex-shrink: 0;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
		background: var(--surface-2);
		border-top: 1px solid var(--line);
		box-shadow: 0 -8px 24px oklch(0% 0 0 / 0.25);
	}

	.mobile-dock-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.5rem;
	}

	.dock-status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.2rem 0.65rem;
		border-radius: var(--radius-pill);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.dock-status-success {
		background: var(--good);
		color: var(--void);
	}

	.dock-status-claimed-me {
		background: var(--sage-deep);
		color: var(--sage);
	}

	.dock-status-claimed-other {
		background: var(--surface-3);
		color: var(--ink-2);
		border: 1px solid var(--line);
	}

	.dock-status-resolved {
		background: var(--surface-3);
		color: var(--ink-2);
		border: 1px solid var(--line);
	}

	.dock-status-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		color: var(--ink-3);
	}

	.mobile-dock-hint {
		font-size: 0.75rem;
		color: var(--ink-3);
		line-height: 1.4;
	}

	.mobile-dock-error {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		background: oklch(25% 0.06 25 / 0.25);
		border: 1px solid oklch(45% 0.08 25 / 0.5);
		color: var(--danger);
		font-size: 0.8125rem;
		line-height: 1.35;
	}

	.mobile-primary-actions {
		display: grid;
		gap: 0.5rem;
	}

	.layout-claim,
	.layout-admin,
	.layout-other {
		grid-template-columns: 1fr;
	}

	.layout-claim-mine {
		grid-template-columns: 1fr 1fr;
		grid-template-areas:
			'approve approve'
			'reject more';
	}

	.layout-claim-mine .mobile-btn-approve { grid-area: approve; }
	.layout-claim-mine .mobile-btn-reject  { grid-area: reject; }
	.layout-claim-mine .mobile-btn-more    { grid-area: more; }

	.mobile-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		border: none;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		background: var(--surface);
		color: var(--ink);
		transition: transform 120ms var(--ease-smooth), filter 120ms, background 150ms;
		-webkit-tap-highlight-color: transparent;
	}

	.mobile-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.mobile-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	.mobile-btn-primary {
		background: var(--sage);
		color: var(--on-sage);
		min-height: 56px;
		font-size: 1rem;
		box-shadow: var(--shadow-sm);
	}

	.mobile-btn-approve {
		background: var(--good);
		color: var(--void);
		min-height: 56px;
		font-size: 1rem;
		letter-spacing: 0.01em;
		box-shadow: var(--shadow-sm);
	}

	.mobile-btn-reject {
		background: var(--surface);
		color: var(--warn);
		border: 1px solid var(--warn);
	}

	.mobile-btn-more {
		background: var(--surface);
		color: var(--ink-2);
		border: 1px solid var(--line);
		font-weight: 500;
	}

	.mobile-btn-more[aria-expanded='true'] {
		background: var(--surface-3);
		color: var(--ink);
		border-color: var(--sage);
	}

	.mobile-btn-danger-outline {
		background: transparent;
		color: var(--danger);
		border: 1px solid var(--danger);
	}

	.mobile-btn-admin {
		background: var(--surface);
		color: var(--warn);
		border: 1px solid var(--warn);
		min-height: 52px;
	}

	.mobile-btn-undo {
		background: var(--surface);
		color: var(--danger);
		border: 1px solid var(--danger);
		min-height: 52px;
		font-weight: 700;
		padding-inline: 1.25rem;
	}

	/* More panel */
	.mobile-more-panel {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		padding: 0.625rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.more-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		transition: transform 120ms var(--ease-smooth), filter 120ms, background 150ms;
		-webkit-tap-highlight-color: transparent;
	}

	.more-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.more-btn:active:not(:disabled) { transform: scale(0.98); }

	.more-btn-warn {
		color: var(--warn);
		border-color: var(--warn);
	}

	.more-btn-danger {
		color: var(--danger);
		border-color: var(--danger);
	}

	.more-btn-full {
		grid-column: span 2;
	}

	/* Decision sheet */
	.mobile-decision-sheet {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-left-width: 3px;
		border-radius: var(--radius-md);
	}

	.sheet-tone-success { border-left-color: var(--good); }
	.sheet-tone-warning { border-left-color: var(--warn); }
	.sheet-tone-danger  { border-left-color: var(--danger); }

	.sheet-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}

	.sheet-header strong {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--ink);
	}

	.sheet-hint {
		font-size: 0.65rem;
		color: var(--ink-3);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
	}

	.sheet-textarea {
		width: 100%;
		min-height: 88px;
		max-height: 200px;
		padding: 0.625rem 0.75rem;
		background: var(--void);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-family: inherit;
		font-size: 16px;
		line-height: 1.4;
		resize: vertical;
		outline: none;
		transition: border-color 150ms;
		box-sizing: border-box;
	}

	.sheet-textarea:focus {
		border-color: var(--sage);
	}

	.sheet-textarea::placeholder {
		color: var(--ink-3);
	}

	.sheet-actions {
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: 0.5rem;
	}

	.sheet-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		border: none;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 120ms, filter 120ms, background 150ms;
		-webkit-tap-highlight-color: transparent;
	}

	.sheet-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.sheet-btn:active:not(:disabled) { transform: scale(0.98); }

	.sheet-btn-cancel {
		background: var(--surface-2);
		color: var(--ink-2);
		border: 1px solid var(--line);
	}

	.sheet-btn-confirm-success { background: var(--good); color: var(--void); }
	.sheet-btn-confirm-warning { background: var(--warn); color: var(--void); }
	.sheet-btn-confirm-danger  { background: var(--danger); color: var(--void); }

	/* Kick countdown (mobile) */
	.mobile-kick-countdown {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: oklch(25% 0.06 25 / 0.3);
		border: 1px solid var(--danger);
		border-radius: var(--radius-md);
	}

	.kick-countdown-label {
		color: var(--danger);
		font-weight: 700;
		font-size: 0.95rem;
		animation: pulse-text 1s ease infinite;
	}

	/* ── Mobile ── */
	@media (max-width: 767px) {
		.detail-body {
			flex-direction: column;
		}

		.profile-col {
			width: 100%;
			padding: 0.75rem;
			border-right: none;
			border-bottom: 1px solid var(--line);
			overflow: hidden;
			transition: max-height 300ms var(--ease-smooth);
		}

		.profile-collapsed {
			max-height: 100px;
		}

		.profile-toggle {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			min-height: 44px;
			padding: 0.4rem;
			background: var(--surface-2);
			border: none;
			border-top: 1px solid var(--line);
			color: var(--sage);
			font-size: 0.75rem;
			font-weight: 500;
			cursor: pointer;
			text-align: center;
		}

		.content-header {
			flex-direction: column;
			align-items: stretch;
			padding: 0.75rem 1rem;
			gap: 0.625rem;
		}

		.content-meta {
			flex-wrap: wrap;
			font-size: 0.75rem;
		}

		.tab-btn {
			min-height: 40px;
			padding: 0.375rem 0.75rem;
		}

		.content-body {
			padding: 1rem;
		}

		.section-label {
			margin-bottom: 0.875rem;
		}

		.qa-block {
			margin-bottom: 1.25rem;
			padding-bottom: 1.25rem;
			border-bottom: 1px solid oklch(25% 0.004 var(--hue) / 0.5);
		}

		.qa-block:last-child {
			border-bottom: none;
			margin-bottom: 0;
			padding-bottom: 0;
		}

		.qa-question {
			font-size: 0.8125rem;
			margin-bottom: 0.375rem;
		}

		.qa-answer {
			font-size: 1rem;
			line-height: 1.6;
		}

		/* Desktop-only action bar hides on mobile — replaced by .mobile-review-dock */
		.action-bar {
			display: none;
		}

		/* Make room under answers so the last block breathes above the dock */
		.content-body {
			padding-bottom: 1.5rem;
		}

		.mobile-review-dock {
			display: flex;
		}
	}

	@media (hover: hover) {
		.btn-claim:hover:not(:disabled) { filter: brightness(1.1); box-shadow: var(--shadow-md); }
		.btn-unclaim:hover:not(:disabled) { background: var(--surface); color: var(--ink); }
		.btn-approve:hover:not(:disabled) { filter: brightness(1.15); box-shadow: var(--shadow-md); }
		.btn-reject:hover:not(:disabled) { filter: brightness(1.15); box-shadow: var(--shadow-md); }
		.btn-kick:hover:not(:disabled) { filter: brightness(1.15); box-shadow: var(--shadow-md); }
		.btn-stale-modmail:hover:not(:disabled) { filter: brightness(1.15); box-shadow: var(--shadow-md); }
		.btn-permreject:hover:not(:disabled) { background: var(--danger); color: var(--void); box-shadow: var(--shadow-md); }
		.btn-vote-out:hover:not(:disabled) { background: var(--danger); color: var(--void); box-shadow: var(--shadow-md); }
		.btn-cancel:hover:not(:disabled) { color: var(--ink); }
		.btn-undo:hover { background: var(--danger); color: var(--void); }
		.btn-admin-unclaim:hover:not(:disabled) { background: var(--warn); color: var(--void); }
		.tab-btn:hover { color: var(--ink); border-color: var(--sage); }
	}

	/* Prior decision warning banner */
	.prior-warning {
		border: 1px solid var(--warn);
		border-left: 4px solid var(--warn);
		background: oklch(25% 0.04 85 / 0.3);
		border-radius: var(--radius-md);
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.prior-warning-severe {
		border-color: var(--danger);
		border-left-color: var(--danger);
		background: oklch(22% 0.04 25 / 0.3);
	}

	.prior-warning-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--ink);
		margin-bottom: 0.5rem;
	}

	.prior-warning-icon {
		font-size: 1.1rem;
	}

	.prior-warning-count {
		font-size: 0.7rem;
		color: var(--ink-2);
		margin-left: auto;
	}

	.prior-warning-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 12rem;
		overflow-y: auto;
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
		background: var(--danger);
		color: var(--void);
	}

	.prior-action-reject {
		background: oklch(50% 0.08 25);
		color: var(--void);
	}

	.prior-action-approve {
		background: oklch(40% 0.08 145);
		color: var(--void);
	}

	.prior-reason {
		color: var(--ink);
	}

	.prior-mod {
		color: var(--ink-2);
	}

	.prior-date {
		color: var(--ink-faint);
		margin-left: auto;
	}
</style>
