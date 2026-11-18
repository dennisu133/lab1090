/**
 * Wind from a turn, with ADS-B alone: no heading, no airspeed, no radar questions.
 *
 * An aircraft turning at a steady true airspeed sweeps its air vector (TAS along the
 * heading) around a circle of radius TAS. Its ground vector is that plus the wind:
 *
 *   ground = air + wind
 *
 * so the ground vectors, which ADS-B broadcasts twice a second (TC 19, from GNSS, in
 * 1 kt steps east and north), lie on the same circle shifted by the wind. Fit a circle
 * through them: the centre is the wind, the radius the TAS. Draw the ground vectors from
 * one point (a hodograph) and you can see it.
 *
 * In straight flight all ground vectors are the same point and say nothing about the
 * wind: a turn is needed, the more of it the better. A quarter turn (MIN_ARC) pins the
 * centre to about a knot. Holding patterns (two half turns a lap) and approach turns are
 * where to find them.
 *
 * Unlike the wind triangle (observation.ts), it doesn't depend on the heading, so an
 * aircraft whose compass is a few degrees off gets it right (headings.ts can't check an
 * error everyone shares; this can). It does need a steady TAS and a steady wind for the
 * length of the turn. An aircraft slowing down steadily spirals inwards: the fit allows
 * for that (the radius may change linearly with time). Anything less steady doesn't fit
 * (MAX_RESIDUAL_KT), and a climb changes both (MAX_CLIMB_FT).
 *
 * Gliders and drones use the same trick to find the wind without an airspeed sensor.
 *
 * Runs in the browser; state is the turns in progress.
 */
import { speedOf, type Vector, type Wind, windOf } from './wind';

/** Degrees of turn (of heading: around the circle) the fit needs. */
export const MIN_ARC = 90;
/** A track changing faster than this, °/s, is a turn (an airliner banked 25° at 450 kt: 1.2). */
export const TURN_RATE = 0.5;
/** The rate is measured over this long, ms: two messages 0.5 s apart are too noisy. */
const RATE_BASELINE_MS = 4000;
/** This long without turning, ms, and the turn is over. */
const STRAIGHT_MS = 20_000;
/** Longer than this, ms, and the wind or the TAS may have changed: the turn is cut. */
export const MAX_TURN_MS = 5 * 60_000;
/** More climb or descent than this during the turn, ft, and it doesn't count. */
export const MAX_CLIMB_FT = 1000;
/** Points further off the circle than this, kt rms, and it wasn't a steady turn. */
export const MAX_RESIDUAL_KT = 4;
/** Messages further apart than this, ms, break the turn (the aircraft went out of range). */
const MAX_GAP_MS = 10_000;

export interface GroundPoint {
	/** ms */
	t: number;
	/** Ground velocity, kt. */
	vector: Vector;
	/** Pressure altitude, ft, if known. */
	altitude: number | null;
}

export interface Circle {
	centre: Vector;
	/** At the middle of the turn, kt. */
	radius: number;
	/** How fast the radius changes, kt per second: the TAS speeding up (+) or slowing. */
	growth: number;
	/** How far the points are off the curve, kt rms. */
	residual: number;
}

export interface TurnWind {
	icao: string;
	/** When the turn started and ended, ms. */
	start: number;
	end: number;
	wind: Wind;
	/** The circle's radius: the TAS, kt, in the middle of the turn. */
	tas: number;
	/** How much the TAS changed from start to end of the turn, kt. */
	tasChange: number;
	/** Degrees the heading turned (around the circle), signed: positive to the right. */
	arc: number;
	/** Mean pressure altitude, ft. */
	altitude: number;
	/** How far the ground vectors are off the fitted curve, kt rms. */
	residual: number;
	/** The ground vectors that went in, for the hodograph. */
	points: Vector[];
}

/**
 * Least-squares circle through ground vectors: first algebraically (Kåsa: x² + y² + Dx +
 * Ey + F = 0 is linear in D, E, F), then Gauss–Newton on the real distances, which the
 * algebraic fit gets slightly wrong on short arcs. With times, the radius may change
 * steadily with time (a spiral): an aircraft slowing down in the turn shrinks its circle,
 * and a plain circle would put the centre, the wind, off to one side.
 */
export function fitCircle(points: Vector[], times?: number[]): Circle | null {
	if (points.length < 4) return null;
	// Kåsa. Columns: x, y, 1; target −(x² + y²).
	const abc = leastSquares(
		points.map((p) => [p.east, p.north, 1]),
		points.map((p) => -(p.east ** 2 + p.north ** 2))
	);
	if (!abc) return null;
	let cx = -abc[0] / 2;
	let cy = -abc[1] / 2;
	let r = Math.sqrt(Math.max(0, cx * cx + cy * cy - abc[2]));
	let g = 0;

	// Seconds from the middle, so the radius is the one at the middle of the turn.
	const mid = times ? (times[0] + times.at(-1)!) / 2 : 0;
	const ts = points.map((_, i) => (times ? (times[i] - mid) / 1000 : 0));
	const model = (i: number) => r + g * ts[i];
	for (let step = 0; step < 20; step++) {
		// Residual dᵢ − r(tᵢ), dᵢ the distance to the centre; Jacobian by cx, cy, r (and g).
		const jacobian: number[][] = [];
		const residual: number[] = [];
		points.forEach((p, i) => {
			const dx = p.east - cx;
			const dy = p.north - cy;
			const d = Math.hypot(dx, dy) || 1e-9;
			jacobian.push(times ? [-dx / d, -dy / d, -1, -ts[i]] : [-dx / d, -dy / d, -1]);
			residual.push(-(d - model(i)));
		});
		const delta = leastSquares(jacobian, residual);
		if (!delta) break;
		cx += delta[0];
		cy += delta[1];
		r += delta[2];
		if (times) g += delta[3];
		if (delta.reduce((s, x) => s + Math.abs(x), 0) < 1e-9) break;
	}
	const residual = Math.sqrt(
		points.reduce((s, p, i) => s + (Math.hypot(p.east - cx, p.north - cy) - model(i)) ** 2, 0) /
			points.length
	);
	return { centre: { north: cy, east: cx }, radius: r, growth: g, residual };
}

/** Least squares: solves (XᵀX) β = Xᵀy by elimination with pivoting; null if singular. */
function leastSquares(x: number[][], y: number[]): number[] | null {
	const n = x[0].length;
	const m = Array.from({ length: n }, (_, i) => [
		...Array.from({ length: n }, (_, j) => x.reduce((s, row) => s + row[i] * row[j], 0)),
		x.reduce((s, row, k) => s + row[i] * y[k], 0)
	]);
	const scale = Math.max(...m.map((row, i) => Math.abs(row[i])));
	for (let i = 0; i < n; i++) {
		let pivot = i;
		for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
		[m[i], m[pivot]] = [m[pivot], m[i]];
		if (Math.abs(m[i][i]) <= scale * 1e-12) return null;
		for (let r = i + 1; r < n; r++) {
			const f = m[r][i] / m[i][i];
			for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c];
		}
	}
	const beta = Array<number>(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		let s = m[i][n];
		for (let c = i + 1; c < n; c++) s -= m[i][c] * beta[c];
		beta[i] = s / m[i][i];
	}
	return beta;
}

/** Track change from a to b, −180 to +180°. */
const trackChange = (a: Vector, b: Vector) => {
	const d = (Math.atan2(b.east, b.north) - Math.atan2(a.east, a.north)) * (180 / Math.PI);
	return ((d + 540) % 360) - 180;
};

/** A finished turn: the wind if it was long, level and steady enough, else null. */
export function windFromTurn(icao: string, turn: GroundPoint[]): TurnWind | null {
	if (turn.length < 4) return null;
	const altitudes = turn.flatMap((p) => (p.altitude === null ? [] : [p.altitude]));
	if (altitudes.length === 0) return null;
	if (Math.max(...altitudes) - Math.min(...altitudes) > MAX_CLIMB_FT) return null;
	const points = turn.map((p) => p.vector);
	const circle = fitCircle(
		points,
		turn.map((p) => p.t)
	);
	if (!circle || circle.residual > MAX_RESIDUAL_KT) return null;
	// A circle smaller than the wind would mean flying backwards: something else went on.
	if (circle.radius < speedOf(circle.centre)) return null;
	// How far the air vector turned: the angle swept around the centre, which is the
	// heading change. (The ground track turns less with the wind across, more against it.)
	let arc = 0;
	const around = points.map((p) => ({
		north: p.north - circle.centre.north,
		east: p.east - circle.centre.east
	}));
	for (let i = 1; i < around.length; i++) arc += trackChange(around[i - 1], around[i]);
	if (Math.abs(arc) < MIN_ARC) return null;
	return {
		icao,
		start: turn[0].t,
		end: turn.at(-1)!.t,
		wind: windOf(circle.centre),
		tas: circle.radius,
		tasChange: circle.growth * ((turn.at(-1)!.t - turn[0].t) / 1000),
		arc,
		altitude: altitudes.reduce((s, a) => s + a, 0) / altitudes.length,
		residual: circle.residual,
		points
	};
}

interface State {
	/** The last RATE_BASELINE_MS and more of points, for the turn rate. */
	recent: GroundPoint[];
	/** The turn in progress. */
	turn: GroundPoint[];
	lastTurning: number;
}

/** Follows each aircraft's ground vector and hands back the wind when a turn ends. */
export class TurnTracker {
	#byIcao = new Map<string, State>();

	add(icao: string, point: GroundPoint): TurnWind | null {
		let s = this.#byIcao.get(icao);
		if (!s) this.#byIcao.set(icao, (s = { recent: [], turn: [], lastTurning: 0 }));
		const last = s.recent.at(-1);
		let done: TurnWind | null = null;
		if (last && point.t - last.t > MAX_GAP_MS) {
			done = this.#finish(icao, s);
			s.recent = [];
		}
		s.recent.push(point);
		while (s.recent.length > 2 && point.t - s.recent[1].t >= RATE_BASELINE_MS) s.recent.shift();

		const from = s.recent[0];
		const span = (point.t - from.t) / 1000;
		const turning =
			span >= RATE_BASELINE_MS / 2000 &&
			Math.abs(trackChange(from.vector, point.vector)) / span >= TURN_RATE;

		if (turning) {
			// The turn started where the rate was first measured from.
			if (s.turn.length === 0) s.turn.push(...s.recent.slice(0, -1));
			s.turn.push(point);
			s.lastTurning = point.t;
			if (point.t - s.turn[0].t >= MAX_TURN_MS) done ??= this.#finish(icao, s);
		} else if (s.turn.length) {
			if (point.t - s.lastTurning >= STRAIGHT_MS) done ??= this.#finish(icao, s);
		}
		return done;
	}

	/** Forget aircraft not heard from; finish their turns. */
	prune(now: number): TurnWind[] {
		const out: TurnWind[] = [];
		for (const [icao, s] of this.#byIcao) {
			const last = s.recent.at(-1);
			if (last && now - last.t > MAX_GAP_MS) {
				const w = this.#finish(icao, s);
				if (w) out.push(w);
				this.#byIcao.delete(icao);
			}
		}
		return out;
	}

	#finish(icao: string, s: State): TurnWind | null {
		const turn = s.turn;
		s.turn = [];
		return windFromTurn(icao, turn);
	}
}
