import { prefersReducedMotion } from '$lib/motion';

/**
 * Subtle pointer tilt (max ~5deg) plus a sage radial glare that follows the
 * cursor. The glare element reads --mx/--my (cursor position) and --glare
 * (0..1 opacity). Disabled entirely under prefers-reduced-motion.
 */
export function tilt(node: HTMLElement, opts?: { max?: number }) {
	if (prefersReducedMotion()) return;
	const max = opts?.max ?? 5;

	function move(e: PointerEvent) {
		const r = node.getBoundingClientRect();
		const px = (e.clientX - r.left) / r.width;
		const py = (e.clientY - r.top) / r.height;
		const rx = (0.5 - py) * max * 2;
		const ry = (px - 0.5) * max * 2;
		node.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
		node.style.setProperty('--mx', `${px * 100}%`);
		node.style.setProperty('--my', `${py * 100}%`);
		node.style.setProperty('--glare', '1');
	}
	function leave() {
		node.style.transform = '';
		node.style.setProperty('--glare', '0');
	}

	node.addEventListener('pointermove', move);
	node.addEventListener('pointerleave', leave);
	return {
		destroy() {
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerleave', leave);
		}
	};
}
