<script lang="ts">
	import { openLightbox } from '$lib/stores/lightbox.svelte';

	interface ProfileData {
		bannerUrl?: string | null;
		accentColor?: number | null;
		joinedAt?: number | null;
		createdAt?: number | null;
		username?: string;
		globalName?: string | null;
		displayName?: string;
		avatarUrl?: string | null;
		bio?: string | null;
		status?: string | null;
		customStatus?: string | null;
		roles?: Array<{ id: string; name: string; color: string | null; position: number }>;
	}

	const STATUS_COLORS: Record<string, string> = {
		online: 'var(--status-success)',
		idle: 'var(--status-warning)',
		dnd: 'var(--status-danger)',
		offline: 'var(--text-secondary)'
	};

	let {
		userId,
		avatarUrl = null,
		applicantName = 'Unknown',
		cachedProfile = null,
		onMemberStatus
	}: {
		userId: string;
		avatarUrl?: string | null;
		applicantName?: string;
		cachedProfile?: { bannerUrl: string | null; accentColor: number | null; joinedAt: number | null; createdAt: number | null } | null;
		onMemberStatus?: (inServer: boolean) => void;
	} = $props();

	let profile = $state<ProfileData | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let lastFetchedId = $state('');
	let rolesExpanded = $state(false);

	function formatDate(ms: number | null): string {
		if (!ms) return '—';
		return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function accentHex(color: number | null): string {
		if (!color) return 'var(--accent)';
		return `#${color.toString(16).padStart(6, '0')}`;
	}

	async function fetchProfile() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/review/profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId: userId })
			});
			const result = await res.json();
			if (!result.success) {
				error = result.error ?? 'Failed to load';
				onMemberStatus?.(false);
			} else {
				profile = {
					bannerUrl: result.data.bannerUrl,
					accentColor: result.data.accentColor,
					joinedAt: result.data.joinedAt ? result.data.joinedAt * 1000 : null,
					createdAt: result.data.createdAt ? result.data.createdAt * 1000 : null,
					username: result.data.username,
					globalName: result.data.globalName,
					displayName: result.data.displayName,
					avatarUrl: result.data.avatarUrl,
					bio: result.data.bio ?? null,
					status: result.data.status ?? null,
					customStatus: result.data.customStatus ?? null,
					roles: result.data.roles
				};
				lastFetchedId = userId;
				onMemberStatus?.(result.data.memberInServer ?? true);
			}
		} catch {
			error = 'Failed to connect';
		} finally {
			loading = false;
		}
	}

	// Re-fetch when userId changes (clicking different apps in queue)
	$effect(() => {
		if (userId && userId !== lastFetchedId) {
			// Reset state for new user
			profile = cachedProfile ? { ...cachedProfile, avatarUrl, displayName: applicantName } : { avatarUrl, displayName: applicantName };
			rolesExpanded = false;
			fetchProfile();
		}
	});
</script>

<div class="dc-card">
	<!-- Banner -->
	<div class="dc-banner" style:background-color={profile?.bannerUrl ? undefined : accentHex(profile?.accentColor ?? null)}>
		{#if profile?.bannerUrl}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<img src={profile.bannerUrl} alt="" class="dc-banner-img" style="cursor: zoom-in" onclick={() => openLightbox(profile!.bannerUrl!)} />
		{/if}
	</div>

	<!-- Avatar with status indicator -->
	<div class="dc-avatar-row">
		<div class="dc-avatar-wrap">
			{#if profile?.avatarUrl || avatarUrl}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<img src={profile?.avatarUrl ?? avatarUrl} alt={applicantName} class="dc-avatar" style="cursor: zoom-in" onclick={() => openLightbox((profile?.avatarUrl ?? avatarUrl)!)} />
			{:else}
				<div class="dc-avatar dc-avatar-placeholder">{applicantName.charAt(0).toUpperCase()}</div>
			{/if}
			{#if profile?.status}
				<span class="dc-status-dot" style:background-color={STATUS_COLORS[profile.status] ?? STATUS_COLORS.offline} title={profile.status}></span>
			{/if}
		</div>
	</div>

	<!-- Identity -->
	<div class="dc-identity">
		<p class="dc-displayname">{profile?.displayName ?? applicantName}</p>
		{#if profile?.username}
			<p class="dc-username">@{profile.username}</p>
		{/if}
		{#if profile?.customStatus}
			<p class="dc-custom-status">{profile.customStatus}</p>
		{/if}
	</div>

	<!-- Bio -->
	{#if profile?.bio}
		<div class="dc-divider"></div>
		<div class="dc-section">
			<p class="dc-section-label">About Me</p>
			<p class="dc-bio">{profile.bio}</p>
		</div>
	{/if}

	<div class="dc-divider"></div>

	<!-- Member Since -->
	<div class="dc-section">
		<p class="dc-section-label">Member Since</p>
		<div class="dc-dates">
			<span class="dc-date" title="Server joined">
				<svg class="dc-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM6 4v5l4 2 .75-1.25L8 8V4H6z"/></svg>
				{formatDate(profile?.joinedAt ?? null)}
			</span>
			<span class="dc-date" title="Account created">
				<svg class="dc-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1V3a1 1 0 00-1-1zm-1 10H3V4h10v8z"/></svg>
				{formatDate(profile?.createdAt ?? null)}
			</span>
		</div>
	</div>

	<!-- Roles (collapsed by default) -->
	{#if profile?.roles && profile.roles.length > 0}
		<div class="dc-divider"></div>
		<div class="dc-section">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<p class="dc-section-label dc-section-label-toggle" onclick={() => rolesExpanded = !rolesExpanded}>
				Roles ({profile.roles.length})
				<span class="dc-expand-arrow" class:dc-expand-arrow-open={rolesExpanded}>&#9656;</span>
			</p>
			{#if rolesExpanded}
				<div class="dc-roles">
					{#each profile.roles as role}
						<span class="dc-role" style:border-color={role.color ?? 'var(--border-holdfast)'} style:color={role.color ?? 'var(--text-secondary)'}>
							{#if role.color}<span class="dc-role-dot" style:background-color={role.color}></span>{/if}
							{role.name}
						</span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Loading / Error / Refresh -->
	<div class="dc-footer">
		{#if loading}
			<span class="dc-loading">Loading...</span>
		{:else if error}
			<span class="dc-error">{error}</span>
		{/if}
		<button class="dc-refresh" onclick={fetchProfile} disabled={loading} title="Refresh from Discord">
			<svg class="dc-refresh-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M13.65 2.35A7.96 7.96 0 008 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 018 14 6 6 0 1114 8h-3l4-4z"/></svg>
		</button>
	</div>
</div>

<style>
	.dc-card {
		background: var(--surface);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-holdfast);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.dc-banner {
		height: 60px;
		overflow: hidden;
		flex-shrink: 0;
	}

	.dc-banner-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.dc-avatar-row {
		padding: 0 0.75rem;
		margin-top: -28px;
		position: relative;
		z-index: 1;
	}

	.dc-avatar-wrap {
		position: relative;
		display: inline-block;
	}

	.dc-avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		border: 3px solid var(--surface);
		object-fit: cover;
		background: var(--surface-raised);
	}

	.dc-avatar-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1.25rem;
		color: var(--accent);
		background: var(--accent-dim);
	}

	.dc-status-dot {
		position: absolute;
		bottom: 2px;
		right: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 3px solid var(--surface);
	}

	.dc-identity {
		padding: 0.25rem 0.75rem 0;
	}

	.dc-displayname {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.3;
	}

	.dc-username {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.dc-custom-status {
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin: 0.2rem 0 0;
		font-style: italic;
	}

	.dc-divider {
		height: 1px;
		background: var(--border-holdfast);
		margin: 0.5rem 0.75rem;
	}

	.dc-section {
		padding: 0 0.75rem;
	}

	.dc-section-label {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		margin: 0 0 0.35rem;
	}

	.dc-section-label-toggle {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		transition: color 150ms;
	}

	.dc-section-label-toggle:hover {
		color: var(--text-primary);
	}

	.dc-expand-arrow {
		font-size: 0.55rem;
		transition: transform 150ms;
	}

	.dc-expand-arrow-open {
		transform: rotate(90deg);
	}

	.dc-bio {
		font-size: 0.8rem;
		color: var(--text-primary);
		line-height: 1.4;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.dc-dates {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.dc-date {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.7rem;
		color: var(--text-primary);
	}

	.dc-icon {
		width: 0.75rem;
		height: 0.75rem;
		flex-shrink: 0;
		opacity: 0.6;
	}

	.dc-roles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.dc-role {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-pill);
		border: 1px solid;
		font-size: 0.6rem;
		font-weight: 500;
		background: var(--surface-raised);
	}

	.dc-role-dot {
		width: 0.35rem;
		height: 0.35rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dc-footer {
		padding: 0.5rem 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: auto;
	}

	.dc-loading, .dc-error {
		font-size: 0.65rem;
	}

	.dc-loading { color: var(--text-secondary); }
	.dc-error { color: var(--status-danger); }

	.dc-refresh {
		margin-left: auto;
		padding: 0.25rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms;
	}

	.dc-refresh:hover:not(:disabled) {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	.dc-refresh:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.dc-refresh-icon {
		width: 0.85rem;
		height: 0.85rem;
	}

	@media (max-width: 767px) {
		.dc-banner {
			height: 72px;
		}
		.dc-avatar {
			width: 60px;
			height: 60px;
		}
		.dc-avatar-row {
			margin-top: -30px;
		}
		.dc-displayname {
			font-size: 1.0625rem;
		}
		.dc-username {
			font-size: 0.8125rem;
		}
		.dc-identity {
			padding: 0.375rem 0.875rem 0;
		}
		.dc-section {
			padding: 0 0.875rem;
		}
		.dc-divider {
			margin: 0.625rem 0.875rem;
		}
		.dc-bio {
			font-size: 0.8125rem;
			line-height: 1.5;
		}
		.dc-date {
			font-size: 0.75rem;
			min-height: 28px;
		}
		.dc-role {
			font-size: 0.65rem;
			min-height: 28px;
		}
		.dc-section-label-toggle {
			min-height: 36px;
		}
		.dc-footer {
			padding: 0.5rem 0.875rem;
		}
		.dc-refresh {
			min-width: 44px;
			min-height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
		}
	}
</style>
