import { readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-bun';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Build } from 'bun';

// Tests don't go through Vite: they run with Bun's built-in runner (`bun test`).
export default defineConfig(({ mode }) => ({
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

			adapter:
				mode === 'demo'
					? // The static demo (`bun run build:demo`, lib/demo/): every page made at build
						// time, into build-demo/, for any static host. Pages it doesn't have (/receiver,
						// /setup, a mistyped address) get 404.html, which the app renders as its "not
						// found" page.
						staticAdapter({ pages: 'build-demo', assets: 'build-demo', fallback: '404.html' })
					: // Builds a standalone Bun server: `bun run build`, then `bun ./build`.
						// See https://svelte.dev/docs/kit/adapter-bun
						// COMPILE=<bun target> (e.g. bun-linux-arm64, or "native") builds one executable
						// instead, client files embedded: build/lab1090.
						// precompress: every script and stylesheet also as .gz and .br, sent to browsers
						// that accept them (a third to a quarter of the bytes). adapter-bun leaves them out
						// of an executable; patches/ makes it embed them too. The patch is for adapter-bun
						// 1.0.2 only: after updating the adapter, redo it (or drop it if upstream embeds
						// them by then).
						adapter({
							precompress: true,
							...(process.env.COMPILE && {
								buildOptions: {
									compile: {
										outfile: 'lab1090',
										...(process.env.COMPILE !== 'native' && {
											target: process.env.COMPILE as Build.CompileTarget
										})
									},
									minify: true
								}
							})
						})
		}),
		mode === 'demo' && demoData()
	]
}));

/**
 * `bun run dev:demo`: the demo's data (tools/demo.ts, in demo-data/) under /demo, as the
 * built site has it (build:demo copies it there).
 */
function demoData(): Plugin {
	return {
		name: 'lab1090-demo-data',
		configureServer(server) {
			server.middlewares.use('/demo', (req, res, next) => {
				const file = normalize(join('demo-data', decodeURIComponent(req.url!.split('?')[0])));
				if (!file.startsWith('demo-data/') || !statSync(file, { throwIfNoEntry: false })?.isFile())
					return next();
				res.setHeader(
					'content-type',
					file.endsWith('.json') ? 'application/json' : 'application/gzip'
				);
				res.end(readFileSync(file));
			});
		}
	};
}
