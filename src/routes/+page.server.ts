import { RECEIVER_POSITION } from '$app/env/private';
import type { PageServerLoad } from './$types';

/**
 * The tracker decodes in the browser, so it needs the receiver's position: the reference
 * for the range check and surface positions, and the antenna on the map with its range
 * rings. Sent to this page only (not baked into the JavaScript bundle).
 */
export const load: PageServerLoad = () => ({ receiver: RECEIVER_POSITION });
