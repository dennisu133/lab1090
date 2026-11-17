import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { settings } from '#lib/server/live-settings.ts';
import type { LayoutServerLoad } from './$types';

/**
 * Every page decodes in the browser, and most need the receiver's position: the reference
 * for local CPR decoding and surface positions, the tracker's range check and antenna, the
 * magnetic declination and geoid for the weather. The layout's streams (streams.ts) run all
 * the time, so the position comes with the layout. Sent with the page data, not baked into
 * the JavaScript bundle. Without one (first start), every page sends you to /setup.
 */
export const load: LayoutServerLoad = () => {
	const reference = settings.position;
	if (!reference) redirect(307, resolve('/setup'));
	return { reference };
};
