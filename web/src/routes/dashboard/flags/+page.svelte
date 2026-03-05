<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import { relativeTime } from '$lib/utils/time';
	import { slide } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	let flags = $derived(data.flags);

	// Search / sort / filter state
	let search = $state('');
	let sortBy = $state<'severity' | 'newest' | 'oldest' | 'name'>('severity');
	let filterType = $state<'all' | 'nsfw' | 'behavioral' | 'manual'>('all');

	// Expandable detail
	let expandedId = $state<string | null>(null);
	function toggleExpand(key: string) {
		expandedId = expandedId === key ? null : key;
	}

	// Avatar lightbox
	let lightboxUrl = $state<string | null>(null);
	function openLightbox(url: string) {
		// Get full-res from Discord CDN
		lightboxUrl = url.replace(/\?size=\d+/, '?size=4096');
		if (!lightboxUrl.includes('?')) lightboxUrl += '?size=4096';
	}
	function closeLightbox() { lightboxUrl = null; }
	function onLightboxKey(e: KeyboardEvent) { if (e.key === 'Escape') closeLightbox(); }

	// Dismiss
	let dismissing = $state<string | null>(null);
	async function dismissFlag(userId: string, flagType: string) {
		dismissing = userId + flagType;
		try {
			const res = await fetch('/api/flag/dismiss', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId: userId, flagType })
			});
			if (res.ok) {
				expandedId = null;
				await invalidateAll();
			}
		} catch { /* ignore */ }
		dismissing = null;
	}

	// Severity rank for sorting
	const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;

	// Filtered + sorted flags
	let processedFlags = $derived.by(() => {
		let result = flags;

		// Filter by type
		if (filterType === 'nsfw') result = result.filter((f: typeof flags[0]) => f.flagType === 'nsfw');
		else if (filterType === 'behavioral') result = result.filter((f: typeof flags[0]) => f.flagType === 'behavioral');
		else if (filterType === 'manual') result = result.filter((f: typeof flags[0]) => f.isManual);

		// Search
		if (search.trim()) {
			const q = search.trim().toLowerCase();
			result = result.filter((f: typeof flags[0]) =>
				f.displayName.toLowerCase().includes(q) ||
				f.reason.toLowerCase().includes(q) ||
				f.userId.includes(q)
			);
		}

		// Sort
		result = [...result].sort((a: typeof flags[0], b: typeof flags[0]) => {
			switch (sortBy) {
				case 'severity': {
					const d = SEV_RANK[a.severity] - SEV_RANK[b.severity];
					return d !== 0 ? d : b.flaggedAt - a.flaggedAt;
				}
				case 'newest': return b.flaggedAt - a.flaggedAt;
				case 'oldest': return a.flaggedAt - b.flaggedAt;
				case 'name': return a.displayName.localeCompare(b.displayName);
				default: return 0;
			}
		});

		return result;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onkeydown={lightboxUrl ? onLightboxKey : undefined} />

<SpringReveal stagger={30}>
	<PageHeader title="Flags" subtitle="Flagged user triage" badge={flags.length || undefined} />

	<!-- Toolbar -->
	<div class="toolbar">
		<input
			type="text"
			class="search-input"
			placeholder="Search name, reason, or ID..."
			bind:value={search}
		/>
		<select class="sort-select" bind:value={sortBy}>
			<option value="severity">Severity</option>
			<option value="newest">Newest</option>
			<option value="oldest">Oldest</option>
			<option value="name">Name A-Z</option>
		</select>
		<div class="filter-chips">
			{#each [['all', 'All'], ['nsfw', 'NSFW'], ['behavioral', 'Behavioral'], ['manual', 'Manual']] as [value, label]}
				<button
					class="chip"
					class:chip-active={filterType === value}
					onclick={() => filterType = value as typeof filterType}
				>{label}</button>
			{/each}
		</div>
	</div>

	{#if processedFlags.length === 0}
		<EmptyState
			message={search || filterType !== 'all' ? 'No matching flags' : 'No active flags'}
			subtitle={search || filterType !== 'all' ? 'Try adjusting your search or filters.' : 'All flagged users have been reviewed.'}
		/>
	{:else}
		<div class="flag-list">
			{#each processedFlags as flag (flag.userId + flag.flagType)}
				{@const key = flag.userId + flag.flagType}
				{@const isExpanded = expandedId === key}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="flag-row"
					class:flag-row-expanded={isExpanded}
					role="button"
					tabindex="0"
					onclick={() => toggleExpand(key)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(key); } }}
				>
					<div class="flag-summary">
						<div class="flag-avatar-col">
							{#if flag.avatarUrl}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<img
									src={flag.avatarUrl}
									alt={flag.displayName}
									class="flag-avatar"
									role="button"
									tabindex="-1"
									onclick={(e) => { e.stopPropagation(); openLightbox(flag.avatarUrl!); }}
								/>
							{:else}
								<div class="flag-avatar-ph">{flag.displayName.charAt(0).toUpperCase()}</div>
							{/if}
						</div>

						<div class="flag-info">
							<div class="flag-top">
								<span class="flag-name">{flag.displayName}</span>
								<div class="flag-badges">
									<span class="severity-dot" class:severity-high={flag.severity === 'high'} class:severity-medium={flag.severity === 'medium'} class:severity-low={flag.severity === 'low'}></span>
									<span class="flag-type-badge" class:flag-type-nsfw={flag.flagType === 'nsfw'} class:flag-type-behavioral={flag.flagType === 'behavioral'}>
										{flag.flagType === 'nsfw' ? 'NSFW' : 'Behavioral'}
									</span>
									{#if flag.flagType === 'nsfw' && flag.nsfwScore != null}
										<span class="nsfw-score">{Math.round(flag.nsfwScore * 100)}%</span>
									{/if}
									{#if flag.isManual}
										<span class="manual-badge">Manual</span>
									{/if}
								</div>
							</div>
							<div class="flag-bottom">
								<span class="flag-reason">{flag.reason}</span>
								<span class="flag-time">{relativeTime(flag.flaggedAt)}</span>
							</div>
							<div class="flag-uid" onclick={(e) => e.stopPropagation()}>
								<CopyableId value={flag.userId} />
							</div>
						</div>
					</div>

					<!-- Expanded detail -->
					{#if isExpanded}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div class="flag-detail" transition:slide={{ duration: 200 }} onclick={(e) => e.stopPropagation()}>
							<div class="detail-grid">
								<div class="detail-item">
									<span class="detail-label">Joined</span>
									<span class="detail-value">{flag.joinedAt ? relativeTime(flag.joinedAt) : 'Unknown'}</span>
								</div>
								<div class="detail-item">
									<span class="detail-label">First Message</span>
									<span class="detail-value">{flag.firstMessageAt ? relativeTime(flag.firstMessageAt) : 'None'}</span>
								</div>
								{#if flag.flaggedBy}
									<div class="detail-item">
										<span class="detail-label">Flagged By</span>
										<span class="detail-value" onclick={(e) => e.stopPropagation()}><CopyableId value={flag.flaggedBy} /></span>
									</div>
								{/if}
								{#if flag.flagType === 'nsfw' && flag.nsfwAvatarUrl}
									<div class="detail-item">
										<span class="detail-label">Flagged Avatar</span>
										<button class="nsfw-thumb" onclick={(e) => { e.stopPropagation(); openLightbox(flag.nsfwAvatarUrl!); }}>
											View
										</button>
									</div>
								{/if}
							</div>
							<div class="detail-actions">
								<button
									class="dismiss-btn"
									disabled={dismissing === key}
									onclick={(e) => { e.stopPropagation(); dismissFlag(flag.userId, flag.flagType); }}
								>
									{dismissing === key ? 'Dismissing...' : 'Dismiss'}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<p class="result-count">{processedFlags.length} of {flags.length} flags</p>
	{/if}
</SpringReveal>

<!-- Avatar lightbox -->
{#if lightboxUrl}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="lightbox" onclick={closeLightbox} transition:slide={{ duration: 150 }}>
		<img src={lightboxUrl} alt="Full resolution avatar" class="lightbox-img" />
	</div>
{/if}

<style>
	/* ─── Toolbar ─── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.search-input {
		flex: 1;
		min-width: 180px;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8rem;
		outline: none;
		transition: border-color 150ms var(--ease-smooth);
	}

	.search-input::placeholder {
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.search-input:focus {
		border-color: var(--accent);
	}

	.sort-select {
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8rem;
		cursor: pointer;
		outline: none;
	}

	.filter-chips {
		display: flex;
		gap: 0.25rem;
	}

	.chip {
		padding: 0.375rem 0.625rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.chip:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	.chip-active {
		color: var(--text-primary);
		background: var(--surface);
		box-shadow: var(--glow-accent);
	}

	/* ─── Flag list ─── */
	.flag-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.flag-row {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.flag-row-expanded {
		border-color: var(--accent-dim);
	}

	@media (hover: hover) {
		.flag-row:hover {
			background: var(--surface-raised);
		}
	}

	.flag-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
	}

	.flag-avatar-col {
		flex-shrink: 0;
	}

	.flag-avatar {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		cursor: zoom-in;
		transition: transform 150ms var(--ease-smooth);
	}

	.flag-avatar:hover {
		transform: scale(1.1);
	}

	.flag-avatar-ph {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.85rem;
	}

	.flag-info {
		flex: 1;
		min-width: 0;
	}

	.flag-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.2rem;
	}

	.flag-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.flag-badges {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.severity-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.severity-high {
		background: var(--status-danger);
		box-shadow: 0 0 6px var(--status-danger);
	}

	.severity-medium {
		background: var(--status-warning);
		box-shadow: 0 0 6px var(--status-warning);
	}

	.severity-low {
		background: var(--text-secondary);
	}

	.flag-type-badge {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
	}

	.flag-type-nsfw {
		background: oklch(25% 0.08 25);
		color: var(--status-danger);
	}

	.flag-type-behavioral {
		background: var(--tertiary-soft);
		color: var(--tertiary);
	}

	.nsfw-score {
		font-size: 0.6rem;
		font-weight: 700;
		color: var(--status-danger);
		font-variant-numeric: tabular-nums;
	}

	.manual-badge {
		font-size: 0.6rem;
		font-weight: 500;
		color: var(--text-secondary);
		padding: 0.1rem 0.3rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.flag-bottom {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.flag-reason {
		font-size: 0.75rem;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.flag-time {
		font-size: 0.7rem;
		color: var(--text-secondary);
		flex-shrink: 0;
		opacity: 0.7;
	}

	.flag-uid {
		margin-top: 0.15rem;
	}

	/* ─── Expanded detail ─── */
	.flag-detail {
		padding: 0 1rem 1rem;
		border-top: 1px solid var(--border);
		margin-top: 0;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 0.75rem;
		padding-top: 0.75rem;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.detail-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}

	.detail-value {
		font-size: 0.8rem;
		color: var(--text-primary);
	}

	.detail-actions {
		margin-top: 0.75rem;
		display: flex;
		gap: 0.5rem;
	}

	.dismiss-btn {
		padding: 0.375rem 1rem;
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text-primary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	.dismiss-btn:hover {
		border-color: var(--status-danger);
		color: var(--status-danger);
	}

	.dismiss-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.nsfw-thumb {
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--status-danger);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--status-danger);
		font-size: 0.7rem;
		cursor: pointer;
		transition: background 150ms;
	}

	.nsfw-thumb:hover {
		background: oklch(25% 0.08 25);
	}

	/* ─── Result count ─── */
	.result-count {
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.75rem;
		opacity: 0.6;
	}

	/* ─── Avatar lightbox ─── */
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: oklch(5% 0 0 / 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.lightbox-img {
		max-width: 90vw;
		max-height: 90vh;
		border-radius: var(--radius-md);
		box-shadow: 0 0 60px oklch(0% 0 0 / 0.5);
		cursor: default;
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.search-input {
			min-width: 0;
		}

		.filter-chips {
			flex-wrap: wrap;
		}
	}

	@media (max-width: 480px) {
		.flag-top {
			flex-wrap: wrap;
		}

		.flag-badges {
			flex-wrap: wrap;
		}
	}
</style>
