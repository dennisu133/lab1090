/**
 * Does the route adsbdb gives for a callsign fit what the aircraft actually does?
 *
 * Routes are looked up by callsign (lib/aircraft-db.ts), and callsigns get reused: an
 * airline flies the same callsign on another route next season, the database lags behind,
 * the outbound and return flights get mixed up. Nothing in the radio messages says where a
 * flight goes, so the only check is the aircraft itself. Two questions, both from positions
 * only:
 *
 * 1. Is it anywhere near the way? Going from origin O to destination D via the aircraft's
 *    position P is d(O,P) + d(P,D) long; the direct way (the great circle) is d(O,D). The
 *    difference is the detour this position would mean. Real flights aren't straight: they
 *    follow airways, go round closed airspace, get vectored around airports, so a detour of
 *    a few percent is normal and some take far more (Europe–Asia around Russia, about a
 *    fifth). Allowed: MAX_DETOUR of the direct way, at least MIN_DETOUR_KM. The positions
 *    allowed form an ellipse with O and D as its foci: wide enough for all of that, and a
 *    flight from London to Lanzarote won't fit over Berlin.
 *
 * 2. Is it going the right way? An ellipse can't tell a flight from Valencia to Berlin from
 *    one from Berlin to Valencia. Over the last few minutes of trail: going the right way,
 *    it gets closer to D or further from O (just after take-off it may fly away from D for
 *    a while, but it's leaving O; on an approach it may fly past D, but then it's not coming
 *    back towards O). Backwards means both at once: closer to O and further from D. Each
 *    has to be at least PROGRESS of the distance flown in that time, so a turn, a holding
 *    pattern or a short wiggle says nothing (unclear).
 *
 * The heading is never used: near airports air traffic control steers aircraft wherever the
 * traffic needs them, and in a holding they fly in circles. Positions don't lie that way.
 *
 * A route that doesn't fit is most likely another flight's, so it isn't shown at all
 * (RouteJudge): either the database is right and the route is shown, or it's ignored.
 *
 * checkRoute is pure: the aircraft's snapshot and the route in, a verdict and its numbers
 * out. RouteJudge remembers rejections, so a route doesn't come back in the next turn.
 */
import type { DbAirport, DbRoute } from '#lib/aircraft-db.ts';
import { distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import type { TrackedAircraft } from './tracker';
import type { TrailPoint } from './trail';

/** The detour allowed, as a fraction of the direct way… */
export const MAX_DETOUR = 0.25;
/** …but at least this much (short flights get vectored and held just like long ones). */
export const MIN_DETOUR_KM = 100;
/** How much trail the direction is judged by, at most, and at least. */
export const PROGRESS_WINDOW_MS = 5 * 60_000;
export const MIN_PROGRESS_WINDOW_MS = 2 * 60_000;
/** Of the distance flown in that window, at least this much has to be progress (or regress). */
export const PROGRESS = 0.5;
/** Less than this flown in the window (taxiing, parked): the direction can't be judged. */
const MIN_FLOWN_KM = 5;

export interface Leg {
	from: DbAirport;
	to: DbAirport;
}

export interface Progress {
	/** How much closer to `to` it got, km (negative: further away). */
	closer: number;
	/** How much further from `from` it got, km (negative: closer). */
	away: number;
	/** The length of its trail in that time, km. */
	flown: number;
	/** The time it covers, ms. */
	ms: number;
}

export interface RouteCheck {
	/**
	 * fits: near the way and going the right way. off-route: too far from it. backwards:
	 * coming from the destination, going to the origin. unknown: no position, too little
	 * trail yet, or not clearly going either way (turning, holding).
	 */
	verdict: 'fits' | 'off-route' | 'backwards' | 'unknown';
	/** The leg judged: origin to destination, or the leg to or from the stop on the way. */
	leg: Leg;
	/** The direct way, km. */
	directKm: number;
	/** From the leg's start to the aircraft, and from there to the leg's end, km. */
	fromKm: number;
	toGoKm: number;
	/** fromKm + toGoKm − directKm. */
	detourKm: number;
	/** What's allowed for this leg. */
	maxDetourKm: number;
	/** null: less than MIN_PROGRESS_WINDOW_MS of trail. */
	progress: Progress | null;
}

/** The legs of a route: one, or two with a stop on the way. */
function legs(route: DbRoute): Leg[] {
	return route.via
		? [
				{ from: route.origin, to: route.via },
				{ from: route.via, to: route.destination }
			]
		: [{ from: route.origin, to: route.destination }];
}

const detour = (leg: Leg, p: LatLon) =>
	distanceKm(leg.from, p) + distanceKm(p, leg.to) - distanceKm(leg.from, leg.to);

/** The trail of the last PROGRESS_WINDOW_MS, oldest first, segments joined. */
function recent(a: TrackedAircraft): TrailPoint[] {
	const points = a.trail.flat();
	const last = points.at(-1);
	if (!last) return [];
	return points.filter((p) => p.t >= last.t - PROGRESS_WINDOW_MS);
}

function progress(leg: Leg, points: TrailPoint[]): Progress | null {
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last || last.t - first.t < MIN_PROGRESS_WINDOW_MS) return null;
	let flown = 0;
	for (let i = 1; i < points.length; i++) flown += distanceKm(points[i - 1], points[i]);
	return {
		closer: distanceKm(first, leg.to) - distanceKm(last, leg.to),
		away: distanceKm(last, leg.from) - distanceKm(first, leg.from),
		flown,
		ms: last.t - first.t
	};
}

/** The route check for an aircraft; null without a position (nothing to check against). */
export function checkRoute(a: TrackedAircraft, route: DbRoute): RouteCheck | null {
	const p = a.position;
	if (!p) return null;
	// With a stop on the way: the leg it's nearer to.
	const leg = legs(route).reduce((best, l) => (detour(l, p) < detour(best, p) ? l : best));
	const directKm = distanceKm(leg.from, leg.to);
	const fromKm = distanceKm(leg.from, p);
	const toGoKm = distanceKm(p, leg.to);
	const detourKm = fromKm + toGoKm - directKm;
	const maxDetourKm = Math.max(MIN_DETOUR_KM, MAX_DETOUR * directKm);
	const moved = progress(leg, recent(a));
	const base = { leg, directKm, fromKm, toGoKm, detourKm, maxDetourKm, progress: moved };
	if (detourKm > maxDetourKm) return { verdict: 'off-route', ...base };
	if (!moved || moved.flown < MIN_FLOWN_KM) return { verdict: 'unknown', ...base };
	const enough = PROGRESS * moved.flown;
	if (moved.closer < -enough && moved.away < -enough) return { verdict: 'backwards', ...base };
	if (moved.closer > enough || moved.away > enough) return { verdict: 'fits', ...base };
	return { verdict: 'unknown', ...base };
}

export const misfit = (c: RouteCheck | null) =>
	c?.verdict === 'off-route' || c?.verdict === 'backwards';

export interface Judged {
	check: RouteCheck | null;
	/** Show the route? No once it didn't fit. */
	shown: boolean;
}

/**
 * The route check with a memory: once a route didn't fit an aircraft, it stays dismissed
 * for that aircraft and callsign (the check that dismissed it is kept, for the tooltip).
 * Without that, a route could show and vanish again as the aircraft turns. One per tab;
 * it only grows by the routes dismissed, a few per hour.
 */
export class RouteJudge {
	#dismissed = new Map<string, RouteCheck>();

	judge(a: TrackedAircraft, route: DbRoute): Judged {
		const check = checkRoute(a, route);
		const key = `${a.icao} ${route.callsign} ${route.origin.icao} ${route.destination.icao}`;
		const dismissed = this.#dismissed.get(key);
		if (dismissed) return { check: dismissed, shown: false };
		if (check && misfit(check)) {
			this.#dismissed.set(key, check);
			return { check, shown: false };
		}
		return { check, shown: true };
	}
}
