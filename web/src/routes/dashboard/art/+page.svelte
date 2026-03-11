<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';
	import type { ArtistItem, ArtJobItem, ArtJobHistoryItem, LeaderboardItem } from '$lib/server/queries/art';

	let { data } = $props();

	// ─── Reactive state (copies from server data, mutated optimistically) ───
	let queue = $state<ArtistItem[]>([...data.queue]);
	let activeJobs = $state<ArtJobItem[]>([...data.activeJobs]);
	let myJobs = $state<ArtJobItem[]>([...data.myJobs]);
	let jobHistory = $state<ArtJobHistoryItem[]>([...data.jobHistory]);
	let monthlyLeaderboard = $state<LeaderboardItem[]>([...data.monthlyLeaderboard]);
	let allTimeLeaderboard = $state<LeaderboardItem[]>([...data.allTimeLeaderboard]);

	const isStaff = data.isStaff;
	const isArtist = data.isArtist;

	// ─── Tabs ───
	type TabId = 'my-jobs' | 'queue' | 'jobs' | 'history' | 'stats';
	let activeTab = $state<TabId>(isStaff ? 'queue' : 'my-jobs');

	// ─── Status colors ───
	const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
		assigned:  { bg: 'var(--accent-dim)', text: 'var(--accent)' },
		sketching: { bg: 'oklch(30% 0.08 220)', text: 'oklch(75% 0.12 220)' },
		lining:    { bg: 'oklch(30% 0.08 280)', text: 'oklch(75% 0.12 280)' },
		coloring:  { bg: 'oklch(30% 0.08 330)', text: 'oklch(75% 0.12 330)' },
		done:      { bg: 'oklch(25% 0.06 145)', text: 'var(--status-success)' },
		cancelled: { bg: 'oklch(25% 0.04 0)',   text: 'var(--text-secondary)' }
	};
	const ACTIVE_STATUSES = ['assigned', 'sketching', 'lining', 'coloring'];

	function ticketLabel(type: string): string {
		switch (type) {
			case 'headshot': return 'Headshot';
			case 'halfbody': return 'Half Body';
			case 'fullbody': return 'Full Body';
			case 'emoji': return 'Emoji';
			default: return type;
		}
	}

	function formatDuration(start: number, end: number | null): string {
		if (!end) return '—';
		const ms = end - start;
		const days = Math.floor(ms / 86400000);
		const hours = Math.floor((ms % 86400000) / 3600000);
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h`;
		const mins = Math.floor(ms / 60000);
		return `${mins}m`;
	}

	// ─── Next-up ───
	let nextUpUserId = $derived(queue.find((a) => !a.skipped)?.userId ?? null);

	// ─── Per-row action state ───
	type ActionState = 'idle' | 'confirming' | 'entering-reason' | 'loading' | 'error';
	let rowStates = $state<Map<string, ActionState>>(new Map());
	let rowErrors = $state<Map<string, string>>(new Map());
	let rowInputs = $state<Map<string, string>>(new Map());

	function getRowState(id: string): ActionState {
		return rowStates.get(id) ?? 'idle';
	}
	function setRowState(id: string, state: ActionState) {
		rowStates = new Map(rowStates).set(id, state);
	}
	function setRowError(id: string, msg: string) {
		rowErrors = new Map(rowErrors).set(id, msg);
		setRowState(id, 'error');
	}
	function clearRow(id: string) {
		const s = new Map(rowStates); s.delete(id); rowStates = s;
		const e = new Map(rowErrors); e.delete(id); rowErrors = e;
		const i = new Map(rowInputs); i.delete(id); rowInputs = i;
	}
	function getRowInput(id: string): string { return rowInputs.get(id) ?? ''; }
	function setRowInput(id: string, val: string) {
		rowInputs = new Map(rowInputs).set(id, val);
	}

	// ─── Generic mutation helper ───
	async function mutate(
		url: string,
		body: Record<string, unknown>,
		rowId: string
	): Promise<Record<string, unknown> | null> {
		setRowState(rowId, 'loading');
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = await res.json();
			if (!json.success) {
				setRowError(rowId, json.error ?? 'Request failed');
				return null;
			}
			clearRow(rowId);
			return json.data;
		} catch {
			setRowError(rowId, 'Network error');
			return null;
		}
	}

	// ═══════════════════════════════════════════════════════════
	// QUEUE MANAGEMENT
	// ═══════════════════════════════════════════════════════════

	// Drag-and-drop state
	let dragUserId = $state<string | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function onDragStart(userId: string) {
		dragUserId = userId;
	}

	function onDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		dragOverIndex = index;
	}

	function onDragLeave() {
		dragOverIndex = null;
	}

	async function onDrop(targetIndex: number) {
		if (!dragUserId) return;
		const sourceIndex = queue.findIndex((a) => a.userId === dragUserId);
		if (sourceIndex === -1 || sourceIndex === targetIndex) {
			dragUserId = null;
			dragOverIndex = null;
			return;
		}

		// Optimistic update
		const newQueue = [...queue];
		const [moved] = newQueue.splice(sourceIndex, 1);
		newQueue.splice(targetIndex, 0, moved);
		// Fix positions
		newQueue.forEach((a, i) => { a.position = i + 1; });
		queue = newQueue;

		const uid = dragUserId;
		dragUserId = null;
		dragOverIndex = null;

		await mutate('/api/art/queue/reorder', { targetUserId: uid, newPosition: targetIndex + 1 }, uid);
		// On error the server has correct state; UI may be briefly out of sync but will resync on nav
	}

	async function skipArtist(userId: string) {
		const reason = getRowInput(userId);
		const prev = queue.find((a) => a.userId === userId);
		if (!prev) return;

		// Optimistic
		queue = queue.map((a) => a.userId === userId ? { ...a, skipped: true, skipReason: reason || null } : a);

		const result = await mutate('/api/art/queue/skip', { targetUserId: userId, reason: reason || undefined }, userId);
		if (!result) {
			// Revert
			queue = queue.map((a) => a.userId === userId ? prev : a);
		}
	}

	async function unskipArtist(userId: string) {
		const prev = queue.find((a) => a.userId === userId);
		if (!prev) return;

		// Optimistic
		queue = queue.map((a) => a.userId === userId ? { ...a, skipped: false, skipReason: null } : a);

		const result = await mutate('/api/art/queue/unskip', { targetUserId: userId }, userId);
		if (!result) {
			queue = queue.map((a) => a.userId === userId ? prev : a);
		}
	}

	async function removeArtist(userId: string) {
		const prev = [...queue];
		queue = queue.filter((a) => a.userId !== userId);

		const result = await mutate('/api/art/queue/remove', { targetUserId: userId }, userId);
		if (!result) {
			queue = prev;
		}
	}

	// Add artist search
	let addArtistOpen = $state(false);
	let addArtistQuery = $state('');
	let addArtistResults = $state<{ userId: string; displayName: string; avatarUrl: string | null }[]>([]);
	let addArtistDebounce: ReturnType<typeof setTimeout> | null = null;

	function onAddArtistInput(e: Event) {
		addArtistQuery = (e.target as HTMLInputElement).value;
		if (addArtistDebounce) clearTimeout(addArtistDebounce);
		if (addArtistQuery.length < 1) { addArtistResults = []; return; }
		addArtistDebounce = setTimeout(async () => {
			const res = await fetch(`/api/art/users/search?q=${encodeURIComponent(addArtistQuery)}&excludeArtists=true`);
			const json = await res.json();
			addArtistResults = json.data?.users ?? [];
		}, 250);
	}

	async function addArtist(userId: string, displayName: string) {
		addArtistOpen = false;
		addArtistQuery = '';
		addArtistResults = [];

		const result = await mutate('/api/art/queue/add', { targetUserId: userId }, `add-${userId}`);
		if (result) {
			const position = result.position as number;
			queue = [...queue, {
				userId,
				displayName,
				position,
				assignmentsCount: 0,
				lastAssignedAt: null,
				skipped: false,
				skipReason: null
			}];
		}
	}

	// ═══════════════════════════════════════════════════════════
	// JOB MANAGEMENT
	// ═══════════════════════════════════════════════════════════

	// Status dropdown
	let openStatusJobId = $state<number | null>(null);

	async function updateJobStatus(jobId: number, status: string) {
		openStatusJobId = null;
		const rowId = `job-${jobId}`;
		const targetJobs = isStaff ? activeJobs : myJobs;
		const prev = targetJobs.find((j) => j.id === jobId);
		if (!prev) return;

		// Optimistic update
		if (isStaff) {
			activeJobs = activeJobs.map((j) => j.id === jobId ? { ...j, status } : j);
		}
		myJobs = myJobs.map((j) => j.id === jobId ? { ...j, status } : j);

		const result = await mutate('/api/art/jobs/status', { jobId, status }, rowId);
		if (!result) {
			// Revert
			if (isStaff) activeJobs = activeJobs.map((j) => j.id === jobId ? prev : j);
			myJobs = myJobs.map((j) => j.id === jobId ? prev : j);
		}
	}

	async function finishJob(jobId: number) {
		const rowId = `job-${jobId}`;
		const targetJobs = isStaff ? activeJobs : myJobs;
		const job = targetJobs.find((j) => j.id === jobId);
		if (!job) return;

		// Optimistic remove
		if (isStaff) activeJobs = activeJobs.filter((j) => j.id !== jobId);
		myJobs = myJobs.filter((j) => j.id !== jobId);

		const result = await mutate('/api/art/jobs/finish', { jobId }, rowId);
		if (!result) {
			// Revert
			if (isStaff) activeJobs = [...activeJobs, job].sort((a, b) => b.assignedAt - a.assignedAt);
			myJobs = [...myJobs, job].sort((a, b) => b.assignedAt - a.assignedAt);
		}
	}

	async function cancelJob(jobId: number) {
		const rowId = `job-${jobId}`;
		const reason = getRowInput(rowId);
		const job = activeJobs.find((j) => j.id === jobId);
		if (!job) return;

		// Optimistic remove
		activeJobs = activeJobs.filter((j) => j.id !== jobId);

		const result = await mutate('/api/art/jobs/cancel', { jobId, reason: reason || undefined }, rowId);
		if (!result) {
			activeJobs = [...activeJobs, job].sort((a, b) => b.assignedAt - a.assignedAt);
		}
	}

	// ─── New Assignment Modal ───
	let assignModalOpen = $state(false);
	let assignArtistId = $state<string>('next');
	let assignRecipientId = $state<string | null>(null);
	let assignRecipientName = $state('');
	let assignTicketType = $state('headshot');
	let assignNotes = $state('');
	let assignLoading = $state(false);
	let assignError = $state<string | null>(null);

	// Recipient search
	let recipientQuery = $state('');
	let recipientResults = $state<{ userId: string; displayName: string }[]>([]);
	let recipientDebounce: ReturnType<typeof setTimeout> | null = null;

	function onRecipientInput(e: Event) {
		recipientQuery = (e.target as HTMLInputElement).value;
		assignRecipientId = null;
		if (recipientDebounce) clearTimeout(recipientDebounce);
		if (recipientQuery.length < 1) { recipientResults = []; return; }
		recipientDebounce = setTimeout(async () => {
			const res = await fetch(`/api/art/users/search?q=${encodeURIComponent(recipientQuery)}`);
			const json = await res.json();
			recipientResults = json.data?.users ?? [];
		}, 250);
	}

	function selectRecipient(userId: string, displayName: string) {
		assignRecipientId = userId;
		recipientQuery = displayName;
		recipientResults = [];
	}

	// Next-in-queue display name for modal
	let nextInQueueName = $derived(queue.find((a) => !a.skipped)?.displayName ?? 'Nobody');

	async function submitAssignment() {
		if (!assignRecipientId) { assignError = 'Select a recipient'; return; }
		assignLoading = true;
		assignError = null;

		try {
			const res = await fetch('/api/art/jobs/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					artistId: assignArtistId,
					recipientId: assignRecipientId,
					ticketType: assignTicketType,
					notes: assignNotes || undefined
				})
			});
			const json = await res.json();
			if (!json.success) {
				assignError = json.error ?? 'Failed to create assignment';
			} else {
				assignModalOpen = false;
				// Reset form
				assignArtistId = 'next';
				assignRecipientId = null;
				recipientQuery = '';
				assignTicketType = 'headshot';
				assignNotes = '';
				// Reload jobs - the new job will appear on next page load / SSE refresh
				// For now, add it optimistically (minimal data)
				const d = json.data as { jobId: number; jobNumber: number; artistJobNumber: number; artistId: string };
				const artist = queue.find((a) => a.userId === d.artistId);
				activeJobs = [{
					id: d.jobId,
					jobNumber: d.jobNumber,
					artistJobNumber: d.artistJobNumber,
					artistName: artist?.displayName ?? 'Artist',
					artistId: d.artistId,
					recipientName: recipientQuery,
					recipientId: assignRecipientId!,
					ticketType: assignTicketType,
					status: 'assigned',
					assignedAt: Date.now(),
					updatedAt: Date.now()
				}, ...activeJobs];

				// Update queue rotation: move assigned artist to end
				if (queue.length > 1) {
					const idx = queue.findIndex((a) => a.userId === d.artistId);
					if (idx !== -1 && idx !== queue.length - 1) {
						const newQ = [...queue];
						const [moved] = newQ.splice(idx, 1);
						newQ.push(moved);
						newQ.forEach((a, i) => { a.position = i + 1; });
						queue = newQ;
					}
				}
			}
		} catch {
			assignError = 'Network error';
		} finally {
			assignLoading = false;
		}
	}

	// ─── History filters ───
	let historyTypeFilter = $state('all');
	let historyStatusFilter = $state('all');

	let filteredHistory = $derived(jobHistory.filter((j) => {
		if (historyTypeFilter !== 'all' && j.ticketType !== historyTypeFilter) return false;
		if (historyStatusFilter !== 'all' && j.status !== historyStatusFilter) return false;
		return true;
	}));

	// ─── Close dropdowns on outside click ───
	function onWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.status-dropdown-wrap')) openStatusJobId = null;
		if (!target.closest('.add-artist-wrap')) { addArtistOpen = false; addArtistResults = []; }
	}
</script>

<svelte:window onclick={onWindowClick} />

<SpringReveal stagger={30}>
	<div class="header">
		<div>
			<PageHeader title="Art" subtitle={isStaff ? 'Artist queue and assignment management' : 'Your active art jobs'} />
		</div>

		<div class="header-actions">
			<div class="tab-bar" role="tablist">
				{#if isArtist}
					<button role="tab" aria-selected={activeTab === 'my-jobs'} class="tab" class:tab-active={activeTab === 'my-jobs'} onclick={() => activeTab = 'my-jobs'}>
						My Jobs
						{#if myJobs.length > 0}<span class="tab-count">{myJobs.length}</span>{/if}
					</button>
				{/if}
				{#if isStaff}
					<button role="tab" aria-selected={activeTab === 'queue'} class="tab" class:tab-active={activeTab === 'queue'} onclick={() => activeTab = 'queue'}>
						Queue
						{#if queue.length > 0}<span class="tab-count">{queue.length}</span>{/if}
					</button>
					<button role="tab" aria-selected={activeTab === 'jobs'} class="tab" class:tab-active={activeTab === 'jobs'} onclick={() => activeTab = 'jobs'}>
						Active Jobs
						{#if activeJobs.length > 0}<span class="tab-count">{activeJobs.length}</span>{/if}
					</button>
					<button role="tab" aria-selected={activeTab === 'history'} class="tab" class:tab-active={activeTab === 'history'} onclick={() => activeTab = 'history'}>
						History
					</button>
					<button role="tab" aria-selected={activeTab === 'stats'} class="tab" class:tab-active={activeTab === 'stats'} onclick={() => activeTab = 'stats'}>
						Stats
					</button>
				{/if}
			</div>

			{#if isStaff && activeTab === 'queue'}
				<div class="add-artist-wrap">
					<button class="btn-primary" onclick={() => addArtistOpen = !addArtistOpen}>+ Add Artist</button>
					{#if addArtistOpen}
						<div class="dropdown-panel">
							<input
								class="search-input"
								placeholder="Search users…"
								value={addArtistQuery}
								oninput={onAddArtistInput}
								autofocus
							/>
							{#if addArtistResults.length > 0}
								<div class="search-results">
									{#each addArtistResults as u (u.userId)}
										<button class="search-result-row" onclick={() => addArtist(u.userId, u.displayName)}>
											{u.displayName}
											<span class="uid-hint">…{u.userId.slice(-6)}</span>
										</button>
									{/each}
								</div>
							{:else if addArtistQuery.length > 0}
								<div class="search-empty">No users found</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if isStaff && activeTab === 'jobs'}
				<button class="btn-primary" onclick={() => assignModalOpen = true}>+ New Assignment</button>
			{/if}
		</div>
	</div>

	<!-- ══════════════════ MY JOBS TAB ══════════════════ -->
	{#if activeTab === 'my-jobs'}
		{#if myJobs.length === 0}
			<EmptyState message="No active jobs" subtitle="You have no active art jobs at the moment." />
		{:else}
			<div class="table-card">
				<div class="table-header jobs-header">
					<span class="col-job">#</span>
					<span class="col-name">Recipient</span>
					<span class="col-type">Type</span>
					<span class="col-job-status">Status</span>
					<span class="col-time">Assigned</span>
					<span class="col-actions">Actions</span>
				</div>
				{#each myJobs as job (job.id)}
					{@const colors = STATUS_COLORS[job.status] ?? STATUS_COLORS.assigned}
					{@const rowId = `job-${job.id}`}
					{@const rowState = getRowState(rowId)}
					<div class="table-row">
						<span class="col-job job-number">#{job.jobNumber}</span>
						<span class="col-name">{job.recipientName}</span>
						<span class="col-type"><span class="type-badge">{ticketLabel(job.ticketType)}</span></span>
						<span class="col-job-status">
							<div class="status-dropdown-wrap">
								<button
									class="status-badge status-badge-btn"
									style:background={colors.bg}
									style:color={colors.text}
									onclick={() => openStatusJobId = openStatusJobId === job.id ? null : job.id}
								>
									{job.status}
								</button>
								{#if openStatusJobId === job.id}
									<div class="status-dropdown">
										{#each ACTIVE_STATUSES as s}
											<button
												class="status-dropdown-item"
												class:status-dropdown-item-active={job.status === s}
												onclick={() => updateJobStatus(job.id, s)}
											>
												{s}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</span>
						<span class="col-time">{relativeTime(job.assignedAt)}</span>
						<span class="col-actions">
							{#if rowState === 'error'}
								<span class="inline-error">{rowErrors.get(rowId)}</span>
								<button class="btn-ghost-sm" onclick={() => clearRow(rowId)}>Dismiss</button>
							{:else if rowState === 'confirming'}
								<span class="confirm-text">Mark #{job.jobNumber} done?</span>
								<button class="btn-confirm" onclick={() => finishJob(job.id)}>Yes</button>
								<button class="btn-ghost-sm" onclick={() => clearRow(rowId)}>No</button>
							{:else if rowState === 'loading'}
								<span class="loading-text">…</span>
							{:else}
								<button class="btn-finish" title="Finish job" onclick={() => setRowState(rowId, 'confirming')}>✓</button>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- ══════════════════ QUEUE TAB ══════════════════ -->
	{#if activeTab === 'queue'}
		{#if queue.length === 0}
			<EmptyState message="No artists in queue" subtitle="The artist rotation queue is empty." />
		{:else}
			<div class="table-card">
				<div class="table-header queue-header">
					<span class="col-drag"></span>
					<span class="col-pos">#</span>
					<span class="col-name">Artist</span>
					<span class="col-count">Jobs</span>
					<span class="col-time">Last Assigned</span>
					<span class="col-status">Status</span>
					<span class="col-queue-actions">Actions</span>
				</div>
				{#each queue as artist, idx (artist.userId)}
					{@const rowState = getRowState(artist.userId)}
					<div
						class="table-row"
						class:row-next-up={artist.userId === nextUpUserId}
						class:row-skipped={artist.skipped}
						class:drag-over={dragOverIndex === idx}
						draggable="true"
						ondragstart={() => onDragStart(artist.userId)}
						ondragover={(e) => onDragOver(e, idx)}
						ondragleave={onDragLeave}
						ondrop={() => onDrop(idx)}
					>
						<span class="col-drag drag-handle" title="Drag to reorder">⠿</span>
						<span class="col-pos">{artist.position}</span>
						<span class="col-name">
							{artist.displayName}
							{#if artist.userId === nextUpUserId}
								<span class="next-badge">▶ Next</span>
							{/if}
						</span>
						<span class="col-count">{artist.assignmentsCount}</span>
						<span class="col-time">
							{artist.lastAssignedAt ? relativeTime(artist.lastAssignedAt) : 'Never'}
						</span>
						<span class="col-status">
							{#if artist.skipped}
								<span class="skip-badge">Skipped</span>
								{#if artist.skipReason}
									<span class="skip-reason">{artist.skipReason}</span>
								{/if}
							{:else}
								<span class="active-badge">Active</span>
							{/if}
						</span>
						<span class="col-queue-actions">
							{#if rowState === 'error'}
								<span class="inline-error">{rowErrors.get(artist.userId)}</span>
								<button class="btn-ghost-sm" onclick={() => clearRow(artist.userId)}>✕</button>
							{:else if rowState === 'confirming'}
								<span class="confirm-text">Remove {artist.displayName}?</span>
								<button class="btn-danger-sm" onclick={() => removeArtist(artist.userId)}>Yes</button>
								<button class="btn-ghost-sm" onclick={() => clearRow(artist.userId)}>No</button>
							{:else if rowState === 'entering-reason'}
								<input
									class="reason-input"
									placeholder="Skip reason (optional)"
									value={getRowInput(artist.userId)}
									oninput={(e) => setRowInput(artist.userId, (e.target as HTMLInputElement).value)}
								/>
								<button class="btn-confirm" onclick={() => skipArtist(artist.userId)}>Skip</button>
								<button class="btn-ghost-sm" onclick={() => clearRow(artist.userId)}>✕</button>
							{:else if rowState === 'loading'}
								<span class="loading-text">…</span>
							{:else if artist.skipped}
								<button class="btn-ghost-sm" onclick={() => unskipArtist(artist.userId)}>Resume</button>
								<button class="btn-ghost-sm" onclick={() => setRowState(artist.userId, 'confirming')}>Remove</button>
							{:else}
								<button class="btn-ghost-sm" onclick={() => setRowState(artist.userId, 'entering-reason')}>Skip</button>
								<button class="btn-ghost-sm" onclick={() => setRowState(artist.userId, 'confirming')}>Remove</button>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- ══════════════════ ACTIVE JOBS TAB ══════════════════ -->
	{#if activeTab === 'jobs'}
		{#if activeJobs.length === 0}
			<EmptyState message="No active jobs" subtitle="All art jobs are completed or cancelled." />
		{:else}
			<div class="table-card">
				<div class="table-header jobs-header">
					<span class="col-job">#</span>
					<span class="col-name">Artist</span>
					<span class="col-name">Recipient</span>
					<span class="col-type">Type</span>
					<span class="col-job-status">Status</span>
					<span class="col-time">Assigned</span>
					<span class="col-actions">Actions</span>
				</div>
				{#each activeJobs as job (job.id)}
					{@const colors = STATUS_COLORS[job.status] ?? STATUS_COLORS.assigned}
					{@const rowId = `job-${job.id}`}
					{@const rowState = getRowState(rowId)}
					<div class="table-row">
						<span class="col-job job-number">#{job.jobNumber}</span>
						<span class="col-name">{job.artistName}</span>
						<span class="col-name">{job.recipientName}</span>
						<span class="col-type"><span class="type-badge">{ticketLabel(job.ticketType)}</span></span>
						<span class="col-job-status">
							<div class="status-dropdown-wrap">
								<button
									class="status-badge status-badge-btn"
									style:background={colors.bg}
									style:color={colors.text}
									onclick={() => openStatusJobId = openStatusJobId === job.id ? null : job.id}
								>
									{job.status}
								</button>
								{#if openStatusJobId === job.id}
									<div class="status-dropdown">
										{#each ACTIVE_STATUSES as s}
											<button
												class="status-dropdown-item"
												class:status-dropdown-item-active={job.status === s}
												onclick={() => updateJobStatus(job.id, s)}
											>
												{s}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</span>
						<span class="col-time">{relativeTime(job.assignedAt)}</span>
						<span class="col-actions">
							{#if rowState === 'error'}
								<span class="inline-error">{rowErrors.get(rowId)}</span>
								<button class="btn-ghost-sm" onclick={() => clearRow(rowId)}>Dismiss</button>
							{:else if rowState === 'confirming'}
								<span class="confirm-text">Mark #{job.jobNumber} done?</span>
								<button class="btn-confirm" onclick={() => finishJob(job.id)}>Yes</button>
								<button class="btn-ghost-sm" onclick={() => clearRow(rowId)}>No</button>
							{:else if rowState === 'entering-reason'}
								<input
									class="reason-input"
									placeholder="Cancel reason (optional)"
									value={getRowInput(rowId)}
									oninput={(e) => setRowInput(rowId, (e.target as HTMLInputElement).value)}
								/>
								<button class="btn-danger-sm" onclick={() => cancelJob(job.id)}>Cancel Job</button>
								<button class="btn-ghost-sm" onclick={() => clearRow(rowId)}>✕</button>
							{:else if rowState === 'loading'}
								<span class="loading-text">…</span>
							{:else}
								<button class="btn-finish" title="Finish job" onclick={() => setRowState(rowId, 'confirming')}>✓</button>
								<button class="btn-cancel" title="Cancel job" onclick={() => setRowState(rowId, 'entering-reason')}>✕</button>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- ══════════════════ HISTORY TAB ══════════════════ -->
	{#if activeTab === 'history'}
		<div class="filter-bar">
			<div class="filter-pills">
				<span class="filter-label">Type:</span>
				{#each ['all', 'headshot', 'halfbody', 'fullbody', 'emoji'] as t}
					<button
						class="filter-pill"
						class:filter-pill-active={historyTypeFilter === t}
						onclick={() => historyTypeFilter = t}
					>
						{t === 'all' ? 'All' : ticketLabel(t)}
					</button>
				{/each}
			</div>
			<div class="filter-pills">
				<span class="filter-label">Status:</span>
				{#each ['all', 'done', 'cancelled'] as s}
					<button
						class="filter-pill"
						class:filter-pill-active={historyStatusFilter === s}
						onclick={() => historyStatusFilter = s}
					>
						{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
					</button>
				{/each}
			</div>
		</div>

		{#if filteredHistory.length === 0}
			<EmptyState message="No history" subtitle="No completed or cancelled jobs match your filters." />
		{:else}
			<div class="table-card">
				<div class="table-header history-header">
					<span class="col-job">#</span>
					<span class="col-name">Artist</span>
					<span class="col-name">Recipient</span>
					<span class="col-type">Type</span>
					<span class="col-job-status">Status</span>
					<span class="col-time">Started</span>
					<span class="col-time">Completed</span>
					<span class="col-duration">Duration</span>
				</div>
				{#each filteredHistory as job (job.id)}
					{@const colors = STATUS_COLORS[job.status] ?? STATUS_COLORS.done}
					<div class="table-row">
						<span class="col-job job-number">#{job.jobNumber}</span>
						<span class="col-name">{job.artistName}</span>
						<span class="col-name">{job.recipientName}</span>
						<span class="col-type"><span class="type-badge">{ticketLabel(job.ticketType)}</span></span>
						<span class="col-job-status">
							<span class="status-badge" style:background={colors.bg} style:color={colors.text}>
								{job.status}
							</span>
						</span>
						<span class="col-time">{relativeTime(job.assignedAt)}</span>
						<span class="col-time">{job.completedAt ? relativeTime(job.completedAt) : '—'}</span>
						<span class="col-duration">{formatDuration(job.assignedAt, job.completedAt)}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- ══════════════════ STATS TAB ══════════════════ -->
	{#if activeTab === 'stats'}
		<div class="stats-grid">
			<div class="stats-card">
				<div class="stats-card-title">This Month</div>
				{#if monthlyLeaderboard.length === 0}
					<div class="stats-empty">No completed jobs this month.</div>
				{:else}
					{#each monthlyLeaderboard as entry, i}
						<div class="leaderboard-row">
							<span class="rank">{i + 1}</span>
							<span class="lb-name">{entry.artistName}</span>
							<span class="lb-count">{entry.completedCount}</span>
						</div>
					{/each}
				{/if}
			</div>
			<div class="stats-card">
				<div class="stats-card-title">All Time</div>
				{#if allTimeLeaderboard.length === 0}
					<div class="stats-empty">No completed jobs yet.</div>
				{:else}
					{#each allTimeLeaderboard as entry, i}
						<div class="leaderboard-row">
							<span class="rank">{i + 1}</span>
							<span class="lb-name">{entry.artistName}</span>
							<span class="lb-count">{entry.completedCount}</span>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</SpringReveal>

<!-- ══════════════════ NEW ASSIGNMENT MODAL ══════════════════ -->
{#if assignModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) assignModalOpen = false; }}>
		<div class="modal">
			<div class="modal-header">
				<h2 class="modal-title">New Assignment</h2>
				<button class="modal-close" onclick={() => assignModalOpen = false}>✕</button>
			</div>

			<div class="modal-body">
				<!-- Artist selector -->
				<label class="form-label">Artist</label>
				<select class="form-select" bind:value={assignArtistId}>
					<option value="next">Next in Queue (→ {nextInQueueName})</option>
					{#each queue as a (a.userId)}
						<option value={a.userId}>{a.position}. {a.displayName}{a.skipped ? ' (skipped)' : ''}</option>
					{/each}
				</select>

				<!-- Recipient search -->
				<label class="form-label">Recipient</label>
				<div class="recipient-wrap">
					<input
						class="form-input"
						placeholder="Search for a user…"
						value={recipientQuery}
						oninput={onRecipientInput}
					/>
					{#if recipientResults.length > 0}
						<div class="search-results search-results-modal">
							{#each recipientResults as u (u.userId)}
								<button class="search-result-row" onclick={() => selectRecipient(u.userId, u.displayName)}>
									{u.displayName}
									<span class="uid-hint">…{u.userId.slice(-6)}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Ticket type -->
				<label class="form-label">Ticket Type</label>
				<div class="ticket-type-pills">
					{#each ['headshot', 'halfbody', 'fullbody', 'emoji'] as t}
						<button
							class="ticket-pill"
							class:ticket-pill-active={assignTicketType === t}
							onclick={() => assignTicketType = t}
						>
							{ticketLabel(t)}
						</button>
					{/each}
				</div>

				<!-- Notes -->
				<label class="form-label">Notes <span class="optional-label">(optional)</span></label>
				<textarea class="form-textarea" placeholder="Any notes for the artist…" bind:value={assignNotes} rows="2"></textarea>

				{#if assignError}
					<div class="modal-error">{assignError}</div>
				{/if}
			</div>

			<div class="modal-footer">
				<button class="btn-ghost" onclick={() => assignModalOpen = false}>Cancel</button>
				<button class="btn-primary" onclick={submitAssignment} disabled={assignLoading}>
					{assignLoading ? 'Assigning…' : 'Assign'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ─── Header ─── */
	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.25rem;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	/* ─── Tabs ─── */
	.tab-bar {
		display: flex;
		gap: 0.25rem;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.tab:hover { color: var(--text-primary); background: var(--surface-raised); }
	}
	.tab:active { background: var(--surface-raised); }
	.tab-active { color: var(--text-primary); background: var(--surface); box-shadow: var(--glow-accent); }

	.tab-count {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	/* ─── Table card ─── */
	.table-card {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.table-header {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--border-holdfast);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}

	.table-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.85rem;
		color: var(--text-primary);
		align-items: center;
		transition: background 150ms var(--ease-smooth);
	}

	.table-row:last-child { border-bottom: none; }

	@media (hover: hover) {
		.table-row:hover { background: var(--surface-raised); }
	}

	/* ─── Column sizes ─── */
	.col-pos { width: 2.5rem; flex-shrink: 0; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
	.col-drag { width: 1.25rem; flex-shrink: 0; }
	.col-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 0.375rem; }
	.col-count { width: 3.5rem; flex-shrink: 0; text-align: right; font-variant-numeric: tabular-nums; }
	.col-time { width: 7rem; flex-shrink: 0; text-align: right; font-size: 0.75rem; color: var(--text-secondary); }
	.col-status { width: 8rem; flex-shrink: 0; display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
	.col-queue-actions { width: 12rem; flex-shrink: 0; display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
	.col-job { width: 3.5rem; flex-shrink: 0; font-variant-numeric: tabular-nums; }
	.job-number { font-weight: 600; color: var(--text-secondary); }
	.col-type { width: 5.5rem; flex-shrink: 0; }
	.col-job-status { width: 6rem; flex-shrink: 0; }
	.col-actions { width: 13rem; flex-shrink: 0; display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
	.col-duration { width: 5rem; flex-shrink: 0; text-align: right; font-size: 0.75rem; color: var(--text-secondary); }

	/* ─── Drag-and-drop ─── */
	.drag-handle { cursor: grab; color: var(--text-secondary); font-size: 1rem; user-select: none; }
	.drag-handle:active { cursor: grabbing; }
	.drag-over { border-top: 2px solid var(--accent); }

	/* ─── Next-up row ─── */
	.row-next-up { background: var(--accent-dim); border-left: 3px solid var(--accent); }
	.next-badge {
		font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
		padding: 0.1rem 0.35rem; border-radius: var(--radius-sm);
		background: var(--accent-dim); color: var(--accent); flex-shrink: 0;
	}

	/* ─── Skipped row ─── */
	.row-skipped { opacity: 0.55; }

	/* ─── Badges ─── */
	.skip-badge {
		font-size: 0.65rem; font-weight: 600; padding: 0.1rem 0.35rem; border-radius: var(--radius-sm);
		background: oklch(25% 0.04 0); color: var(--text-secondary);
	}
	.skip-reason { font-size: 0.65rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.active-badge {
		font-size: 0.65rem; font-weight: 600; padding: 0.1rem 0.35rem; border-radius: var(--radius-sm);
		background: oklch(25% 0.06 145); color: var(--status-success);
	}
	.type-badge {
		font-size: 0.7rem; font-weight: 500; padding: 0.125rem 0.375rem; border-radius: var(--radius-sm);
		background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border);
	}
	.status-badge {
		font-size: 0.65rem; font-weight: 600; text-transform: capitalize;
		padding: 0.125rem 0.375rem; border-radius: var(--radius-sm);
	}
	.status-badge-btn {
		cursor: pointer; border: none;
		transition: opacity 150ms; white-space: nowrap;
	}
	.status-badge-btn:hover { opacity: 0.8; }

	/* ─── Status dropdown ─── */
	.status-dropdown-wrap { position: relative; }
	.status-dropdown {
		position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
		background: var(--surface-raised); border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-sm); overflow: hidden; min-width: 7rem;
		box-shadow: 0 4px 16px oklch(0% 0 0 / 0.3);
	}
	.status-dropdown-item {
		display: block; width: 100%; padding: 0.375rem 0.75rem;
		text-align: left; background: none; border: none; cursor: pointer;
		font-size: 0.8rem; color: var(--text-secondary); text-transform: capitalize;
		transition: background 100ms;
	}
	.status-dropdown-item:hover { background: var(--surface); color: var(--text-primary); }
	.status-dropdown-item-active { color: var(--accent); font-weight: 600; }

	/* ─── Inline actions ─── */
	.confirm-text { font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; }
	.loading-text { font-size: 0.75rem; color: var(--text-secondary); }
	.inline-error { font-size: 0.7rem; color: var(--status-error, oklch(65% 0.2 25)); }
	.reason-input {
		flex: 1; min-width: 0; padding: 0.25rem 0.5rem; font-size: 0.75rem;
		background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius-sm);
		color: var(--text-primary);
	}

	/* ─── Buttons ─── */
	.btn-primary {
		padding: 0.375rem 0.875rem; border: none; border-radius: var(--radius-sm);
		background: var(--accent); color: var(--bg); font-size: 0.8rem; font-weight: 600;
		cursor: pointer; transition: opacity 150ms; white-space: nowrap;
	}
	.btn-primary:hover { opacity: 0.85; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-ghost {
		padding: 0.375rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-sm);
		background: transparent; color: var(--text-secondary); font-size: 0.8rem; cursor: pointer;
		transition: all 150ms;
	}
	.btn-ghost:hover { color: var(--text-primary); border-color: var(--accent); }

	.btn-ghost-sm {
		padding: 0.2rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm);
		background: transparent; color: var(--text-secondary); font-size: 0.7rem; cursor: pointer;
		transition: all 100ms; white-space: nowrap;
	}
	.btn-ghost-sm:hover { color: var(--text-primary); }

	.btn-confirm {
		padding: 0.2rem 0.5rem; border: none; border-radius: var(--radius-sm);
		background: oklch(25% 0.06 145); color: var(--status-success);
		font-size: 0.7rem; font-weight: 600; cursor: pointer; white-space: nowrap;
	}

	.btn-danger-sm {
		padding: 0.2rem 0.5rem; border: none; border-radius: var(--radius-sm);
		background: oklch(25% 0.08 25); color: oklch(70% 0.18 25);
		font-size: 0.7rem; font-weight: 600; cursor: pointer; white-space: nowrap;
	}

	.btn-finish {
		padding: 0.2rem 0.45rem; border: none; border-radius: var(--radius-sm);
		background: oklch(25% 0.06 145); color: var(--status-success);
		font-size: 0.75rem; cursor: pointer; transition: opacity 150ms;
	}
	.btn-finish:hover { opacity: 0.8; }

	.btn-cancel {
		padding: 0.2rem 0.45rem; border: none; border-radius: var(--radius-sm);
		background: oklch(25% 0.04 0); color: var(--text-secondary);
		font-size: 0.75rem; cursor: pointer; transition: opacity 150ms;
	}
	.btn-cancel:hover { opacity: 0.8; }

	/* ─── Add artist dropdown ─── */
	.add-artist-wrap { position: relative; }
	.dropdown-panel {
		position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
		background: var(--surface-raised); border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md); padding: 0.5rem; min-width: 16rem;
		box-shadow: 0 8px 24px oklch(0% 0 0 / 0.35);
	}
	.search-input {
		width: 100%; padding: 0.375rem 0.625rem; font-size: 0.85rem;
		background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
		color: var(--text-primary); outline: none;
	}
	.search-input:focus { border-color: var(--accent); }
	.search-results { margin-top: 0.375rem; }
	.search-results-modal { position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 40; background: var(--surface-raised); border: 1px solid var(--border-holdfast); border-radius: var(--radius-sm); box-shadow: 0 4px 16px oklch(0% 0 0 / 0.3); }
	.search-result-row {
		display: flex; align-items: center; justify-content: space-between;
		width: 100%; padding: 0.375rem 0.625rem;
		background: none; border: none; border-radius: var(--radius-sm);
		cursor: pointer; color: var(--text-primary); font-size: 0.82rem; text-align: left;
		transition: background 100ms;
	}
	.search-result-row:hover { background: var(--surface); }
	.search-empty { padding: 0.5rem 0.625rem; font-size: 0.8rem; color: var(--text-secondary); }
	.uid-hint { font-size: 0.7rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

	/* ─── Filter bar ─── */
	.filter-bar { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
	.filter-pills { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
	.filter-label { font-size: 0.75rem; color: var(--text-secondary); font-weight: 500; margin-right: 0.25rem; }
	.filter-pill {
		padding: 0.2rem 0.6rem; border: 1px solid var(--border); border-radius: 999px;
		background: transparent; color: var(--text-secondary); font-size: 0.75rem; cursor: pointer;
		transition: all 150ms;
	}
	.filter-pill:hover { border-color: var(--accent); color: var(--text-primary); }
	.filter-pill-active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); font-weight: 600; }

	/* ─── Stats ─── */
	.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
	@media (max-width: 640px) { .stats-grid { grid-template-columns: 1fr; } }

	.stats-card {
		background: var(--surface); border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md); padding: 1.25rem; overflow: hidden;
	}
	.stats-card-title {
		font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.08em; color: var(--text-secondary); margin-bottom: 0.875rem;
	}
	.stats-empty { font-size: 0.82rem; color: var(--text-secondary); }
	.leaderboard-row {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.5rem 0; border-bottom: 1px solid var(--border);
		font-size: 0.85rem;
	}
	.leaderboard-row:last-child { border-bottom: none; }
	.rank { width: 1.5rem; font-weight: 700; color: var(--text-secondary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
	.lb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.lb-count { font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }

	/* ─── Modal ─── */
	.modal-backdrop {
		position: fixed; inset: 0; z-index: 100;
		background: oklch(5% 0.01 var(--hue, 220) / 0.7);
		backdrop-filter: blur(4px);
		display: flex; align-items: center; justify-content: center; padding: 1rem;
	}
	.modal {
		background: var(--surface); border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-lg, var(--radius-md)); width: 100%; max-width: 28rem;
		box-shadow: 0 16px 48px oklch(0% 0 0 / 0.5);
		display: flex; flex-direction: column; max-height: 90vh;
	}
	.modal-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 1.25rem 1.5rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.modal-title { font-size: 1rem; font-weight: 700; color: var(--text-primary); margin: 0; }
	.modal-close {
		width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
		background: var(--surface-raised); color: var(--text-secondary);
		cursor: pointer; font-size: 0.75rem;
		display: flex; align-items: center; justify-content: center;
		transition: all 150ms;
	}
	.modal-close:hover { background: var(--surface); color: var(--text-primary); }
	.modal-body { padding: 1.25rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; }
	.modal-footer { padding: 1rem 1.5rem; border-top: 1px solid var(--border); display: flex; gap: 0.75rem; justify-content: flex-end; }
	.modal-error { font-size: 0.8rem; color: oklch(65% 0.2 25); padding: 0.375rem 0.625rem; background: oklch(20% 0.05 25); border-radius: var(--radius-sm); }

	/* ─── Form elements ─── */
	.form-label { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
	.optional-label { font-weight: 400; text-transform: none; letter-spacing: 0; }
	.form-select, .form-input, .form-textarea {
		width: 100%; padding: 0.5rem 0.75rem; font-size: 0.875rem;
		background: var(--surface-raised); border: 1px solid var(--border);
		border-radius: var(--radius-sm); color: var(--text-primary); outline: none;
		transition: border-color 150ms;
	}
	.form-select:focus, .form-input:focus, .form-textarea:focus { border-color: var(--accent); }
	.form-textarea { resize: vertical; font-family: inherit; }

	.recipient-wrap { position: relative; }

	.ticket-type-pills { display: flex; gap: 0.375rem; flex-wrap: wrap; }
	.ticket-pill {
		padding: 0.375rem 0.875rem; border: 1px solid var(--border); border-radius: var(--radius-sm);
		background: transparent; color: var(--text-secondary); font-size: 0.8rem; cursor: pointer;
		transition: all 150ms;
	}
	.ticket-pill:hover { border-color: var(--accent); color: var(--text-primary); }
	.ticket-pill-active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); font-weight: 600; }

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.header { flex-direction: column; }
		.col-time { display: none; }
		.col-count { width: 2.5rem; }
		.jobs-header .col-name:nth-child(3),
		.table-row .col-name:nth-child(3) { display: none; }
		.tab { min-height: 44px; }
	}

	@media (max-width: 480px) {
		.col-status { width: auto; }
		.col-type { display: none; }
		.col-duration { display: none; }
		.col-queue-actions { width: auto; }
		.col-actions { width: auto; }
	}
</style>
