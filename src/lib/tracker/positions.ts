/**
 * Which decoded ADS-B positions to believe.
 *
 * CPR decoding (cpr.ts) always produces *a* position: nothing in the result says whether
 * it's right. What goes wrong in practice:
 *
 * - Local decoding with a reference more than half a zone (~180 NM) away picks the
 *   neighbouring zone: the position comes out a whole zone (~360 NM) off.
 * - Two messages paired that don't belong together (a different aircraft under the same
 *   address, or a bit the receiver's error correction "repaired" wrongly) give a position
 *   anywhere.
 *
 * Errors like these are hundreds of km, so the checks can be generous:
 *
 * 1. An aircraft's first position (a "fix") comes from an even/odd pair (global decoding).
 *    Never from the receiver's position as the reference: this receiver can hear aircraft
 *    up to ~250 NM away, past half a zone, where local decoding is silently wrong.
 * 2. After that, every message is decoded as a pair if it has a partner (usually: aircraft
 *    alternate even and odd twice a second), else relative to the aircraft's own last
 *    position (it can't have flown half a zone since). Either way it has to pass a speed
 *    check (could the aircraft have got there since?) and a range check (could we hear it
 *    there at all?).
 * 3. A fix is confirmed once the next position passes the checks against it. Until then
 *    the map doesn't show it: one bad pair would otherwise put a plane somewhere for a moment.
 * 4. If several positions in a row fail, the old position was probably the wrong one (a bad
 *    fix, or the aircraft vanished and came back elsewhere): start over from the latest pair.
 *
 * Surface positions (TC 5–8, aircraft on the ground) go through the same checks, in the
 * same track: a landing aircraft switches from airborne to surface messages, and its last
 * airborne position is a fine reference for the first surface one. Their grids differ
 * (zones a quarter the size, see cpr.ts), so they're paired separately, and a surface pair
 * needs a reference too, but only to pick the right quarter of the world: the receiver's
 * position (anything it hears is within 500 km, well inside the right quarter).
 *
 * The idea is readsb's (track.c: speed_check and the position reliability counters); the
 * numbers here are our own, chosen to be simple to explain.
 *
 * Shared by server and browser; state is the positions so far.
 */
import { distanceKm } from '#lib/geo.ts';
import {
	CprPairs,
	decodeLocal,
	decodeSurfaceGlobal,
	decodeSurfaceLocal,
	type LatLon
} from '#lib/modes/cpr.ts';
import type { Cpr } from '#lib/modes/position.ts';

export interface Located extends LatLon {
	/** When the message arrived, ms. */
	t: number;
	/** Global decoding (an even/odd pair) or local, relative to the aircraft's last position. */
	from: 'pair' | 'local';
	/** From a surface position message (TC 5–8): the aircraft is on the ground. */
	surface: boolean;
}

export type Outcome =
	/** A first position (or a fresh start after a gap): unconfirmed until the next one agrees. */
	| { kind: 'fix'; position: Located }
	/** Passed the checks against the last position. */
	| { kind: 'moved'; position: Located }
	/** Failed a check; the last position stays. */
	| { kind: 'rejected'; candidate: Located; reason: string }
	/** Failed MAX_STRIKES times in a row: the old position is dropped, this pair is the new fix. */
	| { kind: 'restart'; position: Located; reason: string }
	/** No position yet, and this message has no partner from the other grid to pair with. */
	| { kind: 'waiting' };

/**
 * Farther than this from the receiver, a position can't be real. The radio horizon (with
 * normal refraction, the "4/3 Earth" rule) is d ≈ 1.23·(√h₁ + √h₂) NM, heights in feet. For
 * an aircraft at FL450 and an antenna 30 ft up: 1.23·(212 + 5.5) ≈ 268 NM ≈ 496 km.
 */
export const MAX_RANGE_KM = 500;
/** Without a recent ground speed: faster than any airliner, even with a jet stream behind it. */
export const MAX_SPEED_KT = 1000;
/** With a ground speed: what it says plus this, for speed changes and timing. */
export const SPEED_MARGIN_KT = 200;
/**
 * Always allowed, however short the time. Messages are timed by when the server received
 * them, and the network can deliver a few at once; CPR itself is exact to ~5 m.
 */
export const SLACK_KM = 2;
/** After this many failed positions in a row, start over. */
export const MAX_STRIKES = 3;
/** A last position older than this isn't continued from: the next pair makes a fresh fix. */
export const CONTINUE_MS = 60_000;
/** Pairs further apart than this aren't combined (the usual 10 s for airborne positions). */
const PAIR_MS = 10_000;
/**
 * The same for surface positions. An aircraft that doesn't move sends one only every 5 s
 * (DO-260B's low rate), so 10 s would often miss its partner. Moving ones send twice a
 * second and always have a fresh partner. A pair only decodes right if the aircraft moved
 * less than ~1/120 of a zone in between (the vernier step in cpr.ts): 1.4 km on the
 * surface grid, and taxiing at 30 kt for 25 s is 0.4 km.
 */
const SURFACE_PAIR_MS = 25_000;

const KM_PER_NM = 1.852;

/** Why `to` can't follow `from` (null if it can). `groundSpeed`: the latest, in kt, if recent. */
export function speedProblem(
	from: LatLon & { t: number },
	to: LatLon & { t: number },
	groundSpeed: number | null
): string | null {
	const km = distanceKm(from, to);
	const hours = Math.max(0, to.t - from.t) / 3_600_000;
	const kt = groundSpeed === null ? MAX_SPEED_KT : groundSpeed + SPEED_MARGIN_KT;
	if (km <= SLACK_KM + kt * KM_PER_NM * hours) return null;
	const seconds = hours * 3600;
	return `${km.toFixed(1)} km from the last position in ${seconds.toFixed(1)} s: more than ${kt} kt${
		groundSpeed === null
			? ''
			: ` (its ground speed ${Math.round(groundSpeed)} + ${SPEED_MARGIN_KT})`
	} would allow`;
}

/** Why the receiver can't have heard an aircraft at `p` (null if it can). */
export function rangeProblem(p: LatLon, receiver: LatLon): string | null {
	const km = distanceKm(receiver, p);
	return km > MAX_RANGE_KM
		? `${Math.round(km)} km from the receiver: beyond the radio horizon (${MAX_RANGE_KM} km)`
		: null;
}

interface State {
	position: Located | null;
	confirmed: boolean;
	strikes: number;
	rejected: number;
}

export class Positions {
	#pairs = new CprPairs(PAIR_MS);
	#surfacePairs = new CprPairs(SURFACE_PAIR_MS);
	#state = new Map<string, State>();
	#receiver: () => LatLon;

	constructor(receiver: () => LatLon) {
		this.#receiver = receiver;
	}

	/** The latest believed position (null once it's older than CONTINUE_MS and a new message came), whether it's confirmed. */
	get(icao: string): { position: Located | null; confirmed: boolean; rejected: number } | null {
		const s = this.#state.get(icao);
		return s ? { position: s.position, confirmed: s.confirmed, rejected: s.rejected } : null;
	}

	/**
	 * One position message, in arrival order. `groundSpeed`: the aircraft's latest ground
	 * speed in kt, if recent (null: the generous MAX_SPEED_KT applies). `surface`: a surface
	 * position (TC 5–8) rather than an airborne one.
	 */
	add(icao: string, cpr: Cpr, t: number, groundSpeed: number | null, surface = false): Outcome {
		let s = this.#state.get(icao);
		if (!s) {
			s = { position: null, confirmed: false, strikes: 0, rejected: 0 };
			this.#state.set(icao, s);
		}
		const receiver = this.#receiver();
		const global = surface
			? this.#surfacePairs.add(icao, cpr, t, (even, odd, newer) =>
					decodeSurfaceGlobal(even, odd, newer, receiver)
				)
			: this.#pairs.add(icao, cpr, t);
		const pair: Located | null = global && { ...global, t, from: 'pair', surface };

		const last = s.position && t - s.position.t <= CONTINUE_MS ? s.position : null;
		if (!last) {
			s.position = null;
			s.confirmed = false;
			if (!pair) return { kind: 'waiting' };
			const reason = rangeProblem(pair, receiver);
			if (reason) {
				s.rejected++;
				return { kind: 'rejected', candidate: pair, reason };
			}
			s.position = pair;
			s.strikes = 0;
			return { kind: 'fix', position: pair };
		}

		// Local decoding is right within half a zone: 180 NM in the air, 45 NM on the surface.
		// The aircraft's own position from up to a minute ago is well within either.
		const local = surface ? decodeSurfaceLocal(cpr, last) : decodeLocal(cpr, last);
		const candidate: Located = pair ?? { ...local, t, from: 'local', surface };
		const outOfRange = rangeProblem(candidate, receiver);
		const reason = outOfRange ?? speedProblem(last, candidate, groundSpeed);
		if (!reason) {
			s.position = candidate;
			s.confirmed = true;
			s.strikes = 0;
			return { kind: 'moved', position: candidate };
		}
		s.rejected++;
		s.strikes++;
		// Only a pair can restart: a local decode is relative to the position in doubt.
		if (s.strikes >= MAX_STRIKES && pair && !outOfRange) {
			s.position = pair;
			s.confirmed = false;
			s.strikes = 0;
			return { kind: 'restart', position: pair, reason };
		}
		return { kind: 'rejected', candidate, reason };
	}

	/** Forget an aircraft (it went quiet). */
	delete(icao: string): void {
		this.#state.delete(icao);
	}

	prune(now: number): void {
		this.#pairs.prune(now);
		this.#surfacePairs.prune(now);
	}
}
