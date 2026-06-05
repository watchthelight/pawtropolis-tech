<script lang="ts">
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import type { FieldRule } from '$lib/shared/configValidation';
	import { validateConfigField } from '$lib/shared/configValidation';

	interface Props {
		fieldKey: string;
		label: string;
		value: unknown;
		type: string;
		rule: FieldRule | undefined;
		canEdit: boolean;
		onSave: (key: string, value: unknown) => Promise<void>;
	}

	let { fieldKey, label, value, type, rule, canEdit, onSave }: Props = $props();

	let editing = $state(false);
	let saving = $state(false);
	let editValue = $state<string>('');
	let error = $state<string | null>(null);
	let inputEl = $state<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);

	function isBoolField(): boolean {
		return type === 'bool';
	}

	function boolEnabled(): boolean {
		return value === 1 || value === true;
	}

	function isSnowflake(v: unknown): boolean {
		return typeof v === 'string' && /^\d{17,20}$/.test(v);
	}

	function formatDisplay(): string {
		if (value == null || value === '') return '\u2014';

		switch (type) {
			case 'bool':
				return value === 1 || value === true ? 'Enabled' : 'Disabled';
			case 'ms': {
				const ms = Number(value);
				if (ms >= 60000) return `${(ms / 60000).toFixed(1)}min`;
				if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
				return `${ms}ms`;
			}
			case 'seconds':
				return `${value}s`;
			case 'minutes':
				return `${value}min`;
			case 'hours':
				return `${value}h`;
			case 'chars':
				return `${value} chars`;
			case 'percent': {
				const n = Number(value);
				return n <= 1 ? `${(n * 100).toFixed(0)}%` : `${n}%`;
			}
			case 'json': {
				try {
					const parsed = JSON.parse(String(value));
					if (Array.isArray(parsed)) return parsed.length === 0 ? 'None' : parsed.join(', ');
					return JSON.stringify(parsed, null, 2);
				} catch {
					return String(value);
				}
			}
			case 'template':
				return String(value).length > 80 ? String(value).slice(0, 80) + '\u2026' : String(value);
			default:
				return String(value);
		}
	}

	function startEdit() {
		if (!canEdit || saving) return;
		editing = true;
		error = null;
		editValue = value == null ? '' : String(value);
		// Focus the input on next tick
		requestAnimationFrame(() => {
			inputEl?.focus();
			if (inputEl instanceof HTMLInputElement) inputEl.select();
		});
	}

	function cancelEdit() {
		editing = false;
		error = null;
	}

	async function saveEdit() {
		if (saving) return;

		let submitValue: unknown = editValue;
		// Convert empty strings to null for nullable fields
		if (editValue === '' && rule?.nullable) {
			submitValue = null;
		}
		// Convert numeric strings
		if (rule && ['number', 'hours', 'minutes', 'seconds', 'ms', 'chars', 'percent'].includes(rule.type)) {
			submitValue = editValue === '' ? null : Number(editValue);
		}

		// Validate
		const result = validateConfigField(fieldKey, submitValue);
		if (!result.valid) {
			error = result.error ?? 'Invalid value';
			return;
		}

		saving = true;
		error = null;
		try {
			await onSave(fieldKey, submitValue);
			editing = false;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	async function toggleBool() {
		if (!canEdit || saving) return;
		saving = true;
		error = null;
		const newVal = boolEnabled() ? 0 : 1;
		try {
			await onSave(fieldKey, newVal);
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !(inputEl instanceof HTMLTextAreaElement)) {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			cancelEdit();
		}
	}

	function rangeHint(): string | null {
		if (!rule) return null;
		const parts: string[] = [];
		if (rule.min !== undefined) parts.push(`min: ${rule.min}`);
		if (rule.max !== undefined) parts.push(`max: ${rule.max}`);
		if (rule.integer) parts.push('integer');
		return parts.length > 0 ? parts.join(', ') : null;
	}
</script>

<div class="field-row" class:field-row-editing={editing} class:field-row-saving={saving}>
	<span class="field-label">
		{label}
		{#if !canEdit && rule}
			<span class="lock-icon" title="Requires {rule.minTier}+ to edit">
				<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v2H6V5z"/>
				</svg>
			</span>
		{/if}
	</span>

	<span class="field-value">
		{#if isBoolField()}
			<!-- Bool toggle — immediate save on click -->
			<button
				class="toggle-switch"
				class:toggle-on={boolEnabled()}
				disabled={!canEdit || saving}
				onclick={toggleBool}
				title={canEdit ? (boolEnabled() ? 'Click to disable' : 'Click to enable') : 'Insufficient permissions'}
			>
				<span class="toggle-knob"></span>
			</button>
			<span class="toggle-label" class:toggle-label-on={boolEnabled()}>
				{boolEnabled() ? 'Enabled' : 'Disabled'}
			</span>
		{:else if editing}
			<!-- Edit mode -->
			<div class="edit-controls">
				{#if rule?.choices}
					<select
						bind:this={inputEl}
						bind:value={editValue}
						onkeydown={onKeydown}
						class="edit-input edit-select"
					>
						{#each rule.choices as choice}
							<option value={choice}>{choice}</option>
						{/each}
					</select>
				{:else if type === 'json' || type === 'template'}
					<textarea
						bind:this={inputEl}
						bind:value={editValue}
						onkeydown={onKeydown}
						class="edit-input edit-textarea"
						rows={type === 'json' ? 4 : 3}
						spellcheck="false"
					></textarea>
				{:else if ['number', 'hours', 'minutes', 'seconds', 'ms', 'chars', 'percent'].includes(type)}
					<input
						bind:this={inputEl}
						bind:value={editValue}
						onkeydown={onKeydown}
						type="number"
						class="edit-input"
						min={rule?.min}
						max={rule?.max}
						step={type === 'percent' ? '0.01' : '1'}
					/>
				{:else}
					<input
						bind:this={inputEl}
						bind:value={editValue}
						onkeydown={onKeydown}
						type="text"
						class="edit-input"
						placeholder={type === 'channel' || type === 'role' ? 'Discord ID...' : ''}
					/>
				{/if}

				{#if rangeHint()}
					<span class="range-hint">{rangeHint()}</span>
				{/if}

				<div class="edit-actions">
					<button class="edit-btn save-btn" onclick={saveEdit} disabled={saving} title="Save (Enter)">
						{#if saving}
							<span class="spinner"></span>
						{:else}
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						{/if}
					</button>
					<button class="edit-btn cancel-btn" onclick={cancelEdit} disabled={saving} title="Cancel (Esc)">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
						</svg>
					</button>
				</div>

				{#if error}
					<span class="edit-error">{error}</span>
				{/if}
			</div>
		{:else}
			<!-- Display mode -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="display-value" class:display-editable={canEdit} onclick={canEdit ? startEdit : undefined}>
				{#if (type === 'channel' || type === 'role') && isSnowflake(value)}
					<CopyableId value={String(value)} />
				{:else if type === 'roles' && value}
					{#each String(value).split(',').map(s => s.trim()).filter(Boolean) as roleId, i}
						{#if i > 0}<span class="separator">,</span>{/if}
						<CopyableId value={roleId} />
					{/each}
				{:else}
					<span class="value-text" class:value-null={value == null || value === ''}>
						{formatDisplay()}
					</span>
				{/if}

				{#if canEdit}
					<span class="edit-pencil" title="Click to edit">
						<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</span>
				{/if}
			</span>
		{/if}
	</span>
</div>

<style>
	.field-row {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--line-soft);
		font-size: 0.8rem;
		transition: background 100ms;
	}

	.field-row:last-child {
		border-bottom: none;
	}

	.field-row-editing {
		background: var(--surface-2);
	}

	.field-row-saving {
		opacity: 0.7;
	}

	@media (hover: hover) {
		.field-row:hover {
			background: var(--surface-2);
		}
	}

	.field-label {
		width: 12rem;
		flex-shrink: 0;
		color: var(--ink-2);
		font-size: 0.75rem;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.lock-icon {
		opacity: 0.4;
		display: inline-flex;
	}

	.field-value {
		flex: 1;
		min-width: 0;
		color: var(--ink);
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
		word-break: break-all;
	}

	/* ─── Display mode ─── */

	.display-value {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		width: 100%;
	}

	.display-editable {
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: 0.15rem 0.25rem;
		margin: -0.15rem -0.25rem;
		transition: background 100ms;
	}

	@media (hover: hover) {
		.display-editable:hover {
			background: oklch(50% 0.02 var(--hue) / 0.1);
		}

		.display-editable:hover .edit-pencil {
			opacity: 1;
		}
	}

	.edit-pencil {
		opacity: 0;
		color: var(--ink-2);
		transition: opacity 150ms;
		display: inline-flex;
		flex-shrink: 0;
		margin-left: auto;
	}

	.value-text {
		font-variant-numeric: tabular-nums;
	}

	.value-null {
		color: var(--ink-2);
		opacity: 0.5;
	}

	.separator {
		color: var(--ink-2);
		margin: 0 0.125rem;
	}

	/* ─── Bool toggle ─── */

	.toggle-switch {
		position: relative;
		width: 2rem;
		height: 1.125rem;
		border-radius: var(--radius-pill);
		border: none;
		background: oklch(30% 0.02 var(--hue));
		cursor: pointer;
		transition: background 200ms;
		padding: 0;
		flex-shrink: 0;
	}

	.toggle-switch:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.toggle-on {
		background: var(--good);
	}

	.toggle-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		background: white;
		transition: transform 200ms;
		box-shadow: 0 1px 3px oklch(0% 0 0 / 0.3);
	}

	.toggle-on .toggle-knob {
		transform: translateX(0.875rem);
	}

	.toggle-label {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.375rem;
		border-radius: var(--radius-sm);
		background: oklch(25% 0.04 0);
		color: var(--ink-2);
	}

	.toggle-label-on {
		background: oklch(25% 0.06 145);
		color: var(--good);
	}

	/* ─── Edit controls ─── */

	.edit-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
	}

	.edit-input {
		flex: 1;
		min-width: 8rem;
		padding: 0.35rem 0.5rem;
		font-size: 0.8rem;
		font-family: inherit;
		background: var(--void);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		outline: none;
		transition: border-color 150ms;
	}

	.edit-input:focus {
		border-color: var(--sage);
	}

	.edit-select {
		cursor: pointer;
	}

	.edit-textarea {
		resize: vertical;
		min-height: 3rem;
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		font-size: 0.75rem;
	}

	.range-hint {
		font-size: 0.65rem;
		color: var(--ink-2);
		opacity: 0.6;
	}

	.edit-actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.edit-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink-2);
		cursor: pointer;
		transition: all 100ms;
	}

	.edit-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.save-btn:not(:disabled):hover {
		border-color: var(--good);
		color: var(--good);
		background: oklch(25% 0.06 145);
	}

	.cancel-btn:not(:disabled):hover {
		border-color: var(--status-error);
		color: var(--status-error);
		background: oklch(25% 0.06 25);
	}

	.edit-error {
		width: 100%;
		font-size: 0.7rem;
		color: var(--status-error);
		margin-top: -0.25rem;
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--ink-2);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 600ms linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.field-row {
			flex-direction: column;
			gap: 0.25rem;
		}

		.field-label {
			width: auto;
		}

		.edit-pencil {
			opacity: 0.5;
		}
	}
</style>
