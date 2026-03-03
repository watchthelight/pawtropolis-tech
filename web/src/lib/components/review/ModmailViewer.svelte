<script lang="ts">
	import type { ModmailThreadSummary } from '$lib/server/queries/modmail';

	let { threads }: {
		threads: ModmailThreadSummary[];
	} = $props();

	let expanded = $state(false);

	const totalMessages = $derived(threads.reduce((sum, t) => sum + t.messageCount, 0));
	const latestPreview = $derived.by(() => {
		const first = threads[0];
		if (!first?.latestMessage) return null;
		const msg = first.latestMessage;
		return msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
	});

	function formatTime(ms: number | null): string {
		if (!ms) return '';
		const d = new Date(ms);
		return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	function threadLabel(thread: ModmailThreadSummary): string {
		const status = thread.status === 'open' ? 'open' : 'closed';
		const date = thread.createdAt ? formatTime(thread.createdAt) : '';
		return `Thread (${status}${date ? ' · ' + date : ''})`;
	}
</script>

{#if threads.length > 0}
	<div class="modmail-section">
		<button
			class="modmail-header"
			aria-expanded={expanded}
			aria-controls="modmail-threads"
			onclick={() => expanded = !expanded}
		>
			<div class="modmail-summary">
				<span class="modmail-icon">💬</span>
				<span class="modmail-label">Modmail</span>
				<span class="modmail-meta">
					{threads.length} {threads.length === 1 ? 'thread' : 'threads'} · {totalMessages} {totalMessages === 1 ? 'msg' : 'msgs'}
				</span>
			</div>
			<span class="modmail-toggle">{expanded ? '▲' : '▼'}</span>
		</button>

		{#if !expanded && latestPreview}
			<div class="modmail-preview">{latestPreview}</div>
		{/if}

		{#if expanded}
			<div id="modmail-threads" class="modmail-threads">
				{#each threads as thread, i (thread.id)}
					{#if i > 0}
						<div class="thread-separator"></div>
					{/if}
					<div class="thread-block">
						<div class="thread-header">{threadLabel(thread)}</div>
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
			</div>
		{/if}
	</div>
{/if}

<style>
	.modmail-section {
		border-top: 1px solid var(--border-holdfast);
		padding-top: 1rem;
		margin-top: 1rem;
	}

	.modmail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--text-primary);
		font: inherit;
	}

	.modmail-header:hover .modmail-label {
		color: var(--accent);
	}

	.modmail-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.modmail-icon {
		font-size: 0.85rem;
	}

	.modmail-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		transition: color 150ms var(--ease-smooth);
	}

	.modmail-meta {
		font-size: 0.7rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	.modmail-toggle {
		font-size: 0.6rem;
		color: var(--text-secondary);
	}

	.modmail-preview {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-top: 0.375rem;
		padding-left: 1.35rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Threads ──────────────────────────────────────────── */
	.modmail-threads {
		margin-top: 0.75rem;
	}

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
</style>
