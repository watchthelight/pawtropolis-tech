/**
 * Reactive wrapper around the plain appearance helpers so the sidebar Night/Day
 * control, the floating Legacy switch, and the tweak panel all share one source
 * of truth and stay in sync when any of them changes the theme.
 */

import {
	getStoredMode,
	applyMode,
	toggleNightDay,
	setLegacy,
	getStoredAppearance,
	applyHeadFont,
	applySageHue,
	applySageChroma,
	setStarDensity,
	setStarSpeed,
	DEFAULT_APPEARANCE,
	type ThemeMode,
	type HeadFont,
	type Appearance
} from './appearance';

let _mode = $state<ThemeMode>('observatory-dark');
let _a = $state<Appearance>({ ...DEFAULT_APPEARANCE });

/** Seed reactive state from persisted prefs. Call once on mount. */
export function initAppearance(): void {
	_a = getStoredAppearance();
	_mode = _a.mode;
}

export function mode(): ThemeMode {
	return _mode;
}
export function appearance(): Appearance {
	return _a;
}
export function isLegacyMode(): boolean {
	return _mode === 'legacy';
}
export function isLightMode(): boolean {
	return _mode === 'observatory-light';
}

function dispatchStar(): void {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event('paw:starfield'));
}

export function chooseMode(m: ThemeMode): void {
	_mode = m;
	applyMode(m);
	_a = { ..._a, mode: m };
}
export function nightDay(): void {
	_mode = toggleNightDay(_mode);
	_a = { ..._a, mode: _mode };
}
export function chooseLegacy(on: boolean): void {
	_mode = setLegacy(on);
	_a = { ..._a, mode: _mode };
}
export function chooseFont(f: HeadFont): void {
	applyHeadFont(f);
	_a = { ..._a, headFont: f };
}
export function chooseSageHue(h: number): void {
	applySageHue(h);
	_a = { ..._a, sageH: h };
}
export function chooseSageChroma(c: number): void {
	applySageChroma(c);
	_a = { ..._a, sageC: c };
}
export function chooseStarDensity(v: number): void {
	setStarDensity(v);
	_a = { ..._a, starDensity: v };
	dispatchStar();
}
export function chooseStarSpeed(v: number): void {
	setStarSpeed(v);
	_a = { ..._a, starSpeed: v };
	dispatchStar();
}
