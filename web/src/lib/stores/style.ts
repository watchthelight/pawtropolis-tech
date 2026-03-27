import { setPreferenceCookie, getPreferenceCookie, deleteCookie } from './consent';

export type StyleName = 'default' | 'neumorphism' | 'glassmorphism' | 'skeuomorphism';

export const STYLES: { id: StyleName; label: string }[] = [
	{ id: 'default', label: 'Holdfast' },
	{ id: 'neumorphism', label: 'Soft' },
	{ id: 'glassmorphism', label: 'Frost' },
	{ id: 'skeuomorphism', label: 'Ranger' },
];

const VALID: Set<string> = new Set(STYLES.map((s) => s.id));

/** Read persisted style from cookie */
export function getStoredStyle(): StyleName {
	const v = getPreferenceCookie('paw-style');
	if (v && VALID.has(v)) return v as StyleName;
	return 'default';
}

/** Apply style to document and persist to cookie */
export function applyStyle(style: StyleName): void {
	if (typeof document === 'undefined') return;
	if (style === 'default') {
		document.documentElement.removeAttribute('data-style');
		// Always delete the cookie so the server doesn't inject a stale style
		deleteCookie('paw-style');
	} else {
		document.documentElement.setAttribute('data-style', style);
		setPreferenceCookie('paw-style', style);
	}
}
