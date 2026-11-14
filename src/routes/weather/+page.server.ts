import { REFERENCE_POINT } from '$app/env/private';
import type { PageServerLoad } from './$types';

/**
 * The page computes the wind in the browser, and needs the magnetic declination for it:
 * at the aircraft's own ADS-B position, or at the receiver's for aircraft without one. So
 * it gets the (rounded) reference point, like /frames.
 */
export const load: PageServerLoad = () => ({ reference: REFERENCE_POINT });
