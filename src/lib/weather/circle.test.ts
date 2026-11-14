import { describe, expect, test } from 'bun:test';
import { MIN_ARC, TurnTracker, fitCircle, windFromTurn, type GroundPoint } from './circle';
import { toVector, type Vector } from './wind';

/** 40 kt from the west: the air moves east. */
const WIND = toVector(40, 90);

/**
 * An aircraft at `tas` kt turning from `from` to `to` (degrees of heading) at `rate` °/s,
 * 2 messages a second, its ground vector rounded to whole knots east and north like
 * ADS-B's. Straight flight for `straight` seconds before and after.
 */
function flight(
	opts: {
		tas?: number | ((s: number) => number);
		from?: number;
		to?: number;
		rate?: number;
		straight?: number;
		altitude?: (s: number) => number;
	} = {}
): GroundPoint[] {
	const { tas = 250, from = 0, to = 180, rate = 1.5, straight = 30 } = opts;
	const speed = typeof tas === 'number' ? () => tas : tas;
	const altitude = opts.altitude ?? (() => 8000);
	const turnS = Math.abs(to - from) / rate;
	const total = straight * 2 + turnS;
	const out: GroundPoint[] = [];
	for (let s = 0; s <= total; s += 0.5) {
		const into = Math.min(Math.max(s - straight, 0), turnS);
		const heading = from + Math.sign(to - from) * rate * into;
		const air = toVector(speed(s), heading);
		out.push({
			t: s * 1000,
			vector: {
				north: Math.round(air.north + WIND.north),
				east: Math.round(air.east + WIND.east)
			},
			altitude: altitude(s)
		});
	}
	return out;
}

const kt = (v: Vector, w: Vector) => Math.hypot(v.north - w.north, v.east - w.east);

describe('fitting a circle', () => {
	test('exact points: centre and radius', () => {
		const pts = [0, 40, 80, 120].map((d) => {
			const v = toVector(250, d);
			return { north: v.north + 10, east: v.east - 20 };
		});
		const c = fitCircle(pts)!;
		expect(c.centre.north).toBeCloseTo(10, 6);
		expect(c.centre.east).toBeCloseTo(-20, 6);
		expect(c.radius).toBeCloseTo(250, 6);
		expect(c.residual).toBeCloseTo(0, 6);
	});

	test('points on a line: no circle', () => {
		const line = [0, 1, 2, 3].map((i) => ({ north: i, east: i }));
		expect(fitCircle(line)).toBeNull();
	});
});

describe('the wind from a turn', () => {
	test('a half turn at 250 kt, ADS-B rounding included: the wind within a knot', () => {
		const tracker = new TurnTracker();
		const winds = flight().flatMap((p) => tracker.add('A', p) ?? []);
		expect(winds).toHaveLength(1);
		const [w] = winds;
		expect(kt(w.wind.vector, WIND)).toBeLessThan(1);
		expect(w.wind.direction).toBeCloseTo(270, 0);
		expect(w.tas).toBeCloseTo(250, 0);
		// The heading turned 180°; the ground track only 162° (9° → 171°: 40 kt across).
		expect(w.arc).toBeCloseTo(180, -1);
		expect(w.altitude).toBe(8000);
		expect(w.residual).toBeLessThan(1); // the 1 kt rounding: about 0.4 kt rms
	});

	test('a full holding lap, turning left', () => {
		const tracker = new TurnTracker();
		const winds = flight({ from: 360, to: 0, rate: 3 }).flatMap((p) => tracker.add('A', p) ?? []);
		expect(winds).toHaveLength(1);
		expect(kt(winds[0].wind.vector, WIND)).toBeLessThan(1);
		expect(winds[0].arc).toBeLessThan(-350);
	});

	test(`a quarter turn (${MIN_ARC}°) is enough; 60° is not`, () => {
		const quarter = new TurnTracker();
		const w = flight({ to: 95 }).flatMap((p) => quarter.add('A', p) ?? []);
		expect(w).toHaveLength(1);
		expect(kt(w[0].wind.vector, WIND)).toBeLessThan(2);
		const short = new TurnTracker();
		expect(flight({ to: 60 }).flatMap((p) => short.add('A', p) ?? [])).toEqual([]);
	});

	test('straight flight is never a turn', () => {
		const tracker = new TurnTracker();
		expect(flight({ to: 0, straight: 120 }).flatMap((p) => tracker.add('A', p) ?? [])).toEqual([]);
	});

	test('slowing from 250 to 200 kt in the turn: a spiral, and still the right wind', () => {
		const tracker = new TurnTracker();
		const slowing = flight({ tas: (s) => 250 - Math.max(0, Math.min(50, (s - 30) / 2.4)) });
		const winds = slowing.flatMap((p) => tracker.add('A', p) ?? []);
		expect(winds).toHaveLength(1);
		expect(kt(winds[0].wind.vector, WIND)).toBeLessThan(1.5);
		expect(winds[0].tasChange).toBeCloseTo(-50, -1);
		// A plain circle through the same points puts the wind 10 kt or more off.
		const plain = fitCircle(winds[0].points)!;
		expect(kt(plain.centre, WIND)).toBeGreaterThan(10);
	});

	test('a speed that goes up and down in the turn: not a curve at all, left out', () => {
		const tracker = new TurnTracker();
		const wobbly = flight({ tas: (s) => 250 + 15 * Math.sin(s / 10) });
		expect(wobbly.flatMap((p) => tracker.add('A', p) ?? [])).toEqual([]);
	});

	test('climbing 2,000 ft in the turn: left out', () => {
		const tracker = new TurnTracker();
		const climbing = flight({ altitude: (s) => 8000 + s * 10 });
		expect(climbing.flatMap((p) => tracker.add('A', p) ?? [])).toEqual([]);
	});

	test('an aircraft that goes quiet mid-turn: what it flew is fitted when pruned', () => {
		const tracker = new TurnTracker();
		const pts = flight().slice(0, 300); // 150 s: 30 straight, 120 turning (180°)
		for (const p of pts) expect(tracker.add('A', p)).toBeNull();
		const winds = tracker.prune(pts.at(-1)!.t + 60_000);
		expect(winds).toHaveLength(1);
		expect(kt(winds[0].wind.vector, WIND)).toBeLessThan(1);
	});

	test('two aircraft at once are kept apart', () => {
		const tracker = new TurnTracker();
		const a = flight();
		const b = flight({ from: 90, to: 270 });
		const winds = a.flatMap((p, i) =>
			[tracker.add('A', p), tracker.add('B', b[i])].flatMap((w) => w ?? [])
		);
		expect(winds.map((w) => w.icao).sort()).toEqual(['A', 'B']);
	});

	test('windFromTurn needs an altitude', () => {
		expect(
			windFromTurn(
				'A',
				flight().map((p) => ({ ...p, altitude: null }))
			)
		).toBeNull();
	});
});
