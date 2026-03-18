<div class="splash">
	<div class="content">
		<img src="/paw-logo.png" alt="Pawtropolis" class="logo" />

		<h1 class="title">Pawtropolis</h1>

		<p class="subtitle">A Safe Place For Everyone</p>

		<a href="/auth/login" class="discord-btn">
			<svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
				<path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.483 44.2898 53.5502 44.3433C53.9056 44.6363 54.2778 44.9293 54.6528 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0949 48.2228C48.969 48.2707 48.913 48.4172 48.9718 48.5383C50.0384 50.6034 51.2558 52.5699 52.6477 54.435C52.7038 54.5139 52.8044 54.5477 52.8968 54.5195C58.696 52.7249 64.5786 50.0174 70.6514 45.5576C70.7047 45.5182 70.7383 45.459 70.7439 45.3942C72.2256 30.0791 68.2761 16.7757 60.2646 4.9823C60.245 4.9429 60.2114 4.9147 60.1045 4.8978Z"/>
			</svg>
			Sign in with Discord
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
