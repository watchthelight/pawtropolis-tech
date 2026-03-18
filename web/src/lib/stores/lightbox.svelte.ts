/** Global lightbox state — open from anywhere, rendered once in the root layout. */

let url = $state<string | null>(null);

/** Open the lightbox with a Discord CDN image URL (auto-upgrades to full-res). */
export function openLightbox(imageUrl: string) {
	let fullRes = imageUrl.replace(/\?size=\d+/, '?size=4096');
	if (!fullRes.includes('?')) fullRes += '?size=4096';
	url = fullRes;
}

export function closeLightbox() {
	url = null;
}

export function getLightboxUrl(): string | null {
	return url;
}
