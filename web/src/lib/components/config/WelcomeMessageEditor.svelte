<script lang="ts">
	import { onMount } from 'svelte';

	interface Channel { id: string; name: string; type: number; parentId: string | null }
	interface Role { id: string; name: string; color: number; position: number; mentionable: boolean }

	interface Props {
		value: string;
		channels: Channel[];
		roles: Role[];
	}

	let { value = $bindable(''), channels, roles }: Props = $props();

	const channelById = $derived(new Map(channels.map((c) => [c.id, c])));
	const roleById = $derived(new Map(roles.map((r) => [r.id, r])));

	let editorEl: HTMLDivElement | null = $state(null);
	let mounted = $state(false);

	// Autocomplete state — # for channels, @ for roles. No tokens.
	type Suggestion =
		| { kind: 'channel'; id: string; name: string }
		| { kind: 'role'; id: string; name: string; color: number };

	let acOpen = $state(false);
	let acTrigger = $state<'#' | '@' | null>(null);
	let acQuery = $state('');
	let acIndex = $state(0);
	let acAnchor = $state<{ x: number; y: number } | null>(null);

	const suggestions = $derived.by<Suggestion[]>(() => {
		const q = acQuery.toLowerCase();
		if (acTrigger === '#') {
			return channels
				.filter((c) => c.name.toLowerCase().includes(q))
				.slice(0, 10)
				.map((c) => ({ kind: 'channel' as const, id: c.id, name: c.name }));
		}
		if (acTrigger === '@') {
			return roles
				.filter((r) => r.name.toLowerCase().includes(q))
				.slice(0, 10)
				.map((r) => ({ kind: 'role' as const, id: r.id, name: r.name, color: r.color }));
		}
		return [];
	});

	// Match only real Discord mention syntax — channels and role pings.
	const PARSE_RE = /<#(\d{17,20})>|<@&(\d{17,20})>/g;

	function buildChip(kind: 'channel' | 'role', label: string, raw: string, color?: number): HTMLSpanElement {
		const chip = document.createElement('span');
		chip.className = `mention mention-${kind}`;
		chip.setAttribute('contenteditable', 'false');
		chip.setAttribute('data-raw', raw);
		chip.setAttribute('data-kind', kind);
		const prefix = kind === 'channel' ? '#' : '@';
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
			const [full, chId, roleId] = m;
			if (chId) {
				const ch = channelById.get(chId);
				out.push(buildChip('channel', ch?.name ?? 'unknown-channel', full));
			} else if (roleId) {
				const r = roleById.get(roleId);
				out.push(buildChip('role', r?.name ?? 'unknown-role', full, r?.color));
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

	// Keep the editor synced with the parent-supplied value. Skips while the
	// user is typing so we never clobber an in-progress edit.
	$effect(() => {
		if (!mounted) return;
		const isFocused = editorEl && document.activeElement === editorEl;
		if (isFocused) return;
		const current = readEditor();
		if (current !== value) renderEditor(value);
	});

	onMount(() => {
		mounted = true;
		// Pre-fill with whatever the parent currently has saved so admins can
		// make small edits instead of retyping from scratch.
		renderEditor(value);
	});

	function getCaretRect(): DOMRect | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0).cloneRange();
		range.collapse(true);
		const rects = range.getClientRects();
		if (rects.length > 0) return rects[0];
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
		const match = text.match(/([#@])([\w\-.\s]*)$/);
		if (!match) {
			acOpen = false;
			acTrigger = null;
			return;
		}
		const [, trig, query] = match;
		acTrigger = trig as '#' | '@';
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

	function insertSuggestion(s: Suggestion) {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorEl) return;
		const range = sel.getRangeAt(0);
		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE) return;

		const before = (node.textContent ?? '').slice(0, range.startOffset);
		const after = (node.textContent ?? '').slice(range.startOffset);
		const triggerMatch = before.match(/([#@])([\w\-.\s]*)$/);
		if (!triggerMatch) return;

		const newBefore = before.slice(0, before.length - triggerMatch[0].length);
		node.textContent = newBefore;

		let chip: HTMLSpanElement;
		let raw: string;
		if (s.kind === 'channel') {
			raw = `<#${s.id}>`;
			chip = buildChip('channel', s.name, raw);
		} else {
			raw = `<@&${s.id}>`;
			chip = buildChip('role', s.name, raw, s.color);
		}

		const trailing = document.createTextNode(' ' + after);
		const parent = node.parentNode!;
		parent.insertBefore(chip, node.nextSibling);
		parent.insertBefore(trailing, chip.nextSibling);

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
		document.execCommand('insertText', false, text);
		const raw = readEditor();
		renderEditor(raw);
		value = raw;
		const range = document.createRange();
		range.selectNodeContents(editorEl!);
		range.collapse(false);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	// Preview must show what the welcome message will *actually look like* once
	// the bot renders it for a new member: real role pings, real channel chips,
	// and any legacy {applicant.*}/{guild.name} tokens resolved to stand-in
	// placeholders. The editor itself doesn't surface tokens any more, but the
	// backend still resolves them, so the preview has to mirror that for
	// templates that pre-date the token removal.
	const PREVIEW_RE =
		/<#(\d{17,20})>|<@&(\d{17,20})>|\{(applicant\.mention|applicant\.tag|applicant\.display|guild\.name)\}/g;

	const previewHtml = $derived.by(() => {
		const escape = (s: string) =>
			s.replace(/[&<>"']/g, (c) => ({
				'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
			})[c]!);

		let html = '';
		let last = 0;
		PREVIEW_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PREVIEW_RE.exec(value))) {
			if (m.index > last) html += escape(value.slice(last, m.index));
			const [full, chId, roleId, tokenName] = m;
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
			} else if (tokenName === 'applicant.mention') {
				html += `<span class="m m-user">@NewMember</span>`;
			} else if (tokenName === 'applicant.tag') {
				html += `newmember`;
			} else if (tokenName === 'applicant.display') {
				html += `NewMember`;
			} else if (tokenName === 'guild.name') {
				html += `Pawtropolis`;
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
				{acTrigger === '#' ? 'CHANNELS' : 'ROLES'}
				{#if acQuery}<span class="ac-query">matching "{acQuery}"</span>{/if}
			</div>
			{#each suggestions as s, i (s.kind + s.id)}
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
					{:else}
						<span
							class="ac-dot"
							style="background:{s.color === 0 ? '#99aab5' : '#' + s.color.toString(16).padStart(6, '0')}"
						></span>
						<span class="ac-label">@{s.name}</span>
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
</style>
