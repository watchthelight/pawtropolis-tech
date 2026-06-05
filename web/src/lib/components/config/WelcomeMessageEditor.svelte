<script lang="ts">
	import { onMount } from 'svelte';

	interface Channel { id: string; name: string; type: number; parentId: string | null }
	interface Role { id: string; name: string; color: number; position: number; mentionable: boolean }

	interface Props {
		value: string;
		channels: Channel[];
		roles: Role[];
		infoChannelId?: string | null;
		rulesChannelId?: string | null;
		welcomePingRoleId?: string | null;
		memberCount?: number;
		guildName?: string;
		guildIconUrl?: string | null;
	}

	let {
		value = $bindable(''),
		channels,
		roles,
		infoChannelId = null,
		rulesChannelId = null,
		welcomePingRoleId = null,
		memberCount = 0,
		guildName = 'Pawtropolis',
		guildIconUrl = null
	}: Props = $props();

	// Default greeting the bot renders when welcome_template is empty. Stored
	// in the raw {applicant.mention} form so the chip parser turns it into a
	// real "@NewMember" chip on mount; the bot resolves the same token at
	// send time. Keep this string in sync with src/features/welcome.ts.
	const DEFAULT_GREETING_RAW = '👋 Welcome {applicant.mention}!';

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

	// Editor parses real Discord mention syntax (channels and role pings) plus
	// one universal applicant placeholder. The {applicant.mention} string never
	// appears literally in the editor — it always renders as an @NewMember chip.
	const PARSE_RE = /<#(\d{17,20})>|<@&(\d{17,20})>|(\{applicant\.mention\})/g;

	function buildChip(
		kind: 'channel' | 'role' | 'applicant',
		label: string,
		raw: string,
		color?: number
	): HTMLSpanElement {
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
			const [full, chId, roleId, applicantToken] = m;
			if (chId) {
				const ch = channelById.get(chId);
				out.push(buildChip('channel', ch?.name ?? 'unknown-channel', full));
			} else if (roleId) {
				const r = roleById.get(roleId);
				out.push(buildChip('role', r?.name ?? 'unknown-role', full, r?.color));
			} else if (applicantToken) {
				out.push(buildChip('applicant', 'NewMember', '{applicant.mention}'));
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

	// True while the editor is displaying the default greeting as a starting
	// point, but the parent's `value` state is still empty. Lets admins type
	// over a pre-filled default without forcing the page into a dirty state
	// before any real edit happens.
	let placeholderActive = $state(false);

	// Keep the editor synced with the parent-supplied value. Skips while the
	// user is typing so we never clobber an in-progress edit. Also skips while
	// the editor is pre-filled with the default greeting and value is still
	// empty, so the placeholder isn't wiped before the admin can edit it.
	$effect(() => {
		if (!mounted) return;
		const isFocused = editorEl && document.activeElement === editorEl;
		if (isFocused) return;
		if (placeholderActive && value.trim().length === 0) return;
		const current = readEditor();
		if (current !== value) renderEditor(value);
	});

	onMount(() => {
		mounted = true;
		if (value.trim().length === 0) {
			renderEditor(DEFAULT_GREETING_RAW);
			placeholderActive = true;
		} else {
			renderEditor(value);
		}
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
		const next = readEditor();
		value = next;
		// Once the admin has typed anything, the placeholder no longer applies.
		// Future re-renders should reflect actual saved state.
		if (placeholderActive && next.trim().length > 0) {
			placeholderActive = false;
		}
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

	// Renders a raw template/string into HTML with real mention chips + legacy
	// token stand-ins. Returns escaped HTML safe to drop into the preview.
	const PREVIEW_RE =
		/<#(\d{17,20})>|<@&(\d{17,20})>|\{(applicant\.mention|applicant\.tag|applicant\.display|guild\.name)\}/g;

	function renderPreview(raw: string): string {
		const escape = (s: string) =>
			s.replace(/[&<>"']/g, (c) => ({
				'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
			})[c]!);

		let html = '';
		let last = 0;
		PREVIEW_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PREVIEW_RE.exec(raw))) {
			if (m.index > last) html += escape(raw.slice(last, m.index));
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
				html += escape(guildName);
			}
			last = m.index + full.length;
		}
		if (last < raw.length) html += escape(raw.slice(last));
		return html.replace(/\n/g, '<br />');
	}

	// Greeting (admin-controlled). Empty editor => bot's default greeting line.
	const greetingHtml = $derived(
		value.trim().length > 0 ? renderPreview(value) : renderPreview(DEFAULT_GREETING_RAW)
	);

	const isUsingDefault = $derived(value.trim().length === 0);
	const memberCountText = $derived((memberCount || 0).toLocaleString());

	// Channel link list mirrors postWelcomeCard in src/features/welcome.ts.
	type ChannelLink = { id: string; name: string };
	const channelLinks = $derived.by<ChannelLink[]>(() => {
		const out: ChannelLink[] = [];
		if (infoChannelId) {
			const ch = channelById.get(infoChannelId);
			out.push({ id: infoChannelId, name: ch?.name ?? 'info' });
		}
		if (rulesChannelId) {
			const ch = channelById.get(rulesChannelId);
			out.push({ id: rulesChannelId, name: ch?.name ?? 'rules' });
		}
		return out;
	});

	type PingRole = { id: string; name: string; color: number };
	const welcomePingRole = $derived.by<PingRole | null>(() => {
		if (!welcomePingRoleId) return null;
		const r = roleById.get(welcomePingRoleId);
		if (!r) return { id: welcomePingRoleId, name: 'welcome-ping', color: 0 };
		return { id: r.id, name: r.name, color: r.color };
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

	<label class="lbl" for="welcome-preview">
		Preview
		{#if isUsingDefault}<span class="lbl-hint">(showing default greeting — editor empty)</span>{/if}
	</label>
	<div id="welcome-preview" class="preview-message">
		<div class="msg-content">
			<span class="m m-user">@NewMember</span>
			{#if welcomePingRole}
				{#if welcomePingRole.color !== 0}
					<span
						class="m m-role"
						style="color:#{welcomePingRole.color.toString(16).padStart(6, '0')};background:#{welcomePingRole.color.toString(16).padStart(6, '0')}22"
					>@{welcomePingRole.name}</span>
				{:else}
					<span class="m m-role">@{welcomePingRole.name}</span>
				{/if}
			{/if}
		</div>
		<div class="preview-embed">
			<div class="embed-bar"></div>
			<div class="embed-body">
				<div class="embed-author">
					{#if guildIconUrl}
						<img class="embed-author-icon" src={guildIconUrl} alt="" />
					{:else}
						<span class="embed-author-icon embed-author-icon-fallback">🐾</span>
					{/if}
					<span class="embed-author-name">{guildName}</span>
				</div>
				<div class="embed-main">
					<div class="embed-text">
						<div class="embed-title">Welcome to Pawtropolis 🐾</div>
						<div class="embed-description">
							<div class="embed-line">{@html greetingHtml}</div>
							<div class="embed-line">
								This server now has <strong>{memberCountText} Users!</strong>
							</div>
							{#if channelLinks.length > 0}
								<div class="embed-line embed-spacer"></div>
								<div class="embed-line">🔗 Be sure to check out:</div>
								{#each channelLinks as link (link.id)}
									<div class="embed-line embed-bullet">
										• <span class="m m-channel">#{link.name}</span>
									</div>
								{/each}
							{/if}
							<div class="embed-line embed-spacer"></div>
							<div class="embed-line">✅ Enjoy your stay!</div>
							<div class="embed-line embed-spacer"></div>
							<div class="embed-line embed-italic">Bot by watchthelight.</div>
						</div>
					</div>
					<div class="embed-thumb">NewMember avatar</div>
				</div>
				<div class="embed-banner">Pawtropolis banner</div>
				<div class="embed-footer">Pawtropolis Moderation Team</div>
			</div>
		</div>
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
		color: var(--ink-2);
		text-transform: uppercase;
		margin-top: 0.5rem;
	}

	.editor {
		min-height: 6rem;
		padding: 0.75rem 0.9rem;
		font-size: 0.9rem;
		line-height: 1.5;
		font-family: 'gg sans', 'Inter', system-ui, sans-serif;
		background: var(--void);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		outline: none;
		transition: border-color 120ms;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.editor:focus {
		border-color: var(--sage);
	}

	.editor:empty::before {
		content: attr(data-placeholder);
		color: var(--ink-2);
		opacity: 0.4;
	}

	.preview-message {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-family: 'gg sans', 'Inter', system-ui, sans-serif;
		color: #dbdee1;
		font-size: 0.9rem;
		line-height: 1.4;
		max-width: 560px;
	}

	.msg-content {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding: 0.1rem 0;
	}

	.preview-embed {
		display: flex;
		background: #2b2d31;
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.embed-main {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.embed-text {
		flex: 1;
		min-width: 0;
	}

	.embed-thumb {
		flex-shrink: 0;
		width: 72px;
		height: 72px;
		margin-top: 0.1rem;
		border-radius: var(--radius-sm);
		background:
			repeating-linear-gradient(
				45deg,
				oklch(28% 0.02 var(--hue)) 0 6px,
				oklch(32% 0.02 var(--hue)) 6px 12px
			);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.55rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-align: center;
		color: oklch(65% 0.02 var(--hue));
	}

	.embed-author-icon {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		flex-shrink: 0;
		object-fit: cover;
	}

	.embed-author-icon-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: oklch(30% 0.02 var(--hue));
	}

	.embed-bar {
		width: 4px;
		flex-shrink: 0;
		background: #00c2ff;
	}

	.embed-body {
		flex: 1;
		padding: 0.5rem 0.85rem 0.65rem;
		min-width: 0;
	}

	.embed-author {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #f2f3f5;
		margin-bottom: 0.25rem;
	}

	.embed-author-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.embed-title {
		font-size: 1rem;
		font-weight: 700;
		color: #f2f3f5;
		margin-bottom: 0.4rem;
	}

	.embed-description {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		word-break: break-word;
	}

	.embed-line {
		min-height: 1.1em;
	}

	.embed-bullet {
		padding-left: 0.25rem;
	}

	.embed-spacer {
		height: 0.4rem;
	}

	.embed-italic {
		font-style: italic;
		color: #b5bac1;
	}

	.embed-banner {
		margin-top: 0.6rem;
		padding: 1.5rem 0;
		text-align: center;
		font-size: 0.7rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: oklch(60% 0.02 var(--hue));
		background:
			repeating-linear-gradient(
				45deg,
				oklch(20% 0.02 var(--hue)) 0 8px,
				oklch(22% 0.02 var(--hue)) 8px 16px
			);
		border-radius: var(--radius-sm);
	}

	.embed-footer {
		margin-top: 0.5rem;
		font-size: 0.72rem;
		color: #b5bac1;
	}

	.lbl-hint {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink-2);
		font-size: 0.7rem;
		opacity: 0.7;
		margin-left: 0.4rem;
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

	:global(.editor .mention-applicant) {
		background: oklch(40% 0.12 280 / 0.35);
		color: oklch(85% 0.15 280);
	}

	:global(.preview-embed .m) {
		display: inline-block;
		padding: 0 0.25rem;
		border-radius: 4px;
		font-weight: 500;
	}

	:global(.preview-embed .m-channel) {
		background: #404875;
		color: #c9cdfb;
	}

	:global(.preview-embed .m-role) {
		background: #4c4f57;
		color: #dbdee1;
	}

	:global(.preview-embed .m-user) {
		background: #3c4270;
		color: #c9cdfb;
	}

	.autocomplete {
		position: fixed;
		z-index: 100;
		min-width: 16rem;
		max-width: 22rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px oklch(0% 0 0 / 0.4);
		padding: 0.25rem;
		overflow: hidden;
	}

	.ac-header {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--ink-2);
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
		color: var(--ink);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		transition: background 80ms;
	}

	.ac-active {
		background: var(--sage-deep);
	}

	.ac-glyph {
		font-family: 'SF Mono', monospace;
		font-size: 0.85rem;
		color: var(--ink-2);
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
