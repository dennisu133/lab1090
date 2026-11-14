import { REFERENCE_POINT } from '$app/env/private';
import type { LayoutServerLoad } from './$types';

/**
 * Both tabs compute in the browser, and the wind needs the magnetic declination: at the
 * aircraft's own ADS-B position, or at the receiver's for aircraft without one (the geoid
 * for GNSS heights too). So they get the (rounded) reference point, like /frames.
 */
export const load: LayoutServerLoad = () => ({ reference: REFERENCE_POINT });
