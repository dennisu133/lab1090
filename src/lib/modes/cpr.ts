/**
 * Compact Position Reporting (CPR): how ADS-B fits a position into 2 × 17 bits.
 *
 * The idea: the world is cut into latitude bands ("zones"). A message only says *where inside
 * its zone* the aircraft is, as a fraction 0…1 in 17 bits (~5 m resolution). Which zone it is
 * in is left out, and has to come from somewhere else:
 *
 * - Local decoding: a reference point less than half a zone away (about 180 NM) picks the
 *   zone: the one whose copy of the fraction lands closest to the reference. Simple, works
 *   from one message, but a reference that's too far away gives a wrong answer *silently*.
 *
 * - Global decoding: aircraft alternate between two grids, "even" with 60 latitude zones and
 *   "odd" with 59. The two zone sizes differ just enough that one even and one odd message
 *   together pin down the zone, like a vernier scale. No reference needed, but it needs two
 *   messages close together in time.
 *
 * Longitude works the same way, except the number of longitude zones shrinks towards the
 * poles (see nl()), so each zone stays roughly the same width on the ground.
 *
 * Airborne positions only (surface positions use quarter-size zones). Shared by server and
 * browser; no state here.
 */
import type { Cpr } from './position';

export interface LatLon {
	lat: number;
	lon: number;
}

/** 2^17: the 17-bit fields are fractions of a zone. */
const SCALE = 131072;

/** Latitude zones per quadrant: 4 × 15 = 60 even zones, 59 odd ones. */
const NZ = 15;

/** Height of a latitude zone in degrees: 6° (even) or 6.1° (odd). */
function latZone(format: Cpr['format']): number {
	return 360 / (4 * NZ - (format === 'odd' ? 1 : 0));
}

/**
 * The number of longitude zones at a latitude: 59 at the equator, falling to 1 at the poles,
 * chosen so that a zone is about as wide as it is high (6° of latitude ≈ 360 NM). It's
 * the formula from the spec (DO-260B A.1.7.2): the circumference shrinks with cos(lat).
 */
export function nl(lat: number): number {
	const a = Math.abs(lat);
	if (a === 0) return 59;
	if (a === 87) return 2;
	if (a > 87) return 1;
	const cosLat = Math.cos((Math.PI / 180) * a);
	return Math.floor(
		(2 * Math.PI) / Math.acos(1 - (1 - Math.cos(Math.PI / (2 * NZ))) / (cosLat * cosLat))
	);
}

/** The width of a longitude zone at `lat`, in degrees (odd: one zone fewer, so a bit wider). */
function lonZone(lat: number, format: Cpr['format']): number {
	return 360 / Math.max(nl(lat) - (format === 'odd' ? 1 : 0), 1);
}

/**
 * Decode one message with a reference point. Of all the zones, pick the one where this
 * fraction lands nearest to the reference: floor(0.5 + …) is "round to the nearest zone".
 * Correct if the aircraft is less than half a zone from the reference; otherwise it lands in
 * a neighbouring zone, a whole zone (~360 NM) off, and nothing in the result says so.
 */
export function decodeLocal(cpr: Cpr, reference: LatLon): LatLon {
	const fLat = cpr.lat / SCALE;
	const fLon = cpr.lon / SCALE;

	const dLat = latZone(cpr.format);
	const j = Math.floor(0.5 + reference.lat / dLat - fLat);
	const lat = dLat * (j + fLat);

	const dLon = lonZone(lat, cpr.format);
	const m = Math.floor(0.5 + reference.lon / dLon - fLon);
	return { lat, lon: wrapLon(dLon * (m + fLon)) };
}

/**
 * Decode an even/odd pair. The result is the position of the newer message. null if the
 * two disagree about the number of longitude zones: the aircraft crossed a zone boundary
 * between them, so they can't be combined.
 *
 * The pair must be recent (10 s is the usual limit): this can't tell if the aircraft moved
 * too far in between, it would just give a wrong position.
 */
export function decodeGlobal(even: Cpr, odd: Cpr, newer: Cpr['format']): LatLon | null {
	const latE = even.lat / SCALE;
	const latO = odd.lat / SCALE;

	// The latitude zone index: the "vernier" step. 59 even zones and 60 odd zones cover
	// the same distance, so this difference only fits one zone number.
	const j = Math.floor(59 * latE - 60 * latO + 0.5);
	const rlatE = wrapLat(latZone('even') * (mod(j, 60) + latE));
	const rlatO = wrapLat(latZone('odd') * (mod(j, 59) + latO));
	if (nl(rlatE) !== nl(rlatO)) return null;

	const lat = newer === 'even' ? rlatE : rlatO;
	const n = nl(lat);
	const zones = Math.max(n - (newer === 'odd' ? 1 : 0), 1);
	const lonE = even.lon / SCALE;
	const lonO = odd.lon / SCALE;
	const m = Math.floor(lonE * (n - 1) - lonO * n + 0.5);
	const lon = wrapLon((360 / zones) * (mod(m, zones) + (newer === 'even' ? lonE : lonO)));

	if (Math.abs(lat) > 90) return null; // an impossible pair, e.g. mixed up aircraft
	return { lat, lon };
}

/** Near the date line, the nearest zone can be on the other side of ±180°. */
function wrapLon(lon: number): number {
	return lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
}

/** Southern latitudes come out as 270–360°. */
function wrapLat(lat: number): number {
	return lat >= 270 ? lat - 360 : lat;
}

/** Modulo that's never negative (JavaScript's % keeps the sign of the dividend). */
function mod(a: number, b: number): number {
	return a - b * Math.floor(a / b);
}

/**
 * Remembers each aircraft's latest even and odd message, to pair them for global decoding.
 * The only state in this file: callers keep one per stream.
 */
export class CprPairs {
	#latest = new Map<string, { even?: Stamped; odd?: Stamped }>();

	constructor(readonly maxAgeMs = 10_000) {}

	/**
	 * Remember this message. If the same aircraft sent one from the other grid within
	 * maxAgeMs, return the global position (for this message, the newer of the two).
	 */
	add(icao: string, cpr: Cpr, t: number): LatLon | null {
		const latest = this.#latest.get(icao) ?? {};
		latest[cpr.format] = { cpr, t };
		this.#latest.set(icao, latest);

		const partner = latest[cpr.format === 'even' ? 'odd' : 'even'];
		if (!partner || t - partner.t > this.maxAgeMs) return null;
		return cpr.format === 'even'
			? decodeGlobal(cpr, partner.cpr, 'even')
			: decodeGlobal(partner.cpr, cpr, 'odd');
	}

	/** Forget aircraft not heard from in a while. */
	prune(now: number): void {
		for (const [icao, { even, odd }] of this.#latest) {
			if (Math.max(even?.t ?? 0, odd?.t ?? 0) < now - this.maxAgeMs) this.#latest.delete(icao);
		}
	}
}

interface Stamped {
	cpr: Cpr;
	t: number;
}
