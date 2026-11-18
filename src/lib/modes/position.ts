/**
 * ADS-B positions, the raw fields: airborne (TC 0, 9–18, 20–22) and, further down, surface
 * (TC 5–8). Turning the CPR values into latitude/longitude needs a second message or a
 * reference point: see cpr.ts.
 *
 * Airborne ME field (56 bits):
 *
 *   TC (5) | SS (2) | NIC-B (1) | ALT (12) | T (1) | F (1) | LAT-CPR (17) | LON-CPR (17)
 *
 * Shared by server and browser; no state here.
 */
import { squitterAltitude, type Altitude } from './altitude';
import { bits } from './frame';

export interface AirbornePosition {
	kind: 'airborne-position';
	tc: number;
	/** SS: 0 none, 1 permanent alert (emergency squawk), 2 temporary alert (squawk changed), 3 SPI. */
	surveillanceStatus: number;
	/** In ADS-B v2 one bit of the integrity code, with the TC and TC 31's supplements. */
	nicB: number;
	/** Barometric for TC 9–18 (and TC 0, if filled), GNSS height for TC 20–22. */
	altitude: Altitude;
	altitudeSource: 'baro' | 'gnss';
	/** Compact Position Reporting. null for TC 0: no position available. */
	cpr: Cpr | null;
	/** T: the position was taken exactly on a 0.2 s UTC epoch. */
	utcSync: boolean;
}

export interface Cpr {
	/** F: aircraft alternate between two slightly different grids, "even" (0) and "odd" (1). */
	format: 'even' | 'odd';
	/** 17-bit position inside a grid zone: 0 = zone start, 131071 = almost the next zone. */
	lat: number;
	lon: number;
}

export function airbornePosition(me: Uint8Array): AirbornePosition | null {
	const tc = bits(me, 1, 5);
	if (!(tc === 0 || (tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22))) return null;
	const gnss = tc >= 20;
	const ac12 = bits(me, 9, 12);
	return {
		kind: 'airborne-position',
		tc,
		surveillanceStatus: bits(me, 6, 2),
		nicB: bits(me, 8, 1),
		altitude: gnss
			? // GNSS height: a plain number of metres (above the WGS84 ellipsoid). 3.28084 ft/m is
				// 1/FT (units.ts) rounded, as pyModeS has it: the oracle tests compare against it.
				ac12 === 0
				? { feet: null, encoding: 'none' }
				: { feet: Math.round(ac12 * 3.28084), encoding: 'GNSS' }
			: squitterAltitude(ac12),
		altitudeSource: gnss ? 'gnss' : 'baro',
		cpr:
			tc === 0
				? null
				: {
						format: bits(me, 22, 1) ? 'odd' : 'even',
						lat: bits(me, 23, 17),
						lon: bits(me, 40, 17)
					},
		utcSync: bits(me, 21, 1) === 1
	};
}

export const SURVEILLANCE_STATUS = [
	'No condition',
	'Permanent alert (emergency squawk)',
	'Temporary alert (squawk changed)',
	'SPI (pilot pressed IDENT)'
];

// ---------------------------------------------------------------------------------------
// Surface position (TC 5–8), aircraft and vehicles on the ground:
//
//   TC (5) | MOV (7) | S (1) | TRK (7) | T (1) | F (1) | LAT-CPR (17) | LON-CPR (17)
//
// No altitude (it's on the ground). Instead: how fast it moves, and in which direction.
// The CPR fields use zones a quarter the size of the airborne ones (see cpr.ts), so a surface
// position is 4× as fine (about 1.25 m), but needs a reference to decode, even as a pair.

export interface SurfacePosition {
	kind: 'surface-position';
	tc: number;
	movement: Movement;
	/** Degrees, 360/128 (2.8°) steps; null if the status bit says it's not valid. Ground
	 * track, or the aircraft's heading: the operational status (TC 31, TAH) says which. */
	track: number | null;
	cpr: Cpr;
	/** T: the position was taken exactly on a 0.2 s UTC epoch. (IMF in TIS-B/ADS-R, see imf().) */
	utcSync: boolean;
}

/**
 * MOV: ground speed on a non-linear scale, fine when slow (taxiing), coarse when fast
 * (taking off). Each code stands for a range of speeds; `min` < speed ≤ `max`, in knots.
 */
export interface Movement {
	code: number;
	/** null: no information (code 0) or reserved (125–127). */
	speed: { min: number; max: number | null } | null;
	stopped: boolean;
}

/** Steps of the movement scale: from `code` on, `kt` plus `step` per code (DO-260B 2.2.3.2.4.2). */
const MOVEMENT = [
	{ code: 9, kt: 1, step: 0.25 },
	{ code: 13, kt: 2, step: 0.5 },
	{ code: 39, kt: 15, step: 1 },
	{ code: 94, kt: 70, step: 2 },
	{ code: 109, kt: 100, step: 5 }
];

/**
 * The movement scale. Codes 2–8 changed with ADS-B version 2: before, seven steps of
 * 0.125 kt from 0.125 to 1 kt; since, code 2 means "below 0.125 kt" and 3–8 split
 * 0.125–1 kt in six steps. The rest is the same in all versions. The version comes from the
 * aircraft's operational status (TC 31); version 2 is what nearly every aircraft sends.
 */
export function movement(code: number, version = 2): Movement {
	const result = (min: number, max: number | null) => ({
		code,
		speed: { min, max },
		stopped: code === 1
	});
	if (code === 0 || code >= 125) return { code, speed: null, stopped: false };
	if (code === 1) return result(0, version >= 2 ? 0 : 0.125);
	if (code === 124) return result(175, null);
	if (code <= 8) {
		if (version < 2) return result(0.125 * (code - 1), 0.125 * code);
		if (code === 2) return result(0, 0.125);
		const step = 0.875 / 6;
		return result(0.125 + step * (code - 3), 0.125 + step * (code - 2));
	}
	const band = MOVEMENT.findLast((b) => code >= b.code)!;
	const min = band.kt + band.step * (code - band.code);
	return result(min, min + band.step);
}

export function surfacePosition(me: Uint8Array): SurfacePosition | null {
	const tc = bits(me, 1, 5);
	if (tc < 5 || tc > 8) return null;
	return {
		kind: 'surface-position',
		tc,
		movement: movement(bits(me, 6, 7)),
		track: bits(me, 13, 1) ? (bits(me, 14, 7) * 360) / 128 : null,
		cpr: { format: bits(me, 22, 1) ? 'odd' : 'even', lat: bits(me, 23, 17), lon: bits(me, 40, 17) },
		utcSync: bits(me, 21, 1) === 1
	};
}
