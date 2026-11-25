import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, type DemoManifest } from '#lib/demo/manifest.ts';

/**
 * The static demo's data, made by tools/demo.ts: served under /demo (`dev:demo` by Vite,
 * `build:demo` copies it into the site). Its manifest's position goes into the pages.
 */
export const DEMO_DATA = 'demo-data';

let manifest: DemoManifest | undefined;

export function demoManifest(): DemoManifest {
	if (manifest) return manifest;
	try {
		manifest = JSON.parse(readFileSync(join(DEMO_DATA, MANIFEST_FILE), 'utf8')) as DemoManifest;
	} catch (e) {
		throw new Error(
			`${DEMO_DATA}/${MANIFEST_FILE}: ${(e as Error).message}. Make it first: bun tools/demo.ts`,
			{ cause: e }
		);
	}
	return manifest;
}
