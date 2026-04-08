<script lang="ts">
	import { prefersReducedMotion } from '$lib/motion';
	import RiskAura from '$lib/components/data/RiskAura.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { openLightbox } from '$lib/stores/lightbox.svelte';

	let { applicantName, avatarUrl = null, status, submittedAt, claimedBy, claimedByName, claimedByAvatar = null, riskScore, hasUnreadModmail = false, isStale = false, selected = false, onclick }: {
		applicantName: string;
		avatarUrl?: string | null;
		status: string;
		submittedAt: number | null;
		claimedBy: string | null;
		claimedByName: string | null;
		claimedByAvatar?: string | null;
		riskScore: number;
		hasUnreadModmail?: boolean;
		isStale?: boolean;
		selected?: boolean;
		onclick?: () => void;
	} = $props();

	const statusLabel: Record<string, string> = {
		submitted: 'Pending',
		needs_info: 'Needs Info'
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="review-card"
	class:review-card-stale={isStale}
	class:review-card-selected={selected}
	role="button"
	tabindex="0"
	{onclick}
	onkeydown={(e) => { if (onclick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onclick(); } }}
	onmouseenter={(e) => {
		if (!selected && !prefersReducedMotion()) {
			e.currentTarget.style.transform = 'translateY(-1px)';
		}
	}}
	onmouseleave={(e) => {
		e.currentTarget.style.transform = '';
	}}
>
	<div class="review-card-row">
		<div class="avatar-wrapper">
			{#if avatarUrl}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<img src={avatarUrl} alt={applicantName} class="review-card-avatar clickable-avatar" onclick={(e) => { e.stopPropagation(); openLightbox(avatarUrl!); }} />
			{:else}
				<div class="review-card-avatar-placeholder">{applicantName.charAt(0).toUpperCase()}</div>
			{/if}
			{#if hasUnreadModmail}
				<span class="modmail-dot" title="Unread modmail from applicant"></span>
			{/if}
		</div>
		<div class="review-card-content">
			<div class="review-card-top">
				<span class="review-card-name">{applicantName}</span>
				<span class="review-card-time">{relativeTime(submittedAt)}</span>
			</div>
			<div class="review-card-bottom">
				<span class="review-card-status">
					<span class="status-dot" style:background-color={status === 'needs_info' ? 'var(--status-warning)' : 'var(--accent)'}></span>
					{statusLabel[status] ?? status}
				</span>
				<RiskAura variant="compact" {riskScore} />
			</div>
			{#if claimedBy}
				<div class="review-card-claimed">
					{#if claimedByAvatar}
						<img src={claimedByAvatar} alt="" class="claimer-avatar" />
					{/if}
					Claimed by {claimedByName ?? 'unknown'}
				</div>
			{/if}
			{#if hasUnreadModmail}
				<div class="modmail-label">
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
					New modmail
				</div>
			{/if}
			{#if isStale}
				<div class="stale-label">
					<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
					Stale
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.review-card {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		background: var(--surface);
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.review-card:hover {
			background: var(--surface-raised);
			box-shadow: var(--shadow-md);
		}
	}

	.review-card:active {
		background: var(--surface-raised);
	}

	.review-card-selected {
		border-left: 3px solid var(--accent);
		background: var(--surface-raised);
		box-shadow: var(--shadow-sm);
	}

	.review-card-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.review-card-avatar {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		flex-shrink: 0;
	}

	.clickable-avatar {
		cursor: zoom-in;
		transition: transform 150ms var(--ease-smooth);
	}

	.clickable-avatar:hover {
		transform: scale(1.1);
	}

	.review-card-avatar-placeholder {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.review-card-content {
		flex: 1;
		min-width: 0;
	}

	.review-card-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.25rem;
	}

	.review-card-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-card-time {
		font-size: 0.7rem;
		color: var(--text-secondary);
		flex-shrink: 0;
		margin-left: 0.5rem;
	}

	.review-card-bottom {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
	}

	.review-card-status {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--text-secondary);
	}

	.status-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.review-card-claimed {
		font-size: 0.65rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
		opacity: 0.7;
		display: flex;
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

	.avatar-wrapper {
		position: relative;
		flex-shrink: 0;
	}

	.modmail-dot {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--status-info);
		border: 2px solid var(--surface);
		animation: modmail-pulse 2s ease-in-out infinite;
	}

	@keyframes modmail-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	@media (prefers-reduced-motion: reduce) {
		.modmail-dot { animation: none; }
	}

	.modmail-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.65rem;
		color: var(--status-info);
		margin-top: 0.25rem;
	}

	.review-card-stale {
		border-left: 3px solid var(--status-danger);
		background: oklch(0.25 0.04 25 / 0.15);
	}

	.review-card-stale.review-card-selected {
		background: oklch(0.3 0.05 25 / 0.2);
	}

	.stale-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.65rem;
		color: var(--status-danger);
		margin-top: 0.25rem;
	}

	@media (max-width: 767px) {
		.review-card {
			padding: 1rem 1.125rem;
		}
		.review-card:active {
			transform: scale(0.985);
			transition: transform 80ms;
		}
		.review-card-row {
			gap: 0.875rem;
		}
		.review-card-avatar,
		.review-card-avatar-placeholder {
			width: 52px;
			height: 52px;
		}
		.review-card-name {
			font-size: 0.9375rem;
		}
		.review-card-time {
			font-size: 0.75rem;
		}
	}
</style>
