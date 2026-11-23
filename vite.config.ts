import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Build } from 'bun';

// Tests don't go through Vite: they run with Bun's built-in runner (`bun test`).
export default defineConfig({
	// `bun run dev --record` writes its file here, a second at a time: not a source file, so
	// no reloads for it.
	server: { watch: { ignored: ['**/*.sigmf.zst'] } },
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
			// COMPILE=<bun target> (e.g. bun-linux-arm64, or "native") builds one executable
			// instead, client files embedded: build/lab1090.
			adapter: adapter(
				process.env.COMPILE
					? {
							buildOptions: {
								compile: {
									outfile: 'lab1090',
									...(process.env.COMPILE !== 'native' && {
										target: process.env.COMPILE as Build.CompileTarget
									})
								},
								minify: true
							}
						}
					: {}
			)
		})
	]
});
