import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		fs: {
			// The /handbook page imports docs/*.md from the sibling repo root via
			// `?raw`. Allow Vite to read one level above the web/ root.
			allow: ['..']
		}
	}
});
