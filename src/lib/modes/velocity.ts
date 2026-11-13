/**
 * ADS-B airborne velocity (TC 19).
 *
 * ME field (56 bits):
 *
 *   TC (5) | ST (3) | IC (1) | IFR (1) | NACv (3) | 22 bits, depending on ST
 *          | VrSrc (1) | Svr (1) | VR (9) | reserved (2) | SDif (1) | dAlt (7)
 *
 * Subtype 1/2: ground speed, as two components: east-west and north-south.
 *              speed = √(ew² + ns²), track = atan2(ew, ns).
 *   S-EW (1) | V-EW (10) | S-NS (1) | V-NS (10)
 *
 * Subtype 3/4: airspeed and heading, for aircraft that can't measure their ground speed.
 *   SH (1) | HDG (10) | T (1) | AS (10)
 *
 * Subtypes 2 and 4 are "supersonic": the same fields in units of 4 kt.
 * Raw values are offset by one throughout: 0 means "not available", 1 means 0.
 *
 * Shared by server and browser; no state here.
 */
import { bits } from './frame';

export interface Velocity {
	kind: 'velocity';
	subtype: number;
	/** NACv: how accurate the velocity is. 0 unknown, 1 < 10 m/s, 2 < 3 m/s, 3 < 1 m/s, 4 < 0.3 m/s. */
	nacV: number;
	/** IC: the aircraft's intent (e.g. selected altitude) changed in the last 4 s. Versions
	 * 0/1; reserved in version 2. In TIS-B/ADS-R this bit is the IMF instead (see imf()). */
	intentChange: boolean;
	/** IFR: equipped for instrument flight rules (class A1 or above). Versions 0/1; reserved since. */
	ifrCapability: boolean;
	/** Subtype 1/2: speed and direction over the ground (what moves the dot on the map). */
	ground: { speed: number; track: number } | null;
	/** Subtype 3/4: speed through the air and where the nose points. */
	air: { speed: number | null; type: 'IAS' | 'TAS'; heading: number | null } | null;
	/** ft/min, positive = climbing. */
	verticalRate: number | null;
	verticalRateSource: 'GNSS' | 'baro';
	/** GNSS height minus barometric altitude, in feet. Shows the weather: baro altitude
	 * assumes a standard atmosphere, so this grows in warm air and turns negative in cold. */
	gnssMinusBaro: number | null;
}

export function velocity(me: Uint8Array): Velocity | null {
	if (bits(me, 1, 5) !== 19) return null;
	const subtype = bits(me, 6, 3);
	if (subtype < 1 || subtype > 4) return null;
	const scale = subtype === 2 || subtype === 4 ? 4 : 1;

	let ground: Velocity['ground'] = null;
	let air: Velocity['air'] = null;
	if (subtype <= 2) {
		const ew = component(bits(me, 14, 1), bits(me, 15, 10), scale);
		const ns = component(bits(me, 25, 1), bits(me, 26, 10), scale);
		if (ew !== null && ns !== null) {
			// atan2(x, y) instead of the usual (y, x): track counts clockwise from north.
			const track = (Math.atan2(ew, ns) * 180) / Math.PI;
			ground = { speed: Math.hypot(ew, ns), track: (track + 360) % 360 };
		}
	} else {
		const speed = bits(me, 26, 10);
		air = {
			speed: speed === 0 ? null : (speed - 1) * scale,
			type: bits(me, 25, 1) ? 'TAS' : 'IAS',
			heading: bits(me, 14, 1) ? (bits(me, 15, 10) * 360) / 1024 : null
		};
	}

	const vr = bits(me, 38, 9);
	const dAlt = bits(me, 50, 7);
	return {
		kind: 'velocity',
		subtype,
		nacV: bits(me, 11, 3),
		intentChange: bits(me, 9, 1) === 1,
		ifrCapability: bits(me, 10, 1) === 1,
		ground,
		air,
		verticalRate: vr === 0 ? null : signed(bits(me, 37, 1), (vr - 1) * 64),
		verticalRateSource: bits(me, 36, 1) ? 'baro' : 'GNSS',
		// 127 means "more than 3,137 ft": out of range, treated as unknown.
		gnssMinusBaro: dAlt === 0 || dAlt === 127 ? null : signed(bits(me, 49, 1), (dAlt - 1) * 25)
	};
}

/** Sign bit 1 = west/south (negative); magnitude 0 = unknown, else value − 1 knots. */
function component(sign: number, magnitude: number, scale: number): number | null {
	if (magnitude === 0) return null;
	return signed(sign, (magnitude - 1) * scale);
}

/** Sign bit + magnitude. Avoids −0, which JavaScript has and prints as "-0" in places. */
function signed(sign: number, magnitude: number): number {
	return sign && magnitude ? -magnitude : magnitude;
}
