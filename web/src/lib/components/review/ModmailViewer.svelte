<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import { setBotOffline, setBotOnline, getBotOnline } from '$lib/stores/bot-status.svelte';
	import type { SSEEvent } from '$lib/types/events';

	let {
		threads,
		targetUserId = ''
	}: {
		threads: ModmailThreadSummary[];
		targetUserId?: string;
	} = $props();

	let messageInput = $state('');
	let sending = $state(false);
	let sendError = $state<string | null>(null);
	let actionLoading = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let messagesEnd: HTMLElement | undefined = $state();

	let botOnline = $derived(getBotOnline());

	// Find the open thread (if any) for send/close actions
	const openThread = $derived(threads.find(t => t.status === 'open'));
	// Most recent closed thread (for reopen)
	const recentClosedThread = $derived(threads.find(t => t.status === 'closed'));

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

	function scrollToBottom() {
		requestAnimationFrame(() => {
			messagesEnd?.scrollIntoView({ behavior: 'smooth' });
		});
	}

	onMount(() => scrollToBottom());

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

<div class="modmail-panel">
	<!-- Thread actions bar -->
	<div class="thread-actions">
		{#if openThread}
			<span class="thread-status thread-status-open">Open</span>
			<button class="action-btn action-btn-danger" onclick={handleClose} disabled={actionLoading !== null || !botOnline}>
				{actionLoading === 'close' ? 'Closing...' : !botOnline ? 'Bot offline' : 'Close Thread'}
			</button>
		{:else if recentClosedThread}
			<span class="thread-status thread-status-closed">Closed</span>
			<button class="action-btn" onclick={handleReopen} disabled={actionLoading !== null || !botOnline}>
				{actionLoading === 'reopen' ? 'Reopening...' : !botOnline ? 'Bot offline' : 'Reopen'}
			</button>
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
			<div class="thread-messages">
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
	<div bind:this={messagesEnd}></div>

	<!-- Message input (only when open thread exists) -->
	{#if openThread}
		<div class="send-bar">
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
		border-radius: 999px;
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
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-holdfast);
		position: relative;
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
		}
		.thread-messages {
			max-height: 300px;
		}
		.send-btn {
			min-height: 44px;
			min-width: 44px;
			width: 44px;
			height: 44px;
		}
	}

	@media (hover: hover) {
		.send-btn:hover:not(:disabled) {
			filter: brightness(1.15);
		}
	}
</style>
