<div class="splash">
	<div class="content">
		<img src="/paw-logo.png" alt="Pawtropolis" class="logo" />

		<h1 class="title">Pawtropolis</h1>

		<p class="subtitle">A Safe Place For Everyone</p>

		<a href="/auth/login" class="discord-btn">
			<img src="/shield-icon.png" alt="" class="btn-icon" aria-hidden="true" />
			Log In with Discord
		</a>

		<p class="footer">staff access only</p>
	</div>
</div>

<style>
	.splash {
		position: relative;
		min-height: var(--vh-full);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background-color: var(--bg);
	}

	.content {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0;
		padding-bottom: 4rem;
	}

	.logo {
		width: 180px;
		height: 180px;
		margin-bottom: 1.5rem;
		filter: drop-shadow(0 4px 16px oklch(10% 0 0 / 0.5));
	}

	.title {
		font-size: 3rem;
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.03em;
		line-height: 1;
		margin-bottom: 0.75rem;
	}

	.subtitle {
		font-size: 1rem;
		color: var(--text-secondary);
		letter-spacing: 0.04em;
		margin-bottom: 2.5rem;
	}

	.btn-icon {
		width: 20px;
		height: 20px;
		object-fit: contain;
	}

	.discord-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 2.25rem;
		border-radius: var(--radius-md);
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: 600;
		font-size: 1rem;
		text-decoration: none;
		border: none;
		box-shadow: var(--shadow-md);
		transition: background 150ms var(--ease-smooth), box-shadow 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.discord-btn:hover {
			background: var(--accent-strong);
			box-shadow: var(--shadow-lg);
		}
	}

	.discord-btn:active {
		background: var(--accent-dim);
		box-shadow: var(--shadow-sm);
	}

	.footer {
		margin-top: 2rem;
		font-size: 0.7rem;
		color: var(--text-secondary);
		opacity: 0.5;
		letter-spacing: 0.1em;
		text-transform: lowercase;
	}

	@media (max-width: 640px) {
		.logo { width: 140px; height: 140px; }
		.title { font-size: 2.2rem; }
		.content { padding: 0 var(--mobile-pad) 4rem; }
		.discord-btn { padding: 0.875rem 2rem; font-size: 0.9rem; min-height: 44px; }
	}
</style>
