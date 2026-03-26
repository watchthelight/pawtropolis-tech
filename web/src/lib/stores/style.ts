export type StyleName = 'default' | 'neumorphism' | 'glassmorphism' | 'skeuomorphism';

export const STYLES: { id: StyleName; label: string }[] = [
	{ id: 'default', label: 'Holdfast' },
	{ id: 'neumorphism', label: 'Soft' },
	{ id: 'glassmorphism', label: 'Frost' },
	{ id: 'skeuomorphism', label: 'Ranger' },
];

const STORAGE_KEY = 'paw-style';

const VALID: Set<string> = new Set(STYLES.map((s) => s.id));

/** Read persisted style from localStorage */
export function getStoredStyle(): StyleName {
	if (typeof localStorage === 'undefined') return 'default';
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v && VALID.has(v)) return v as StyleName;
	} catch {}
	return 'default';
}

/** Apply style to document and persist */
export function applyStyle(style: StyleName): void {
	if (typeof document === 'undefined') return;
	if (style === 'default') {
		document.documentElement.removeAttribute('data-style');
	} else {
		document.documentElement.setAttribute('data-style', style);
	}
	try {
		localStorage.setItem(STORAGE_KEY, style);
	} catch {}
}
