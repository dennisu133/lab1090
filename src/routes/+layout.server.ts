import { RECEIVER_POSITION } from '$app/env/private';
import type { LayoutServerLoad } from './$types';

/**
 * Every page decodes in the browser, and most need the receiver's position: the reference
 * for local CPR decoding and surface positions, the tracker's range check and antenna, the
 * magnetic declination and geoid for the weather. The layout's streams (streams.ts) run all
 * the time, so the position comes with the layout. Sent with the page data, not baked into
 * the JavaScript bundle.
 */
export const load: LayoutServerLoad = () => ({ reference: RECEIVER_POSITION });
