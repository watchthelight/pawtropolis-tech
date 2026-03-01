const FALLBACK_HUE = 250;

/**
 * Convert Discord accentColor integer to oklch hue.
 * Uses Bjorn Ottosson's Oklab color space for perceptually uniform hue extraction.
 */
function accentColorToHue(accentColor: number): number {
	const r = (accentColor >> 16) & 0xff;
	const g = (accentColor >> 8) & 0xff;
	const b = accentColor & 0xff;

	// sRGB gamma decode -> linear RGB
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);

	// Linear RGB -> LMS (Oklab matrices)
	const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
	const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
	const s = 0.0883024619 * lr + 0.2220049256 * lg + 0.6696926125 * lb;

	// LMS -> Oklab (cube root)
	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	// Oklab -> oklch chroma and hue
	const chroma = Math.sqrt(okA * okA + okB * okB);
	if (chroma < 0.02) return FALLBACK_HUE; // Near-gray: hue unreliable

	const hue = Math.atan2(okB, okA) * (180 / Math.PI);
	return (hue + 360) % 360;
}

export function applyTheme(accentColor: number | null): void {
	const hue =
		accentColor != null ? accentColorToHue(accentColor) : FALLBACK_HUE;

	document.body.style.setProperty("--hue", String(Math.round(hue)));
}
