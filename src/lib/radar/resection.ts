/**
 * Where a rotating radar stands, from when its beam swept past aircraft whose positions we
 * know: a resection. Surveyors locate themselves by sighting known points; here the known
 * points are the aircraft (their ADS-B positions) and the sightings are the radar's own,
 * timed by the bursts of replies it got from them (bursts.ts).
 *
 * The model: the beam turns at a constant rate, so it points at
 *
 *     β(t) = s · 360° · (t − t₀) / P          s = +1 clockwise, −1 anticlockwise
 *
 * (t₀: a moment it pointed north; P: the period). A burst from an aircraft at time t says
 * β(t) was the aircraft's bearing seen from the radar, az(R, aircraft). For a candidate
 * radar position R, the bursts then give a straight line: t = t₀ + P · (n + s · az / 360°),
 * n counting the turns. Fit t₀ and P to it (least squares), and how far each burst is off
 * the line, as an angle of the beam, says how well R explains them all. The position is
 * where that's smallest: searched on a grid around the aircraft, then refined.
 *
 * Robust, with two scores. `cost`: the mean squared miss, but a burst more than OUTLIER°
 * off costs as much as one at OUTLIER°, so a few stray bursts (a side lobe, a garbled
 * reply) can't pull: broad, it guides the search from far away. `sharp`: the mean of
 * 1 − e^(−r²/2σ²), σ = SHARP_SIGMA°: near 0 for a burst on the line, 1 for one more than
 * ~3σ off, whatever how far. It places the radar at the end. With two radars on one code
 * it matters: half the bursts are the other one's, and under the broad score a position a
 * few km off wins by bringing more of those under the cap. Bursts within INLIER° count as
 * explained.
 *
 * What it can't see: the distance along the line from the aircraft to a far-away radar is
 * pinned down only by how the bearings spread, which is little when all the aircraft sit
 * in a small patch of the radar's sky. How far the position moves when each aircraft is
 * left out (jackknife) measures that: radars 400 km away move by 10–20 km, against 1–2 km
 * for one at 200 km (capture).
 */
import { bearing, destination, distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** A burst with the aircraft's position at its time. */
export interface Sighting {
	icao: string;
	/** Receiver clock (Beast timestamp), ms. */
	t: number;
	lat: number;
	lon: number;
}

/** Bursts further off than this (beam degrees) count as this far: outliers can't pull. */
export const OUTLIER = 10;
/** Bursts within this many degrees are explained by the fit. */
export const INLIER = 5;
/** The sharp score's width, beam degrees: the capture's radars miss by a median 0.4–1°. */
const SHARP_SIGMA = 1.5;
/** The phase histogram that finds t₀: 5° bins. */
const PHASE_BINS = 72;

/**
 * Grid search: this far around the aircraft, in steps of this, km. A radar further away
 * can't reach them: the radio horizon, d ≈ 4.12 (√h_radar + √h_aircraft) km with heights
 * in metres (4/3-Earth refraction), is ~450 km for an aircraft at FL350 and a radar on a
 * 100 m mast.
 */
const SEARCH_KM = 600;
const GRID_KM = 25;
/** The grid scores at most this many bursts (spread over aircraft and time): enough, and fast. */
const GRID_SAMPLE = 80;
/** The best few grid cells (this far apart) are refined, in case the best isn't the true one. */
const CANDIDATES = 3;
const CANDIDATE_APART_KM = 100;

export interface Fit {
	position: LatLon;
	/** +1 clockwise (seen from above), −1 anticlockwise. */
	direction: 1 | -1;
	/** Period, ms. */
	period: number;
	/** A moment the beam pointed north, receiver clock, ms. */
	t0: number;
	/** Each sighting's miss, beam degrees (−180…180), in the order given. */
	residuals: number[];
	/** Mean of the squared misses, capped at OUTLIER²: lower is better. */
	cost: number;
	/** Mean of 1 − e^(−r²/2σ²): 0 if every burst is on the line, 1 if none is. */
	sharp: number;
}

const wrap = (turns: number) => turns - Math.round(turns);

/**
 * The best t₀ and P for radar position R and direction s, and the misses. `period`: a
 * first guess, ms (period.ts), good to ~1 ms: the turn counts n are rounded from it.
 */
export function fitAt(
	sightings: Sighting[],
	position: LatLon,
	direction: 1 | -1,
	period: number,
	rounds = 4
): Fit {
	const n = sightings.length;
	const t0ref = sightings[0].t;
	const t = sightings.map((s) => s.t - t0ref);
	// The aircraft's bearing from R, in turns, signed by the direction.
	const u = bearingsFrom(position, sightings).map((b) => (direction * b) / 360);
	// t₀ first, from the phases (t/P − u, in turns), which needs no turn counts: where most
	// of them are. Not their mean: with two radars on one code there are two clusters of
	// phases, and the mean would land between them.
	const phase = t.map((ti, i) => ti / period - u[i]);
	const bins = new Array<number>(PHASE_BINS).fill(0);
	for (const ph of phase) bins[Math.floor((ph - Math.floor(ph)) * PHASE_BINS) % PHASE_BINS]++;
	const reach = Math.round((OUTLIER / 360) * PHASE_BINS);
	let densest = 0;
	let most = -1;
	for (let b = 0; b < PHASE_BINS; b++) {
		let count = 0;
		for (let k = -reach; k <= reach; k++) count += bins[(b + k + PHASE_BINS) % PHASE_BINS];
		if (count > most) [densest, most] = [b, count];
	}
	// The circular mean of the phases in that window (all of it: the peak can be anywhere in
	// it, so ±OUTLIER° around the window's middle could miss it).
	const middle = (densest + 0.5) / PHASE_BINS;
	const half = (reach + 0.5) / PHASE_BINS;
	let cx = 0;
	let cy = 0;
	for (const ph of phase) {
		if (Math.abs(wrap(ph - middle)) > half) continue;
		cx += Math.cos(2 * Math.PI * ph);
		cy += Math.sin(2 * Math.PI * ph);
	}
	let t0 = (Math.atan2(cy, cx) / (2 * Math.PI)) * period;
	let p = period;
	// Then count the turns and fit the line, a few times: each fit counts better. Only the
	// bursts within OUTLIER° of the line so far take part, from the third round within
	// INLIER°: with two radars on a code, some of the other's bursts come close by chance,
	// and would pull.
	for (let round = 0; round < rounds; round++) {
		const within = round < 2 ? OUTLIER : INLIER;
		let sx = 0;
		let sy = 0;
		let sxx = 0;
		let sxy = 0;
		let m = 0;
		for (let i = 0; i < n; i++) {
			const turns = (t[i] - t0) / p - u[i];
			if (Math.abs(wrap(turns) * 360) > within) continue;
			const x = Math.round(turns) + u[i];
			sx += x;
			sy += t[i];
			sxx += x * x;
			sxy += x * t[i];
			m++;
		}
		const denominator = m * sxx - sx * sx;
		// Too few, or all in the same turn: keep what we have.
		if (m < 3 || Math.abs(denominator) < 1e-9) break;
		p = (m * sxy - sx * sy) / denominator;
		t0 = (sy - p * sx) / m;
	}
	const residuals = t.map((ti, i) => wrap((ti - t0) / p - u[i]) * 360);
	let cost = 0;
	let sharp = 0;
	for (const r of residuals) {
		cost += Math.min(r * r, OUTLIER * OUTLIER);
		sharp += 1 - Math.exp((-r * r) / (2 * SHARP_SIGMA * SHARP_SIGMA));
	}
	return {
		position,
		direction,
		period: p,
		t0: t0ref + t0,
		residuals,
		cost: cost / n,
		sharp: sharp / n
	};
}

/** Each sighting's sine and cosine of latitude, and longitude in radians: computed once. */
const trig = new WeakMap<Sighting[], Float64Array>();

/**
 * The bearing from `from` to each sighting, degrees (geo.ts bearing, with the sightings'
 * trigonometry reused: the search asks for thousands of candidate positions).
 */
function bearingsFrom(from: LatLon, sightings: Sighting[]): number[] {
	let t = trig.get(sightings);
	if (!t) {
		t = new Float64Array(sightings.length * 3);
		sightings.forEach((s, i) => {
			const lat = (s.lat * Math.PI) / 180;
			t![3 * i] = Math.sin(lat);
			t![3 * i + 1] = Math.cos(lat);
			t![3 * i + 2] = (s.lon * Math.PI) / 180;
		});
		trig.set(sightings, t);
	}
	const lat = (from.lat * Math.PI) / 180;
	const lon = (from.lon * Math.PI) / 180;
	const sinA = Math.sin(lat);
	const cosA = Math.cos(lat);
	const out = new Array<number>(sightings.length);
	for (let i = 0; i < sightings.length; i++) {
		const dLon = t[3 * i + 2] - lon;
		const y = Math.sin(dLon) * t[3 * i + 1];
		const x = cosA * t[3 * i] - sinA * t[3 * i + 1] * Math.cos(dLon);
		out[i] = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
	}
	return out;
}

/**
 * At most `max` sightings, spread evenly over the list (which is in aircraft and time
 * order): the grid search needs a fair sample, not all of them.
 */
function sample(sightings: Sighting[], max: number): Sighting[] {
	if (sightings.length <= max) return sightings;
	const step = sightings.length / max;
	return Array.from({ length: max }, (_, i) => sightings[Math.floor(i * step)]);
}

/**
 * Move the position in shrinking steps while that lowers the score: the broad one from
 * `fromKm` down to 250 m, then the sharp one from 2 km down to 50 m.
 */
export function refine(sightings: Sighting[], start: Fit, fromKm = 16): Fit {
	let best = fitAt(sightings, start.position, start.direction, start.period);
	for (const [score, from, to] of [
		['cost', fromKm, 0.25],
		['sharp', 2, 0.05]
	] as const)
		for (let step = from; step >= to; step /= 2) {
			let improved = true;
			while (improved) {
				improved = false;
				for (const towards of [0, 90, 180, 270]) {
					const f = fitAt(
						sightings,
						destination(best.position, towards, step),
						best.direction,
						best.period
					);
					if (f[score] < best[score]) {
						best = f;
						improved = true;
					}
				}
			}
		}
	return best;
}

/** The middle of the aircraft's positions: the grid's centre. */
function centre(sightings: Sighting[]): LatLon {
	let lat = 0;
	let lon = 0;
	for (const s of sightings) {
		lat += s.lat;
		lon += s.lon;
	}
	return { lat: lat / sightings.length, lon: lon / sightings.length };
}

/**
 * Search the radar's position and direction from scratch: a grid of GRID_KM within
 * SEARCH_KM of the aircraft's middle, both directions, on a sample of the bursts; then the
 * best few cells refined with all of them. `period`: from period.ts, ms.
 */
export function search(sightings: Sighting[], period: number): Fit {
	const few = sample(sightings, GRID_SAMPLE);
	const middle = centre(sightings);
	const cells: { cost: number; position: LatLon; direction: 1 | -1 }[] = [];
	const steps = Math.round(SEARCH_KM / GRID_KM);
	for (let north = -steps; north <= steps; north++) {
		const row = destination(middle, 0, north * GRID_KM);
		for (let east = -steps; east <= steps; east++) {
			if (Math.hypot(north, east) > steps) continue; // a disc, not a square
			const position = destination(row, 90, east * GRID_KM);
			for (const direction of [1, -1] as const)
				cells.push({ cost: fitAt(few, position, direction, period, 2).cost, position, direction });
		}
	}
	cells.sort((a, b) => a.cost - b.cost);
	const starts: typeof cells = [];
	for (const c of cells) {
		if (starts.length === CANDIDATES) break;
		if (starts.every((s) => distanceKm(s.position, c.position) > CANDIDATE_APART_KM))
			starts.push(c);
	}
	return starts
		.map((s) => refine(sightings, fitAt(sightings, s.position, s.direction, period), GRID_KM / 2))
		.reduce((a, b) => (b.sharp < a.sharp ? b : a));
}

/** The sightings a fit explains (within INLIER°). */
export function inliers(sightings: Sighting[], fit: Fit): Sighting[] {
	return sightings.filter((_, i) => Math.abs(fit.residuals[i]) <= INLIER);
}

export interface Spread {
	/** Where the fit lands without each aircraft in turn. */
	without: { icao: string; position: LatLon }[];
	/**
	 * The jackknife's uncertainty ellipse, 2 standard errors (km): semi-axes and the major
	 * axis's bearing (degrees from north, 0–180).
	 */
	major: number;
	minor: number;
	bearing: number;
}

/**
 * Leave each aircraft out in turn and fit again (from the full fit, which is close): how
 * much the position depends on any one of them. The jackknife (Quenouille 1949, Tukey
 * 1958): with n such fits θᵢ, the variance of the estimate is (n − 1)/n · Σ (θᵢ − θ̄)².
 * Needs 3 aircraft; null with fewer.
 */
export function spread(sightings: Sighting[], fit: Fit): Spread | null {
	const aircraft = [...new Set(sightings.map((s) => s.icao))];
	if (aircraft.length < 3) return null;
	const without = aircraft.map((icao) => {
		const rest = sightings.filter((s) => s.icao !== icao);
		return {
			icao,
			position: refine(rest, fitAt(rest, fit.position, fit.direction, fit.period), 8).position
		};
	});
	// Local flat coordinates around the fit, km: east x, north y.
	const xy = without.map(({ position }) => {
		const d = distanceKm(fit.position, position);
		const b = (bearing(fit.position, position) * Math.PI) / 180;
		return [d * Math.sin(b), d * Math.cos(b)];
	});
	const n = xy.length;
	const mx = xy.reduce((s, [x]) => s + x, 0) / n;
	const my = xy.reduce((s, [, y]) => s + y, 0) / n;
	let sxx = 0;
	let syy = 0;
	let sxy = 0;
	for (const [x, y] of xy) {
		sxx += (x - mx) ** 2;
		syy += (y - my) ** 2;
		sxy += (x - mx) * (y - my);
	}
	const k = (n - 1) / n;
	[sxx, syy, sxy] = [sxx * k, syy * k, sxy * k];
	// Eigenvalues of the 2×2 covariance: the ellipse's axes.
	const mean = (sxx + syy) / 2;
	const root = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
	const angle = (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI); // from east, anticlockwise
	return {
		without,
		major: 2 * Math.sqrt(mean + root),
		minor: 2 * Math.sqrt(Math.max(mean - root, 0)),
		bearing: (((90 - angle) % 180) + 180) % 180
	};
}
