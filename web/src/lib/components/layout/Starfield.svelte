<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from '$lib/motion';

	// Per-theme palette: [star RGB, accent RGB], base star count, drift temperature.
	type Pal = { star: [number, number, number]; accent: [number, number, number]; count: number };
	const PALETTES: Record<string, Pal> = {
		'observatory-dark': { star: [232, 240, 230], accent: [150, 200, 165], count: 120 },
		'observatory-light': { star: [120, 110, 90], accent: [90, 130, 100], count: 120 },
		legacy: { star: [180, 190, 220], accent: [150, 170, 230], count: 70 }
	};

	const LAYERS = [
		{ parallax: 0.25, speed: 0.12, size: 0.7 },
		{ parallax: 0.5, speed: 0.22, size: 1.0 },
		{ parallax: 1.0, speed: 0.36, size: 1.4 }
	];

	type Star = {
		x: number;
		y: number;
		layer: number;
		r: number;
		baseA: number;
		tw: number;
		phase: number;
		tinted: boolean;
	};

	let canvas: HTMLCanvasElement;

	function readMode(): string {
		if (typeof document === 'undefined') return 'observatory-dark';
		return document.documentElement.getAttribute('data-theme') ?? 'observatory-dark';
	}

	function readMult(key: string, fallback: number): number {
		try {
			const v = Number(localStorage.getItem(key));
			return Number.isFinite(v) && v > 0 ? v : fallback;
		} catch {
			return fallback;
		}
	}

	onMount(() => {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const cx = ctx;

		const reduced = prefersReducedMotion();
		let w = 0;
		let h = 0;
		let dpr = 1;
		let stars: Star[] = [];
		let pal = PALETTES[readMode()] ?? PALETTES['observatory-dark'];
		let density = readMult('paw-star-density', 1);
		let speedMult = readMult('paw-star-speed', 1);

		// Eased cursor parallax target + current.
		let pointerX = 0;
		let pointerY = 0;
		let curX = 0;
		let curY = 0;

		function buildStars() {
			const n = Math.round(pal.count * density);
			stars = new Array(n);
			for (let i = 0; i < n; i++) {
				const layer = i % 3;
				stars[i] = {
					x: Math.random() * w,
					y: Math.random() * h,
					layer,
					r: LAYERS[layer].size * (0.6 + Math.random() * 0.8),
					baseA: 0.25 + Math.random() * 0.55,
					tw: 0.4 + Math.random() * 1.1,
					phase: Math.random() * Math.PI * 2,
					tinted: Math.random() < 0.14
				};
			}
		}

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = window.innerWidth;
			h = window.innerHeight;
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
			canvas.style.width = w + 'px';
			canvas.style.height = h + 'px';
			cx.setTransform(dpr, 0, 0, dpr, 0, 0);
			buildStars();
		}

		function draw(t: number) {
			cx.clearRect(0, 0, w, h);
			curX += (pointerX - curX) * 0.04;
			curY += (pointerY - curY) * 0.04;
			const time = t * 0.001;
			for (let i = 0; i < stars.length; i++) {
				const s = stars[i];
				const L = LAYERS[s.layer];
				// Twilight twinkle.
				const a = Math.max(0, Math.min(1, s.baseA + Math.sin(time * s.tw + s.phase) * 0.18));
				const px = s.x + curX * L.parallax * 26;
				const py = s.y + curY * L.parallax * 26;
				const [r, g, b] = s.tinted ? pal.accent : pal.star;
				cx.beginPath();
				cx.arc(px, py, s.r, 0, Math.PI * 2);
				cx.fillStyle = `rgba(${r},${g},${b},${a})`;
				cx.fill();
			}
		}

		function step(t: number) {
			// Slow downward-left drift, wrap toroidally.
			for (let i = 0; i < stars.length; i++) {
				const s = stars[i];
				const L = LAYERS[s.layer];
				s.x -= L.speed * speedMult * 0.6;
				s.y += L.speed * speedMult * 0.5;
				if (s.x < -2) s.x = w + 2;
				if (s.y > h + 2) s.y = -2;
			}
			draw(t);
			raf = requestAnimationFrame(step);
		}

		let raf = 0;
		function onPointer(e: PointerEvent) {
			pointerX = (e.clientX / w - 0.5) * 2;
			pointerY = (e.clientY / h - 0.5) * 2;
		}
		function onResize() {
			resize();
			if (reduced) draw(0);
		}

		// React to theme + tweak-panel changes.
		const obs = new MutationObserver(() => {
			pal = PALETTES[readMode()] ?? PALETTES['observatory-dark'];
			buildStars();
			if (reduced) draw(0);
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

		function onTweak() {
			density = readMult('paw-star-density', 1);
			speedMult = readMult('paw-star-speed', 1);
			buildStars();
			if (reduced) draw(0);
		}
		window.addEventListener('paw:starfield', onTweak);

		resize();
		window.addEventListener('resize', onResize);
		if (reduced) {
			draw(0);
		} else {
			window.addEventListener('pointermove', onPointer, { passive: true });
			raf = requestAnimationFrame(step);
		}

		return () => {
			cancelAnimationFrame(raf);
			obs.disconnect();
			window.removeEventListener('resize', onResize);
			window.removeEventListener('pointermove', onPointer);
			window.removeEventListener('paw:starfield', onTweak);
		};
	});
</script>

<canvas bind:this={canvas} class="starfield" aria-hidden="true"></canvas>

<style>
	.starfield {
		position: fixed;
		inset: 0;
		/* Behind normal-flow content but above the body's --void background,
		   so transparent surfaces let the drift show through. */
		z-index: -1;
		pointer-events: none;
		display: block;
	}
</style>
