<script lang="ts">
	import { onMount, tick } from 'svelte';

	interface Channel { id: string; name: string; type: number; parentId: string | null }
	interface Role { id: string; name: string; color: number; position: number; mentionable: boolean }
	interface Token { value: string; label: string; hint: string }

	interface Props {
		value: string;
		channels: Channel[];
		roles: Role[];
	}

	let { value = $bindable(''), channels, roles }: Props = $props();

	const TOKENS: Token[] = [
		{ value: '{applicant.mention}', label: 'applicant.mention', hint: 'pings the new member' },
		{ value: '{applicant.tag}', label: 'applicant.tag', hint: 'username#0000' },
		{ value: '{applicant.display}', label: 'applicant.display', hint: 'nickname' },
		{ value: '{guild.name}', label: 'guild.name', hint: 'server name' }
	];

	const channelById = $derived(new Map(channels.map((c) => [c.id, c])));
	const roleById = $derived(new Map(roles.map((r) => [r.id, r])));

	// ─── Editor state ───────────────────────────────────────────────────────
	let editorEl: HTMLDivElement | null = $state(null);
	let mounted = $state(false);

	// ─── Autocomplete state ─────────────────────────────────────────────────
	type Suggestion =
		| { kind: 'channel'; id: string; name: string }
		| { kind: 'role'; id: string; name: string; color: number }
		| { kind: 'token'; value: string; label: string; hint: string };

	let acOpen = $state(false);
	let acTrigger = $state<'#' | '@' | '{' | null>(null);
	let acQuery = $state('');
	let acIndex = $state(0);
	let acAnchor = $state<{ x: number; y: number } | null>(null);

	const suggestions = $derived.by<Suggestion[]>(() => {
		const q = acQuery.toLowerCase();
		if (acTrigger === '#') {
			return channels
				.filter((c) => c.name.toLowerCase().includes(q))
				.slice(0, 8)
				.map((c) => ({ kind: 'channel' as const, id: c.id, name: c.name }));
		}
		if (acTrigger === '@') {
			const roleSuggs = roles
				.filter((r) => r.name.toLowerCase().includes(q))
				.slice(0, 6)
				.map((r) => ({ kind: 'role' as const, id: r.id, name: r.name, color: r.color }));
			const tokenSuggs = TOKENS.filter((t) =>
				t.label.toLowerCase().includes(q.replace(/^{?/, ''))
			)
				.slice(0, 4)
				.map((t) => ({ kind: 'token' as const, value: t.value, label: t.label, hint: t.hint }));
			return [...roleSuggs, ...tokenSuggs];
		}
		if (acTrigger === '{') {
			return TOKENS.filter((t) => t.label.toLowerCase().includes(q)).map((t) => ({
				kind: 'token' as const,
				value: t.value,
				label: t.label,
				hint: t.hint
			}));
		}
		return [];
	});

	// ─── Render: raw -> DOM nodes (chips + text) ────────────────────────────
	const PARSE_RE = /<#(\d{17,20})>|<@&(\d{17,20})>|<@!?(\d{17,20})>|\{(applicant\.(?:mention|tag|display)|guild\.name)\}/g;

	function buildChip(kind: 'channel' | 'role' | 'user' | 'token', label: string, raw: string, color?: number): HTMLSpanElement {
		const chip = document.createElement('span');
		chip.className = `mention mention-${kind}`;
		chip.setAttribute('contenteditable', 'false');
		chip.setAttribute('data-raw', raw);
		chip.setAttribute('data-kind', kind);
		const prefix = kind === 'channel' ? '#' : kind === 'token' ? '' : '@';
		chip.textContent = `${prefix}${label}`;
		if (kind === 'role' && color && color !== 0) {
			const hex = '#' + color.toString(16).padStart(6, '0');
			chip.style.color = hex;
			chip.style.background = hex + '22';
			chip.style.borderColor = hex + '55';
		}
		return chip;
	}

	function rawToNodes(raw: string): Node[] {
		const out: Node[] = [];
		let last = 0;
		PARSE_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PARSE_RE.exec(raw))) {
			if (m.index > last) out.push(document.createTextNode(raw.slice(last, m.index)));
			const [full, chId, roleId, userId, tokenName] = m;
			if (chId) {
				const ch = channelById.get(chId);
				out.push(buildChip('channel', ch?.name ?? 'unknown-channel', full));
			} else if (roleId) {
				const r = roleById.get(roleId);
				out.push(buildChip('role', r?.name ?? 'unknown-role', full, r?.color));
			} else if (userId) {
				out.push(buildChip('user', userId, full));
			} else if (tokenName) {
				out.push(buildChip('token', tokenName, full));
			}
			last = m.index + full.length;
		}
		if (last < raw.length) out.push(document.createTextNode(raw.slice(last)));
		return out;
	}

	function renderEditor(raw: string) {
		if (!editorEl) return;
		editorEl.replaceChildren(...rawToNodes(raw));
	}

	// ─── Read DOM back to raw string ────────────────────────────────────────
	function readEditor(): string {
		if (!editorEl) return value;
		let out = '';
		const walk = (node: Node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				out += node.textContent ?? '';
				return;
			}
			if (node.nodeType === Node.ELEMENT_NODE) {
				const el = node as HTMLElement;
				if (el.dataset.raw) {
					out += el.dataset.raw;
					return;
				}
				if (el.tagName === 'BR') {
					out += '\n';
					return;
				}
				if (el.tagName === 'DIV' && el !== editorEl && out.length > 0 && !out.endsWith('\n')) {
					out += '\n';
				}
				for (const child of Array.from(el.childNodes)) walk(child);
			}
		};
		for (const child of Array.from(editorEl.childNodes)) walk(child);
		return out;
	}

	// ─── External value sync (only when editor isn't focused) ────────────────
	$effect(() => {
		if (!mounted) return;
		const isFocused = editorEl && document.activeElement === editorEl;
		if (isFocused) return;
		const current = readEditor();
		if (current !== value) renderEditor(value);
	});

	onMount(() => {
		mounted = true;
		renderEditor(value);
	});

	// ─── Autocomplete trigger detection ─────────────────────────────────────
	function getCaretRect(): DOMRect | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0).cloneRange();
		range.collapse(true);
		const rects = range.getClientRects();
		if (rects.length > 0) return rects[0];
		// Fallback: measure parent
		const node = range.startContainer.parentElement;
		return node?.getBoundingClientRect() ?? null;
	}

	function detectTrigger() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorEl) {
			acOpen = false;
			return;
		}
		const range = sel.getRangeAt(0);
		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE) {
			acOpen = false;
			return;
		}
		const text = (node.textContent ?? '').slice(0, range.startOffset);
		// Find latest trigger character not separated by whitespace
		const match = text.match(/([#@{])([\w\-.\s]*)$/);
		if (!match) {
			acOpen = false;
			acTrigger = null;
			return;
		}
		const [, trig, query] = match;
		acTrigger = trig as '#' | '@' | '{';
		acQuery = query.trim();
		acIndex = 0;
		const rect = getCaretRect();
		if (rect) {
			acAnchor = { x: rect.left, y: rect.bottom + 4 };
		}
		acOpen = suggestions.length > 0;
	}

	function closeAutocomplete() {
		acOpen = false;
		acTrigger = null;
		acQuery = '';
		acIndex = 0;
	}

	// ─── Insert a chip at the current caret, replacing the trigger query ───
	function insertSuggestion(s: Suggestion) {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorEl) return;
		const range = sel.getRangeAt(0);
		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE) return;

		const before = (node.textContent ?? '').slice(0, range.startOffset);
		const after = (node.textContent ?? '').slice(range.startOffset);
		const triggerMatch = before.match(/([#@{])([\w\-.\s]*)$/);
		if (!triggerMatch) return;

		const newBefore = before.slice(0, before.length - triggerMatch[0].length);
		node.textContent = newBefore;

		let chip: HTMLSpanElement;
		let raw: string;
		if (s.kind === 'channel') {
			raw = `<#${s.id}>`;
			chip = buildChip('channel', s.name, raw);
		} else if (s.kind === 'role') {
			raw = `<@&${s.id}>`;
			chip = buildChip('role', s.name, raw, s.color);
		} else {
			raw = s.value;
			const label = s.value.replace(/[{}]/g, '');
			chip = buildChip('token', label, raw);
		}

		const trailing = document.createTextNode(' ' + after);
		const parent = node.parentNode!;
		parent.insertBefore(chip, node.nextSibling);
		parent.insertBefore(trailing, chip.nextSibling);

		// Move caret to start of trailing text (after the nbsp)
		const newRange = document.createRange();
		newRange.setStart(trailing, 1);
		newRange.collapse(true);
		sel.removeAllRanges();
		sel.addRange(newRange);

		closeAutocomplete();
		emitChange();
	}

	function emitChange() {
		value = readEditor();
	}

	function onInput() {
		emitChange();
		detectTrigger();
	}

	function onKeydown(e: KeyboardEvent) {
		if (acOpen && suggestions.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				acIndex = (acIndex + 1) % suggestions.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				acIndex = (acIndex - 1 + suggestions.length) % suggestions.length;
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				insertSuggestion(suggestions[acIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				closeAutocomplete();
				return;
			}
		}
	}

	function onBlur(_e: FocusEvent) {
		setTimeout(() => {
			const active = document.activeElement;
			if (active && active.closest('.autocomplete')) return;
			closeAutocomplete();
		}, 150);
	}

	function onPaste(e: ClipboardEvent) {
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text) return;
		// Insert as raw text; if pasted text contains <#id>/<@&id>/tokens, they'll
		// stay as plain text until next render. We re-parse the whole editor after
		// paste so chips appear.
		document.execCommand('insertText', false, text);
		// Re-render to parse any mention syntax that came in
		const raw = readEditor();
		renderEditor(raw);
		value = raw;
		// Place caret at end
		const range = document.createRange();
		range.selectNodeContents(editorEl!);
		range.collapse(false);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	// ─── Live preview ───────────────────────────────────────────────────────
	const previewHtml = $derived.by(() => {
		const escape = (s: string) =>
			s.replace(/[&<>"']/g, (c) => ({
				'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
			})[c]!);

		let html = '';
		let last = 0;
		PARSE_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PARSE_RE.exec(value))) {
			if (m.index > last) html += escape(value.slice(last, m.index));
			const [full, chId, roleId, userId, tokenName] = m;
			if (chId) {
				const ch = channelById.get(chId);
				html += `<span class="m m-channel">#${escape(ch?.name ?? 'unknown-channel')}</span>`;
			} else if (roleId) {
				const r = roleById.get(roleId);
				if (r && r.color !== 0) {
					const hex = '#' + r.color.toString(16).padStart(6, '0');
					html += `<span class="m m-role" style="color:${hex};background:${hex}22">@${escape(r.name)}</span>`;
				} else {
					html += `<span class="m m-role">@${escape(r?.name ?? 'unknown-role')}</span>`;
				}
			} else if (userId) {
				html += `<span class="m m-user">@user</span>`;
			} else if (tokenName) {
				if (tokenName === 'applicant.mention') {
					html += `<span class="m m-user">@NewMember</span>`;
				} else if (tokenName === 'applicant.tag') {
					html += `<span class="m m-text">newmember</span>`;
				} else if (tokenName === 'applicant.display') {
					html += `<span class="m m-text">NewMember</span>`;
				} else if (tokenName === 'guild.name') {
					html += `<span class="m m-text">Pawtropolis</span>`;
				}
			}
			last = m.index + full.length;
		}
		if (last < value.length) html += escape(value.slice(last));
		return html.replace(/\n/g, '<br />');
	});
</script>

<div class="wrap">
	<label class="lbl" for="welcome-editor">Editor</label>
	<div
		bind:this={editorEl}
		id="welcome-editor"
		class="editor"
		contenteditable="true"
		role="textbox"
		aria-multiline="true"
		aria-label="Welcome message editor"
		spellcheck="true"
		oninput={onInput}
		onkeyup={detectTrigger}
		onclick={detectTrigger}
		onkeydown={onKeydown}
		onblur={onBlur}
		onpaste={onPaste}
	></div>

	{#if acOpen && suggestions.length > 0 && acAnchor}
		<div
			class="autocomplete"
			role="listbox"
			style="left:{acAnchor.x}px; top:{acAnchor.y}px"
		>
			<div class="ac-header">
				{acTrigger === '#' ? 'CHANNELS' : acTrigger === '@' ? 'ROLES & TOKENS' : 'TOKENS'}
				{#if acQuery}<span class="ac-query">matching "{acQuery}"</span>{/if}
			</div>
			{#each suggestions as s, i (s.kind + (s.kind === 'token' ? s.value : s.id))}
				<button
					type="button"
					class="ac-item"
					class:ac-active={i === acIndex}
					onmousedown={(e) => { e.preventDefault(); insertSuggestion(s); }}
					onmouseenter={() => (acIndex = i)}
				>
					{#if s.kind === 'channel'}
						<span class="ac-glyph">#</span>
						<span class="ac-label">{s.name}</span>
					{:else if s.kind === 'role'}
						<span
							class="ac-dot"
							style="background:{s.color === 0 ? '#99aab5' : '#' + s.color.toString(16).padStart(6, '0')}"
						></span>
						<span class="ac-label">@{s.name}</span>
					{:else}
						<span class="ac-glyph">{'{}'}</span>
						<span class="ac-label">{s.label}</span>
						<span class="ac-hint">{s.hint}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<label class="lbl" for="welcome-preview">Preview</label>
	<div id="welcome-preview" class="preview">
		{#if value.trim() === ''}
			<span class="preview-empty">Empty — default Discord embed will be used.</span>
		{:else}
			{@html previewHtml}
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		position: relative;
	}

	.lbl {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		text-transform: uppercase;
		margin-top: 0.5rem;
	}

	.editor {
		min-height: 6rem;
		padding: 0.75rem 0.9rem;
		font-size: 0.9rem;
		line-height: 1.5;
		font-family: 'gg sans', 'Inter', system-ui, sans-serif;
		background: var(--bg);
		color: var(--text-primary);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		outline: none;
		transition: border-color 120ms;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.editor:focus {
		border-color: var(--accent);
	}

	.editor:empty::before {
		content: attr(data-placeholder);
		color: var(--text-secondary);
		opacity: 0.4;
	}

	.preview {
		padding: 0.75rem 0.9rem;
		font-size: 0.9rem;
		line-height: 1.5;
		font-family: 'gg sans', 'Inter', system-ui, sans-serif;
		background: oklch(20% 0.01 var(--hue));
		color: #dbdee1;
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		min-height: 3rem;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.preview-empty {
		color: var(--text-secondary);
		font-style: italic;
		opacity: 0.6;
	}

	/* Discord-style mention chips inside editor */
	:global(.editor .mention) {
		display: inline-block;
		padding: 0 0.25rem;
		margin: 0 0.05rem;
		border-radius: 4px;
		font-weight: 500;
		border: 1px solid transparent;
		cursor: default;
		user-select: all;
	}

	:global(.editor .mention-channel) {
		background: oklch(40% 0.12 260 / 0.35);
		color: oklch(80% 0.15 260);
	}

	:global(.editor .mention-role) {
		background: oklch(40% 0.12 200 / 0.25);
		color: oklch(80% 0.15 200);
	}

	:global(.editor .mention-user) {
		background: oklch(40% 0.12 280 / 0.35);
		color: oklch(85% 0.15 280);
	}

	:global(.editor .mention-token) {
		background: oklch(40% 0.12 50 / 0.3);
		color: oklch(85% 0.15 50);
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.8rem;
	}

	/* Preview chips (Discord-like) */
	:global(.preview .m) {
		display: inline-block;
		padding: 0 0.25rem;
		border-radius: 4px;
		font-weight: 500;
	}

	:global(.preview .m-channel) {
		background: #404875;
		color: #c9cdfb;
	}

	:global(.preview .m-role) {
		background: #4c4f57;
		color: #dbdee1;
	}

	:global(.preview .m-user) {
		background: #3c4270;
		color: #c9cdfb;
	}

	:global(.preview .m-text) {
		color: #c9cdfb;
		font-weight: 500;
	}

	/* Autocomplete dropdown */
	.autocomplete {
		position: fixed;
		z-index: 100;
		min-width: 16rem;
		max-width: 22rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px oklch(0% 0 0 / 0.4);
		padding: 0.25rem;
		overflow: hidden;
	}

	.ac-header {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		padding: 0.4rem 0.5rem 0.25rem;
		display: flex;
		gap: 0.5rem;
	}

	.ac-query {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		opacity: 0.7;
	}

	.ac-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-primary);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		transition: background 80ms;
	}

	.ac-active {
		background: var(--accent-dim);
	}

	.ac-glyph {
		font-family: 'SF Mono', monospace;
		font-size: 0.85rem;
		color: var(--text-secondary);
		width: 1.2rem;
		text-align: center;
	}

	.ac-dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.ac-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ac-hint {
		font-size: 0.7rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}
</style>
