export { SPRINGS } from './springs';
export { EASINGS } from './easings';
export { DURATIONS } from './durations';

/** Check if user prefers reduced motion. SSR-safe — returns false on server. */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
