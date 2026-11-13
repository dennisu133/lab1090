/**
 * ADS-B airborne position (TC 0, 9–18, 20–22), the raw fields. Turning the CPR values into
 * latitude/longitude needs a second message or a reference point; that comes later.
 *
 * ME field (56 bits):
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
			? // GNSS height: a plain number of metres (above the WGS84 ellipsoid).
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
