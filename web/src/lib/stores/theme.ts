export const FALLBACK_HUE = 250;

/**
 * Convert sRGB to oklch chroma and hue.
 * Uses Bjorn Ottosson's Oklab color space for perceptually uniform hue extraction.
 */
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

function rgbToHue(r: number, g: number, b: number): number | null {
	const result = rgbToChromaAndHue(r, g, b);
	return result && result.chroma >= 0.02 ? result.hue : null;
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

				// Find the most chromatic pixels and compute circular mean hue
				let sinSum = 0;
				let cosSum = 0;
				let weightSum = 0;

				for (let i = 0; i < data.length; i += 4) {
					const r = data[i], g = data[i + 1], b = data[i + 2];
					// Skip near-black pixels (background)
					if (r + g + b < 60) continue;

					const result = rgbToChromaAndHue(r, g, b);
					if (result && result.chroma > 0.03) {
						// Weight by chroma squared — strongly favor saturated pixels
						const w = result.chroma * result.chroma;
						const rad = result.hue * (Math.PI / 180);
						sinSum += Math.sin(rad) * w;
						cosSum += Math.cos(rad) * w;
						weightSum += w;
					}
				}

				if (weightSum > 0) {
					const avgHue = (Math.atan2(sinSum, cosSum) * (180 / Math.PI) + 360) % 360;
					resolve(avgHue);
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

let _activeUserId: string | null = null;

function setHue(hue: number): void {
	if (typeof document !== 'undefined') {
		const rounded = String(Math.round(hue));
		const root = document.documentElement.style;
		root.setProperty('--hue', rounded);
		root.setProperty('--hue-secondary', String(Math.round((hue + 150) % 360)));
		root.setProperty('--hue-tertiary', String(Math.round((hue + 40) % 360)));
		root.setProperty('--hue-complement', String(Math.round((hue + 180) % 360)));
		if (_activeUserId) {
			try {
				localStorage.setItem(`theme-hue-${_activeUserId}`, rounded);
				localStorage.setItem('theme-last-uid', _activeUserId);
			} catch {}
		}
	}
}

/**
 * Restore cached hue for a specific user from localStorage.
 * Call synchronously before applyTheme to prevent flash on reload.
 */
export function restoreCachedHue(userId: string): void {
	if (typeof document === 'undefined') return;
	try {
		const cached = localStorage.getItem(`theme-hue-${userId}`);
		if (cached) {
			const h = parseInt(cached);
			const root = document.documentElement.style;
			root.setProperty('--hue', cached);
			root.setProperty('--hue-secondary', String((h + 150) % 360));
			root.setProperty('--hue-tertiary', String((h + 40) % 360));
			root.setProperty('--hue-complement', String((h + 180) % 360));
		}
	} catch {}
}

/**
 * Apply theme from Discord accent color.
 * Falls back to avatar color extraction when accent_color is 0/null.
 */
export function applyTheme(accentColor: number | null, avatarUrl?: string | null, userId?: string): void {
	if (userId) _activeUserId = userId;
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
