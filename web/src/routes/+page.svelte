<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import gsap from 'gsap';
	import { SPRINGS, prefersReducedMotion } from '$lib/motion';

	let heroRef: HTMLDivElement;
	let blobsRef: HTMLDivElement;
	let logoRef: HTMLImageElement;
	let titleRef: HTMLHeadingElement;
	let subtitleRef: HTMLParagraphElement;
	let buttonRef: HTMLAnchorElement;
	let footerRef: HTMLParagraphElement;

	let timeline: gsap.core.Timeline | null = null;

	onMount(() => {
		// Mouse parallax on blobs
		const handleMouse = (e: MouseEvent) => {
			if (!blobsRef || prefersReducedMotion()) return;
			const x = (e.clientX / window.innerWidth - 0.5) * 6;
			const y = (e.clientY / window.innerHeight - 0.5) * 6;
			blobsRef.style.transform = `translate(${x}px, ${y}px)`;
		};
		window.addEventListener('mousemove', handleMouse);

		// Entrance animation
		if (prefersReducedMotion()) {
			// Show everything immediately
			[logoRef, titleRef, subtitleRef, buttonRef, footerRef].forEach(el => {
				if (el) { el.style.opacity = '1'; el.style.transform = 'none'; }
			});
		} else {
			const isReturn = sessionStorage.getItem('hasVisited') === '1';
			const baseDuration = isReturn ? 0.5 : 1.2;
			const staggerDelay = isReturn ? 0.1 : 0.2;

			timeline = gsap.timeline();
			timeline.fromTo(logoRef,
				{ opacity: 0, scale: 0.8, y: 20 },
				{ opacity: 1, scale: 1, y: 0, duration: baseDuration, ease: SPRINGS.gentle }
			);
			timeline.fromTo(titleRef,
				{ opacity: 0, y: 15 },
				{ opacity: 1, y: 0, duration: baseDuration * 0.6, ease: SPRINGS.gentle },
				`>-${baseDuration * 0.3}`
			);
			timeline.fromTo(subtitleRef,
				{ opacity: 0, y: 10 },
				{ opacity: 1, y: 0, duration: baseDuration * 0.5, ease: SPRINGS.gentle },
				`>-${staggerDelay}`
			);
			timeline.fromTo(buttonRef,
				{ opacity: 0, y: 10 },
				{ opacity: 1, y: 0, duration: baseDuration * 0.5, ease: SPRINGS.gentle },
				`>-${staggerDelay}`
			);
			timeline.fromTo(footerRef,
				{ opacity: 0 },
				{ opacity: 1, duration: 0.4 },
				`>-${staggerDelay}`
			);

			timeline.call(() => {
				sessionStorage.setItem('hasVisited', '1');
			});
		}

		return () => {
			window.removeEventListener('mousemove', handleMouse);
		};
	});

	onDestroy(() => {
		timeline?.kill();
	});
</script>

<div bind:this={heroRef} class="splash">
	<!-- Atmospheric gradient blobs -->
	<div bind:this={blobsRef} class="blobs" aria-hidden="true">
		<div class="blob blob-magenta"></div>
		<div class="blob blob-cyan"></div>
	</div>

	<!-- Hero content -->
	<div class="hero-content">
		<img
			bind:this={logoRef}
			src="/paw-logo.png"
			alt="Pawtropolis"
			class="hero-logo"
		/>

		<h1 bind:this={titleRef} class="hero-title">
			Pawtropolis
		</h1>

		<p bind:this={subtitleRef} class="hero-subtitle">
			A Safe Place For Everyone
		</p>

		<a
			bind:this={buttonRef}
			href="/auth/login"
			class="discord-btn shimmer"
		>
			<svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
				<path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.483 44.2898 53.5502 44.3433C53.9056 44.6363 54.2778 44.9293 54.6528 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0949 48.2228C48.969 48.2707 48.913 48.4172 48.9718 48.5383C50.0384 50.6034 51.2558 52.5699 52.6477 54.435C52.7038 54.5139 52.8044 54.5477 52.8968 54.5195C58.696 52.7249 64.5786 50.0174 70.6514 45.5576C70.7047 45.5182 70.7383 45.459 70.7439 45.3942C72.2256 30.0791 68.2761 16.7757 60.2646 4.9823C60.245 4.9429 60.2114 4.9147 60.1045 4.8978Z"/>
			</svg>
			Sign in with Discord
		</a>

		<p bind:this={footerRef} class="hero-footer">
			Staff access only
		</p>
	</div>
</div>

<style>
	.splash {
		position: relative;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background-color: var(--bg);
	}

	/* Atmospheric gradient blobs */
	.blobs {
		position: absolute;
		inset: 0;
		transition: transform 0.15s ease-out;
		pointer-events: none;
	}

	.blob {
		position: absolute;
		border-radius: 50%;
		filter: blur(80px);
	}

	.blob-magenta {
		width: 400px;
		height: 400px;
		top: 10%;
		left: 15%;
		background: var(--brand-magenta);
		opacity: 0.1;
		animation: drift-1 25s ease-in-out infinite alternate;
	}

	.blob-cyan {
		width: 350px;
		height: 350px;
		bottom: 15%;
		right: 15%;
		background: var(--brand-cyan);
		opacity: 0.08;
		animation: drift-2 20s ease-in-out infinite alternate;
	}

	@keyframes drift-1 {
		0% { transform: translate(0, 0); }
		100% { transform: translate(30px, -20px); }
	}

	@keyframes drift-2 {
		0% { transform: translate(0, 0); }
		100% { transform: translate(-25px, 15px); }
	}

	/* Hero content */
	.hero-content {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.hero-logo {
		width: 220px;
		height: 220px;
		margin-bottom: 2rem;
		opacity: 0;
		filter: drop-shadow(0 8px 32px oklch(50% 0.2 330 / 0.3));
	}

	.hero-title {
		font-size: 2.5rem;
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.02em;
		margin-bottom: 0.5rem;
		opacity: 0;
	}

	.hero-subtitle {
		font-size: 1.1rem;
		color: var(--text-secondary);
		margin-bottom: 3rem;
		opacity: 0;
	}

	/* Discord sign-in button */
	.discord-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 2rem;
		border-radius: var(--radius-md);
		background: linear-gradient(135deg, var(--brand-magenta), var(--brand-cyan));
		color: white;
		font-weight: 600;
		font-size: 1rem;
		text-decoration: none;
		overflow: hidden;
		transition: all var(--duration-normal) var(--ease-smooth);
		box-shadow: 0 4px 20px oklch(65% 0.2 330 / 0.25);
		opacity: 0;
	}

	.discord-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 28px oklch(65% 0.2 330 / 0.35), 0 0 20px oklch(65% 0.2 330 / 0.2);
	}

	.discord-btn:active {
		transform: translateY(0) scale(0.98);
	}

	/* Shimmer sweep — plays once on load */
	.shimmer::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			105deg,
			transparent 40%,
			rgba(255, 255, 255, 0.12) 50%,
			transparent 60%
		);
		transform: translateX(-100%);
		animation: shimmer-sweep 1.2s ease-in-out 2.5s forwards;
		border-radius: inherit;
		pointer-events: none;
	}

	@keyframes shimmer-sweep {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	.hero-footer {
		margin-top: 2.5rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		opacity: 0;
	}

	/* Reduce motion */
	@media (prefers-reduced-motion: reduce) {
		.blob { animation: none; }
		.shimmer::after { animation: none; }
		.hero-logo,
		.hero-title,
		.hero-subtitle,
		.discord-btn,
		.hero-footer { opacity: 1; }
	}
</style>
