<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import { setBotOffline, setBotOnline, getBotOnline } from '$lib/stores/bot-status.svelte';
	import type { SSEEvent } from '$lib/types/events';

	let {
		threads,
		targetUserId = '',
		memberLeft = false
	}: {
		threads: ModmailThreadSummary[];
		targetUserId?: string;
		memberLeft?: boolean;
	} = $props();

	let messageInput = $state('');
	let sending = $state(false);
	let sendError = $state<string | null>(null);

	// Quick response templates
	const TEMPLATES = [
		{ label: 'Needs More Info', text: 'Hi! We need a bit more information before we can proceed with your application. Could you please clarify the following?' },
		{ label: 'Awaiting Response', text: 'Hi! Just following up on our previous message. Please respond when you get a chance so we can continue processing your application.' },
		{ label: 'Application Approved', text: 'Great news! Your application has been approved. Welcome to the community!' },
		{ label: 'Application Denied', text: 'Thank you for your interest, but we have decided not to approve your application at this time.' },
	];
	let showTemplates = $state(false);
	let actionLoading = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let panelEl: HTMLElement | undefined = $state();

	let botOnline = $derived(getBotOnline());

	// Find the open thread (if any) for send/close actions
	const openThread = $derived(threads.find(t => t.status === 'open'));
	// Most recent closed thread (for reopen)
	const recentClosedThread = $derived(threads.find(t => t.status === 'closed'));

	// Ticket closed > 7 days ago — reopen not possible, must open new thread
	const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
	const isStale = $derived(
		recentClosedThread
			? recentClosedThread.closedAt
				? Date.now() - recentClosedThread.closedAt > SEVEN_DAYS_MS
				: true // no closedAt on a closed ticket = treat as stale
			: false
	);

	function formatTime(ms: number | null): string {
		if (!ms) return '';
		const d = new Date(ms);
		return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function threadMeta(thread: ModmailThreadSummary): string {
		const status = thread.status === 'open' ? 'open' : 'closed';
		const date = thread.createdAt ? formatTime(thread.createdAt) : '';
		return `(${status}${date ? ' · ' + date : ''})`;
	}

	/** Scroll the last thread-messages container to its bottom */
	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (!panelEl) return;
			const containers = panelEl.querySelectorAll('.thread-messages');
			const last = containers[containers.length - 1] as HTMLElement | undefined;
			if (last) last.scrollTop = last.scrollHeight;
		});
	}

	/** Svelte action: scroll a container to its bottom on mount */
	function autoScrollEnd(node: HTMLElement) {
		requestAnimationFrame(() => {
			node.scrollTop = node.scrollHeight;
		});
	}

	async function handleSend() {
		if (!messageInput.trim() || !openThread || sending) return;
		sending = true;
		sendError = null;

		try {
			const res = await fetch('/api/modmail/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ticketId: openThread.id, content: messageInput.trim() })
			});
			const result = await res.json();
			if (!result.success) {
				sendError = result.error ?? 'Failed to send';
			} else {
				setBotOnline();
				openThread.messages = [
					...openThread.messages,
					{
						id: Date.now(),
						direction: 'to_user' as const,
						content: messageInput.trim(),
						createdAt: Date.now()
					}
				];
				openThread.messageCount++;
				messageInput = '';
				scrollToBottom();
			}
		} catch {
			sendError = 'Failed to connect';
			setBotOffline();
		} finally {
			sending = false;
		}
	}

	async function handleClose() {
		if (!openThread || actionLoading) return;
		actionLoading = 'close';
		actionError = null;

		try {
			const res = await fetch('/api/modmail/close', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ticketId: openThread.id })
			});
			const result = await res.json();
			if (!result.success) {
				actionError = result.error ?? 'Failed to close';
			} else {
				setBotOnline();
				openThread.status = 'closed';
			}
		} catch {
			actionError = 'Failed to connect';
			setBotOffline();
		} finally {
			actionLoading = null;
		}
	}

	async function handleReopen() {
		if (!recentClosedThread || actionLoading) return;
		actionLoading = 'reopen';
		actionError = null;

		try {
			const res = await fetch('/api/modmail/reopen', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ticketId: recentClosedThread.id })
			});
			const result = await res.json();
			if (!result.success) {
				actionError = result.error ?? 'Failed to reopen';
			} else {
				setBotOnline();
				recentClosedThread.status = 'open';
			}
		} catch {
			actionError = 'Failed to connect';
			setBotOffline();
		} finally {
			actionLoading = null;
		}
	}

	async function handleNewModmail() {
		if (!targetUserId || actionLoading) return;
		actionLoading = 'new';
		actionError = null;

		try {
			const res = await fetch('/api/modmail/open', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId })
			});
			const result = await res.json();
			if (!result.success) {
				actionError = result.error ?? 'Failed to open new thread';
			} else {
				setBotOnline();
				invalidateAll();
			}
		} catch {
			actionError = 'Failed to connect';
			setBotOffline();
		} finally {
			actionLoading = null;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	// SSE: auto-refresh when modmail events arrive from other sources
	function handleModmailEvent(_event: SSEEvent) {
		invalidateAll();
	}

	subscribe('modmail:*', handleModmailEvent);
	onDestroy(() => {
		unsubscribe('modmail:*', handleModmailEvent);
	});
</script>

<div class="modmail-panel" bind:this={panelEl}>
	{#if memberLeft}
		<div class="member-left-warning">
			<span class="member-left-icon">&#9888;</span>
			Member has left the server &mdash; messages cannot be delivered
		</div>
	{/if}

	<!-- Thread actions bar -->
	<div class="thread-actions">
		{#if openThread}
			<span class="thread-status thread-status-open">Open</span>
			<button class="action-btn action-btn-danger" onclick={handleClose} disabled={actionLoading !== null || !botOnline}>
				{actionLoading === 'close' ? 'Closing...' : !botOnline ? 'Bot offline' : 'Close Thread'}
			</button>
		{:else if recentClosedThread}
			<span class="thread-status thread-status-closed">Closed</span>
			<button class="action-btn" onclick={handleReopen} disabled={actionLoading !== null || !botOnline || isStale || memberLeft}>
				{actionLoading === 'reopen' ? 'Reopening...' : !botOnline ? 'Bot offline' : 'Reopen'}
			</button>
			<button class="action-btn action-btn-new" onclick={handleNewModmail} disabled={actionLoading !== null || !botOnline || memberLeft}>
				{actionLoading === 'new' ? 'Opening...' : !botOnline ? 'Bot offline' : 'New Modmail'}
			</button>
			{#if isStale}
				<span class="stale-hint">Ticket closed more than 7 days ago &mdash; open a new thread instead</span>
			{/if}
		{/if}
		{#if actionError}
			<span class="action-error">{actionError}</span>
		{/if}
	</div>

	<!-- Messages -->
	{#each threads as thread, i (thread.id)}
		{#if i > 0}
			<div class="thread-separator"></div>
		{/if}
		<div class="thread-block">
			<div class="thread-header">Thread <CopyableId value={String(thread.id)} label="#" /> {threadMeta(thread)}</div>
			<div class="thread-messages" use:autoScrollEnd>
				{#each thread.messages as msg (msg.id)}
					<div class="message" class:message-staff={msg.direction === 'to_user'} class:message-user={msg.direction === 'to_staff'}>
						<div class="message-bubble">
							<div class="message-content">{msg.content}</div>
						</div>
						<div class="message-time">{formatTime(msg.createdAt)}</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<!-- Message input (only when open thread exists and member is in server) -->
	{#if openThread && !memberLeft}
		<div class="send-bar">
			{#if showTemplates}
				<div class="template-dropdown">
					{#each TEMPLATES as tmpl}
						<button class="template-option" onclick={() => { messageInput = tmpl.text; showTemplates = false; }}>
							{tmpl.label}
						</button>
					{/each}
				</div>
			{/if}
			<div class="send-row">
				<button class="template-btn" onclick={() => showTemplates = !showTemplates} title="Quick responses" aria-label="Quick responses">
					<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
				</button>
			</div>
			<textarea
				class="send-input"
				placeholder={!botOnline ? 'Bot offline...' : 'Type a message...'}
				bind:value={messageInput}
				onkeydown={handleKeydown}
				disabled={sending || !botOnline}
				rows={1}
			></textarea>
			<button
				class="send-btn"
				onclick={handleSend}
				disabled={sending || !messageInput.trim() || !botOnline}
				title="Send message"
			>
				{#if sending}
					<span class="send-spinner"></span>
				{:else}
					<svg viewBox="0 0 20 20" fill="currentColor" class="send-icon"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
				{/if}
			</button>
			{#if sendError}
				<span class="send-error">{sendError}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.modmail-panel {
		padding-top: 0.25rem;
	}

	/* ── Member left warning ──────────────────────────────── */
	.member-left-warning {
		border: 1px solid var(--status-warning);
		border-left: 4px solid var(--status-warning);
		background: oklch(25% 0.04 85 / 0.3);
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--status-warning);
		margin-bottom: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.member-left-icon {
		font-size: 0.85rem;
	}

	/* ── Thread actions ────────────────────────────────────── */
	.thread-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-holdfast);
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.thread-status {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-pill);
	}

	.thread-status-open {
		background: oklch(0.45 0.15 145 / 0.2);
		color: var(--status-success);
	}

	.thread-status-closed {
		background: oklch(0.5 0 0 / 0.15);
		color: var(--text-secondary);
	}

	.action-btn {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.25rem 0.6rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
		background: var(--surface-raised);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms;
	}

	.action-btn:hover:not(:disabled) {
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action-btn-danger {
		color: var(--status-danger);
		border-color: var(--status-danger);
	}

	.action-btn-danger:hover:not(:disabled) {
		background: oklch(0.45 0.2 25 / 0.15);
		color: var(--status-danger);
		border-color: var(--status-danger);
	}

	.action-btn-new {
		color: var(--accent);
		border-color: var(--accent);
	}

	.action-btn-new:hover:not(:disabled) {
		background: var(--accent-dim);
		color: var(--accent);
		border-color: var(--accent);
	}

	.stale-hint {
		font-size: 0.6rem;
		color: var(--status-warning);
		flex-basis: 100%;
	}

	.action-error {
		font-size: 0.65rem;
		color: var(--status-danger);
	}

	/* ── Threads ──────────────────────────────────────────── */
	.thread-separator {
		height: 1px;
		background: var(--border-holdfast);
		margin: 0.75rem 0;
	}

	.thread-header {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.thread-messages {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-height: 400px;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	/* ── Messages ─────────────────────────────────────────── */
	.message {
		display: flex;
		flex-direction: column;
		max-width: 80%;
	}

	.message-user {
		align-self: flex-start;
	}

	.message-staff {
		align-self: flex-end;
	}

	.message-bubble {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
	}

	.message-user .message-bubble {
		background: var(--surface-raised);
		border-bottom-left-radius: var(--radius-sm);
	}

	.message-staff .message-bubble {
		background: var(--accent-dim);
		border-bottom-right-radius: var(--radius-sm);
	}

	.message-content {
		font-size: 0.85rem;
		color: var(--text-primary);
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.message-time {
		font-size: 0.6rem;
		color: var(--text-secondary);
		opacity: 0.6;
		margin-top: 0.125rem;
		padding: 0 0.25rem;
	}

	.message-staff .message-time {
		text-align: right;
	}

	/* ── Send bar ─────────────────────────────────────────── */
	.send-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-holdfast);
		position: relative;
	}

	.send-row {
		display: flex;
		align-items: center;
	}

	.template-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		padding: 0.375rem;
		cursor: pointer;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
	}

	.template-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.template-dropdown {
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 0.25rem;
		margin-bottom: 0.375rem;
		z-index: 10;
		box-shadow: var(--shadow-md);
	}

	.template-option {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 0.8rem;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background 0.1s ease;
	}

	.template-option:hover {
		background: var(--accent-dim);
	}

	.send-input {
		flex: 1;
		background: var(--surface-raised);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.85rem;
		resize: none;
		min-height: 2.25rem;
		max-height: 6rem;
		line-height: 1.4;
		transition: border-color 150ms;
	}

	.send-input::placeholder {
		color: var(--text-secondary);
		opacity: 0.5;
	}

	.send-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.send-input:disabled {
		opacity: 0.5;
	}

	.send-btn {
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: var(--radius-md);
		background: var(--accent);
		color: var(--surface);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: all 150ms;
	}

	.send-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.send-icon {
		width: 1rem;
		height: 1rem;
	}

	.send-spinner {
		width: 0.85rem;
		height: 0.85rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.send-error {
		position: absolute;
		bottom: -1.2rem;
		left: 0;
		font-size: 0.6rem;
		color: var(--status-danger);
	}

	@media (max-width: 767px) {
		.send-input {
			font-size: 16px; /* prevent iOS auto-zoom */
			min-height: 48px;
			padding: 0.625rem 0.875rem;
		}
		.thread-messages {
			max-height: 50vh;
		}
		.message {
			max-width: 88%;
		}
		.message-bubble {
			padding: 0.625rem 0.875rem;
		}
		.message-content {
			font-size: 0.9375rem;
			line-height: 1.5;
		}
		.send-bar {
			gap: 0.625rem;
			margin-top: 1rem;
		}
		.send-btn {
			min-height: 48px;
			min-width: 48px;
			width: 48px;
			height: 48px;
		}
		.action-btn {
			min-height: 40px;
			padding: 0.375rem 0.75rem;
		}
	}

	@media (hover: hover) {
		.send-btn:hover:not(:disabled) {
			filter: brightness(1.15);
		}
	}
</style>
