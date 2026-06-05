<div class="gate">
	<img src="/paw-logo.png" alt="" class="gate-logo" />
	<h2 class="gate-title">Desktop Only</h2>
	<p class="gate-subtitle">For more systems, please use a desktop browser.</p>
	<a href="/dashboard/reviews" class="gate-link">Go to Reviews</a>
</div>

<style>
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: calc(var(--vh-full, 100dvh) - var(--mobile-header-h) - 2rem);
		padding: 2rem var(--mobile-pad);
		gap: 1rem;
	}

	.gate-logo {
		width: 48px;
		height: 48px;
		opacity: 0.6;
		filter: drop-shadow(0 2px 8px oklch(50% 0.2 330 / 0.25));
	}

	.gate-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.gate-subtitle {
		font-size: 0.875rem;
		color: var(--ink-2);
		max-width: 280px;
		line-height: 1.5;
		margin: 0;
	}

	.gate-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.625rem 1.25rem;
		background: var(--sage);
		color: var(--void);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		font-weight: 600;
		text-decoration: none;
		margin-top: 0.5rem;
		transition: filter 150ms;
	}

	.gate-link:active {
		filter: brightness(1.1);
	}
</style>
