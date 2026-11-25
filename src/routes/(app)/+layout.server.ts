import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { DEMO } from '#lib/demo/mode.ts';
import { demoManifest } from '#lib/server/demo-data.ts';
import { settings } from '#lib/server/live-settings.ts';
import type { LayoutServerLoad } from './$types';

/** The demo is a static site: every page made at build time (DEMO). */
export const prerender = DEMO;

/**
 * Every page decodes in the browser, and most need the receiver's position: the reference
 * for local CPR decoding and surface positions, the tracker's range check and antenna, the
 * magnetic declination and geoid for the weather. The layout's streams (streams.ts) run all
 * the time, so the position comes with the layout. Sent with the page data, not baked into
 * the JavaScript bundle. Without one (first start), every page sends you to /setup.
 * The demo's is its recording's (demo-data/manifest.json), read when the pages are built.
 */
export const load: LayoutServerLoad = () => {
	if (DEMO) return { reference: demoManifest().reference };
	const reference = settings.position;
	if (!reference) redirect(307, resolve('/setup'));
	return { reference };
};
