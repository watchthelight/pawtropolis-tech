<script lang="ts">
	import { onMount } from 'svelte';
	import { getConsent, setConsent } from '$lib/stores/consent';

	let visible = $state(false);

	onMount(() => {
		// Show banner only if user hasn't made a choice yet
		if (getConsent() === null) {
			// Small delay so it doesn't flash on instant page loads
			setTimeout(() => { visible = true; }, 400);
		}
	});

	function accept() {
		setConsent('accepted');
		visible = false;
	}

	function deny() {
		setConsent('denied');
		visible = false;
	}
</script>

{#if visible}
	<div class="consent-backdrop">
		<div class="consent-banner">
			<p class="consent-text">
				We use cookies to keep you signed in and remember your dashboard preferences
				(theme, colors). No tracking, no ads, just your settings.
			</p>
			<div class="consent-actions">
				<button class="consent-btn consent-deny" onclick={deny}>Deny</button>
				<button class="consent-btn consent-accept" onclick={accept}>Accept</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.consent-backdrop {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 200;
		display: flex;
		justify-content: center;
		padding: 1rem;
		pointer-events: none;
		animation: consent-slide-up 250ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.consent-banner {
		pointer-events: auto;
		background: var(--surface, #1a1a24);
		border: 1px solid var(--line, #333);
		border-radius: var(--radius-md, 12px);
		box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.4));
		padding: 1rem 1.5rem;
		max-width: 580px;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	.consent-text {
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--ink-2, #aaa);
		flex: 1;
		margin: 0;
	}

	.consent-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.consent-btn {
		padding: 0.5rem 1.25rem;
		border-radius: var(--radius-sm, 6px);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--line, #333);
		font-family: inherit;
		transition: all 150ms ease;
	}

	.consent-deny {
		background: transparent;
		color: var(--ink-2, #aaa);
	}

	.consent-deny:hover {
		background: var(--surface-2, #252530);
		color: var(--ink, #eee);
	}

	.consent-accept {
		background: var(--sage, #7c6fc0);
		color: var(--on-sage, #111);
		border-color: transparent;
	}

	.consent-accept:hover {
		filter: brightness(1.1);
	}

	@keyframes consent-slide-up {
		from {
			opacity: 0;
			transform: translateY(1rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 580px) {
		.consent-banner {
			flex-direction: column;
			text-align: center;
			gap: 0.75rem;
		}

		.consent-actions {
			width: 100%;
			justify-content: center;
		}

		.consent-btn {
			flex: 1;
			min-height: 44px;
		}
	}
</style>
