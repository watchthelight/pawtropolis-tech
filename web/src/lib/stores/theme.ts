export const FALLBACK_HUE = 250;

/**
 * Convert Discord accentColor integer to oklch hue.
 * Uses Bjorn Ottosson's Oklab color space for perceptually uniform hue extraction.
 */
function rgbToHue(r: number, g: number, b: number): number | null {
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
	if (chroma < 0.02) return null; // Near-gray: hue unreliable

	const hue = Math.atan2(okB, okA) * (180 / Math.PI);
	return (hue + 360) % 360;
}

/** Returns both chroma and hue for weighted averaging. */
function rgbToChromaAndHue(r: number, g: number, b: number): { chroma: number; hue: number } | null {
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);

	const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
	const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
	const s = 0.0883024619 * lr + 0.2220049256 * lg + 0.6696926125 * lb;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	const chroma = Math.sqrt(okA * okA + okB * okB);
	if (chroma < 0.01) return null;

	const hue = (Math.atan2(okB, okA) * (180 / Math.PI) + 360) % 360;
	return { chroma, hue };
}

function accentColorToHue(accentColor: number): number | null {
	const r = (accentColor >> 16) & 0xff;
	const g = (accentColor >> 8) & 0xff;
	const b = accentColor & 0xff;
	return rgbToHue(r, g, b);
}

/**
 * Extract dominant hue from an image URL.
 * Samples pixels and picks the most chromatic (colorful) ones,
 * ignoring dark/grey background pixels that would wash out the average.
 */
function extractImageHue(imageUrl: string): Promise<number | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const size = 16;
				const canvas = document.createElement('canvas');
				canvas.width = size;
				canvas.height = size;
				const ctx = canvas.getContext('2d');
				if (!ctx) { resolve(null); return; }
				ctx.drawImage(img, 0, 0, size, size);
				const data = ctx.getImageData(0, 0, size, size).data;

				// Find the most chromatic pixels and use their weighted hue
				let hueSum = 0;
				let chromaSum = 0;

				for (let i = 0; i < data.length; i += 4) {
					const r = data[i], g = data[i + 1], b = data[i + 2];
					// Skip near-black pixels (background)
					if (r + g + b < 60) continue;

					const result = rgbToChromaAndHue(r, g, b);
					if (result && result.chroma > 0.03) {
						// Weight by chroma squared — strongly favor saturated pixels
						const w = result.chroma * result.chroma;
						hueSum += result.hue * w;
						chromaSum += w;
					}
				}

				if (chromaSum > 0) {
					resolve(hueSum / chromaSum);
				} else {
					resolve(null);
				}
			} catch {
				resolve(null);
			}
		};
		img.onerror = () => resolve(null);
		img.src = imageUrl.includes('?') ? imageUrl.replace(/size=\d+/, 'size=64') : imageUrl + '?size=64';
	});
}

function setHue(hue: number): void {
	if (typeof document !== 'undefined') {
		document.body.style.setProperty('--hue', String(Math.round(hue)));
	}
}

/**
 * Apply theme from Discord accent color.
 * Falls back to avatar color extraction when accent_color is 0/null.
 */
export function applyTheme(accentColor: number | null, avatarUrl?: string | null): void {
	// Try accent color first (skip 0 = black, which Discord returns when theme isn't in API)
	if (accentColor && accentColor !== 0) {
		const hue = accentColorToHue(accentColor);
		if (hue != null) {
			setHue(hue);
			return;
		}
	}

	// Fallback: extract from avatar image
	if (avatarUrl && typeof document !== 'undefined') {
		extractImageHue(avatarUrl).then((hue) => {
			if (hue != null) {
				setHue(hue);
			} else {
				setHue(FALLBACK_HUE);
			}
		});
		return;
	}

	setHue(FALLBACK_HUE);
}
