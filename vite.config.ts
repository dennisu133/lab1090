import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';

// Tests don't go through Vite: they run with Bun's built-in runner (`bun test`).
export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Builds a standalone Bun server: `bun run build`, then `bun ./build`.
			// See https://svelte.dev/docs/kit/adapter-bun
			adapter: adapter()
		})
	]
});
