<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { HEAD_FONTS } from '$lib/stores/appearance';
	import { resetToDiscordTheme } from '$lib/stores/theme';
	import { deleteCookie } from '$lib/stores/consent';
	import {
		appearance, mode, isLegacyMode,
		chooseMode, nightDay, chooseFont, chooseSageHue, chooseSageChroma,
		chooseStarDensity, chooseStarSpeed
	} from '$lib/stores/appearanceStore.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let a = $derived(appearance());
	let legacy = $derived(isLegacyMode());
	let night = $derived(mode() === 'observatory-dark');

	function resetSageToDiscord() {
		try {
			localStorage.removeItem('paw-sage-h');
			localStorage.removeItem('paw-sage-c');
		} catch { /* ignore */ }
		deleteCookie('paw-sage-h');
		deleteCookie('paw-sage-c');
		document.documentElement.style.removeProperty('--sage-c');
		resetToDiscordTheme();
	}
</script>

{#if open}
	<div class="tp-backdrop" role="presentation" onclick={() => (open = false)} transition:fade={{ duration: 150 }}></div>
	<aside class="tp" transition:fly={{ x: 24, duration: 220 }} aria-label="Appearance settings">
		<header class="tp-head">
			<span class="tp-eyebrow">Appearance</span>
			<button class="tp-close" onclick={() => (open = false)} aria-label="Close">&times;</button>
		</header>

		<section class="tp-section">
			<span class="tp-label">Theme</span>
			<div class="tp-seg">
				<button class:on={!legacy} onclick={() => chooseMode('observatory-dark')}>Observatory</button>
				<button class:on={legacy} onclick={() => chooseMode('legacy')}>Legacy</button>
			</div>
		</section>

		{#if !legacy}
			<section class="tp-section">
				<span class="tp-label">Mode</span>
				<div class="tp-seg">
					<button class:on={night} onclick={() => { if (!night) nightDay(); }}>Night</button>
					<button class:on={!night} onclick={() => { if (night) nightDay(); }}>Day</button>
				</div>
			</section>

			<section class="tp-section">
				<span class="tp-label">Heading font</span>
				<div class="tp-chips">
					{#each HEAD_FONTS as f (f.id)}
						<button
							class="tp-chip"
							class:on={a.headFont === f.id}
							style:font-family={f.stack}
							onclick={() => chooseFont(f.id)}
						>{f.label}</button>
					{/each}
				</div>
			</section>

			<section class="tp-section">
				<span class="tp-label">Sage hue <em>{Math.round(a.sageH)}&deg;</em></span>
				<input class="tp-range" type="range" min="90" max="320" step="1"
					value={a.sageH} oninput={(e) => chooseSageHue(+e.currentTarget.value)} />
			</section>

			<section class="tp-section">
				<span class="tp-label">Sage intensity <em>{a.sageC.toFixed(3)}</em></span>
				<input class="tp-range" type="range" min="0.02" max="0.16" step="0.005"
					value={a.sageC} oninput={(e) => chooseSageChroma(+e.currentTarget.value)} />
			</section>

			<button class="tp-reset" onclick={resetSageToDiscord}>Match my Discord accent</button>
		{:else}
			<p class="tp-note">Sage controls are paused in Legacy. Switch back to Observatory to retune the palette.</p>
		{/if}

		<div class="tp-rule"><span class="tp-rule-node"></span></div>

		<section class="tp-section">
			<span class="tp-label">Starfield density <em>{a.starDensity.toFixed(1)}&times;</em></span>
			<input class="tp-range" type="range" min="0.4" max="1.6" step="0.1"
				value={a.starDensity} oninput={(e) => chooseStarDensity(+e.currentTarget.value)} />
		</section>

		<section class="tp-section">
			<span class="tp-label">Drift speed <em>{a.starSpeed.toFixed(1)}&times;</em></span>
			<input class="tp-range" type="range" min="0.4" max="1.8" step="0.1"
				value={a.starSpeed} oninput={(e) => chooseStarSpeed(+e.currentTarget.value)} />
		</section>
	</aside>
{/if}

<style>
	.tp-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0% 0 0 / 0.45);
		z-index: 60;
	}
	.tp {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(20rem, 90vw);
		z-index: 61;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.1rem;
		overflow-y: auto;
		background: var(--surface);
		border-left: 1px solid var(--line-strong);
	}
	.tp-head { display: flex; align-items: center; justify-content: space-between; }
	.tp-eyebrow {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--sage-deep);
	}
	.tp-close {
		background: none; border: none; cursor: pointer;
		font-size: 1.4rem; line-height: 1;
		color: var(--ink-3);
	}
	.tp-close:hover { color: var(--ink); }

	.tp-section { display: flex; flex-direction: column; gap: 0.45rem; }
	.tp-label {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-faint);
		display: flex; justify-content: space-between; align-items: baseline;
	}
	.tp-label em { font-style: normal; color: var(--sage); letter-spacing: 0; }

	.tp-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
	.tp-seg button {
		padding: 0.5rem; font-family: var(--font-body); font-size: 0.8rem;
		color: var(--ink-2); background: transparent;
		border: 1px solid var(--line-soft); border-radius: var(--radius); cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-smooth);
	}
	.tp-seg button.on { color: var(--sage); background: var(--sage-fill); border-color: var(--sage-soft); }
	.tp-seg button:not(.on):hover { border-color: var(--line); }

	.tp-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.tp-chip {
		padding: 0.4rem 0.7rem; font-size: 0.85rem;
		color: var(--ink-2); background: transparent;
		border: 1px solid var(--line-soft); border-radius: var(--radius); cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-smooth);
	}
	.tp-chip.on { color: var(--sage); background: var(--sage-fill); border-color: var(--sage-soft); }

	.tp-range { width: 100%; accent-color: var(--sage); }

	.tp-reset {
		align-self: flex-start;
		padding: 0.45rem 0.8rem; font-size: 0.78rem;
		color: var(--ink-2); background: transparent;
		border: 1px solid var(--line-soft); border-radius: var(--radius); cursor: pointer;
	}
	.tp-reset:hover { color: var(--ink); border-color: var(--sage); }

	.tp-note { font-size: 0.8rem; color: var(--ink-3); margin: 0; }

	/* Tick-rule divider: rotated-square node + dashed hairline */
	.tp-rule { position: relative; height: 1px; margin: 0.2rem 0; background: transparent; border-top: 1px dashed var(--line); }
	.tp-rule-node {
		position: absolute; left: 0; top: 50%;
		width: 6px; height: 6px;
		transform: translate(-1px, -50%) rotate(45deg);
		background: var(--sage-deep);
	}
</style>
