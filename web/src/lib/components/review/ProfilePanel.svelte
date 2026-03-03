<script lang="ts">
	interface ProfileData {
		bannerUrl?: string | null;
		accentColor?: number | null;
		joinedAt?: number | null;
		createdAt?: number | null;
		roles?: Array<{ id: string; name: string; color: string | null; position: number }>;
	}

	let {
		userId,
		avatarUrl = null,
		cachedProfile = null,
	}: {
		userId: string;
		avatarUrl?: string | null;
		cachedProfile?: { bannerUrl: string | null; accentColor: number | null; joinedAt: number | null; createdAt: number | null } | null;
	} = $props();

	let expanded = $state(false);
	let profile = $state<ProfileData | null>(cachedProfile);
	let loading = $state(false);
	let error = $state<string | null>(null);

	function relativeAge(ms: number | null): string {
		if (!ms) return 'Unknown';
		const diff = Date.now() - ms;
		const days = Math.floor(diff / 86_400_000);
		if (days < 1) return 'Today';
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		const years = Math.floor(months / 12);
		const rem = months % 12;
		return rem > 0 ? `${years}y ${rem}mo ago` : `${years}y ago`;
	}

	function dateStr(ms: number | null): string {
		if (!ms) return '';
		return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
			} else {
				profile = {
					bannerUrl: result.data.bannerUrl,
					accentColor: result.data.accentColor,
					joinedAt: result.data.joinedAt ? result.data.joinedAt * 1000 : null,
					createdAt: result.data.createdAt ? result.data.createdAt * 1000 : null,
					roles: result.data.roles,
				};
				expanded = true;
			}
		} catch {
			error = 'Failed to connect';
		} finally {
			loading = false;
		}
	}

	function accentHex(color: number | null): string {
		if (!color) return 'var(--accent)';
		return `#${color.toString(16).padStart(6, '0')}`;
	}
</script>

<div class="profile-section">
	<button class="profile-toggle" onclick={() => { if (!profile?.roles) fetchProfile(); else expanded = !expanded; }}>
		<span class="toggle-label">Profile</span>
		{#if loading}
			<span class="toggle-hint">Loading...</span>
		{:else if error}
			<span class="toggle-error">{error}</span>
		{:else}
			<span class="toggle-arrow" class:toggle-arrow-open={expanded}>&#9656;</span>
		{/if}
	</button>

	{#if expanded && profile}
		<div class="profile-body">
			<!-- Banner + Avatar -->
			{#if profile.bannerUrl}
				<div class="profile-banner">
					<img src={profile.bannerUrl} alt="Banner" class="banner-img" />
					{#if avatarUrl}
						<img src={avatarUrl} alt="Avatar" class="banner-avatar" />
					{/if}
				</div>
			{/if}

			<!-- Dates -->
			<div class="profile-dates">
				<div class="date-item">
					<span class="date-label">Account Created</span>
					<span class="date-value" title={dateStr(profile.createdAt)}>{relativeAge(profile.createdAt)}</span>
				</div>
				<div class="date-item">
					<span class="date-label">Server Joined</span>
					<span class="date-value" title={dateStr(profile.joinedAt)}>{relativeAge(profile.joinedAt)}</span>
				</div>
				{#if profile.accentColor}
					<div class="date-item">
						<span class="date-label">Accent</span>
						<span class="accent-swatch" style:background-color={accentHex(profile.accentColor)}></span>
					</div>
				{/if}
			</div>

			<!-- Roles -->
			{#if profile.roles && profile.roles.length > 0}
				<div class="profile-roles">
					{#each profile.roles as role}
						<span class="role-pill" style:border-color={role.color ?? 'var(--border-holdfast)'} style:color={role.color ?? 'var(--text-secondary)'}>
							{#if role.color}<span class="role-dot" style:background-color={role.color}></span>{/if}
							{role.name}
						</span>
					{/each}
				</div>
			{/if}

			<button class="btn-refresh" onclick={fetchProfile} disabled={loading}>
				{loading ? 'Refreshing...' : 'Refresh from Discord'}
			</button>
		</div>
	{/if}
</div>

<style>
	.profile-section {
		border-bottom: 1px solid var(--border-holdfast);
	}

	.profile-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem var(--space-card);
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition: color 150ms;
	}

	.profile-toggle:hover {
		color: var(--text-primary);
	}

	.toggle-label {
		flex: 1;
		text-align: left;
	}

	.toggle-hint {
		font-size: 0.65rem;
		font-weight: 400;
		opacity: 0.6;
	}

	.toggle-error {
		font-size: 0.65rem;
		font-weight: 400;
		color: var(--status-danger);
	}

	.toggle-arrow {
		font-size: 0.7rem;
		transition: transform 150ms;
	}

	.toggle-arrow-open {
		transform: rotate(90deg);
	}

	.profile-body {
		padding: 0 var(--space-card) var(--space-card);
	}

	.profile-banner {
		position: relative;
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-bottom: 0.75rem;
	}

	.banner-img {
		width: 100%;
		height: 80px;
		object-fit: cover;
		border-radius: var(--radius-sm);
	}

	.banner-avatar {
		position: absolute;
		bottom: -16px;
		left: 12px;
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		border: 2px solid var(--surface);
		object-fit: cover;
	}

	.profile-dates {
		display: flex;
		gap: 1.25rem;
		margin-bottom: 0.75rem;
	}

	.date-item {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.date-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	.date-value {
		font-size: 0.8rem;
		color: var(--text-primary);
		font-weight: 500;
	}

	.accent-swatch {
		width: 16px;
		height: 16px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
	}

	.profile-roles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-bottom: 0.75rem;
	}

	.role-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1px solid;
		font-size: 0.65rem;
		font-weight: 500;
		background: var(--surface-raised);
	}

	.role-dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.btn-refresh {
		padding: 0.35rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
		background: var(--surface-raised);
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms;
	}

	.btn-refresh:hover:not(:disabled) {
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.btn-refresh:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
