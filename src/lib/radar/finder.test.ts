import { describe, expect, test } from 'bun:test';
import { bearing, destination, distanceKm } from '#lib/geo.ts';
import { beamAt, codeName, CONFIRM_MS, MAX_ELLIPSE_KM, MIN_AIRCRAFT, type Radar } from './finder';
import { KNOWN_SITES, runCapture, simulate, type SyntheticAircraft } from './testing';

/** Where the true site lies in the radar's uncertainty ellipse: < 1 inside. */
function inEllipse(radar: Radar, site: { lat: number; lon: number }): number {
	const d = distanceKm(radar.position, site);
	const a = ((bearing(radar.position, site) - radar.spread.bearing) * Math.PI) / 180;
	return Math.hypot((d * Math.cos(a)) / radar.spread.major, (d * Math.sin(a)) / radar.spread.minor);
}

describe('the capture', () => {
	const { finder, found, confirmed } = runCapture();
	const radars = new Map([...finder.radars, ...finder.candidates].map((r) => [r.id, r]));

	test('confirms two radars, two more are candidates, each near a radar site others have mapped', () => {
		expect(finder.radars.map((r) => r.id)).toEqual(['SI 17', 'SI 44']);
		// Found too late in the 10 minutes to have held for CONFIRM_MS.
		expect(finder.candidates.map((r) => r.id)).toEqual(['SI 28', 'SI 33']);
		// km from the mapped site; the radars are 180–470 km from the receiver.
		const off = Object.fromEntries(
			[...radars].map(([id, r]) => [
				id,
				Math.round(distanceKm(r.position, KNOWN_SITES[id].position))
			])
		);
		expect(off).toEqual({ 'SI 17': 8, 'SI 28': 11, 'SI 33': 2, 'SI 44': 0 });
	});

	test('SI 35 is never placed: its ellipse is a line, hundreds of km long', () => {
		// Before the ellipse gate it landed 4–44 km from the Wronowice site, with ellipses
		// 130–306 km long: right only because the site lies on that line.
		const si35 = finder.codes.find((c) => c.code === 'SI 35')!;
		expect(si35.radars).toEqual([]);
		expect(si35.candidates).toEqual([]);
	});

	test('the uncertainty ellipses hold the sites, but SI 17 is outside', () => {
		const where = Object.fromEntries(
			[...radars].map(([id, r]) => [id, +inEllipse(r, KNOWN_SITES[id].position).toFixed(1)])
		);
		// SI 17: 8 km off across its ellipse's narrow axis. Either six aircraft make the
		// jackknife too sure across the line of sight, or SI 17 is the older radar at Katowice
		// airport (also ~6 km away, the same way).
		expect(where).toEqual({ 'SI 17': 1.4, 'SI 28': 0.2, 'SI 33': 0.2, 'SI 44': 0.1 });
		for (const r of radars.values()) expect(r.spread.major).toBeLessThanOrEqual(MAX_ELLIPSE_KM);
		// Small for the nearest, longer for the far ones (along the line of sight).
		expect(radars.get('SI 44')!.spread.major).toBeLessThan(5);
		expect(radars.get('SI 28')!.spread.major).toBeGreaterThan(30);
	});

	test('all turn clockwise, and the other direction explains far fewer bursts', () => {
		for (const r of radars.values()) {
			expect(r.clockwise).toBe(true);
			expect(r.otherCost).toBeGreaterThan(5 * r.cost);
			expect(r.otherExplained).toBeLessThan(0.7 * r.explained);
		}
	});

	test('rotation periods', () => {
		const periods = Object.fromEntries(
			[...radars].map(([id, r]) => [id, +(r.period / 1000).toFixed(3)])
		);
		expect(periods).toEqual({ 'SI 17': 4.878, 'SI 28': 3.957, 'SI 33': 3.998, 'SI 44': 5 });
	});

	test('nearly every burst explained, to within a degree', () => {
		for (const r of radars.values()) {
			expect(r.explained / r.considered).toBeGreaterThan(0.93);
			expect(r.median).toBeLessThan(1.1);
			expect(r.aircraft.filter((a) => a.explained >= 3).length).toBeGreaterThanOrEqual(
				MIN_AIRCRAFT
			);
		}
	});

	test('found after 4 to 10 minutes, shown 2 minutes later', () => {
		const minutes = (m: Map<string, number>) =>
			Object.fromEntries([...m].map(([id, ms]) => [id, +(ms / 60_000).toFixed(1)]));
		expect(minutes(found)).toEqual({ 'SI 44': 4.3, 'SI 17': 5.5, 'SI 28': 9.3, 'SI 33': 9.6 });
		expect(minutes(confirmed)).toEqual({ 'SI 44': 6.3, 'SI 17': 7.5 });
		for (const [id, ms] of confirmed)
			expect(ms - found.get(id)!).toBeGreaterThanOrEqual(CONFIRM_MS);
	});

	test('codes too thin to place stay unplaced', () => {
		const codes = new Map(finder.codes.map((c) => [c.code, c]));
		// SI 60: two radars in a cluster, but only two aircraft answer either often.
		for (const code of ['SI 20', 'SI 60', 'II 11', 'SI 52', 'SI 56', 'II 1', 'II 2']) {
			expect(codes.get(code)!.radars).toEqual([]);
			expect(codes.get(code)!.candidates).toEqual([]);
		}
		expect(codes.has('II 0')).toBe(false); // squitters
	});

	test('shuffled timing makes no radar, not even a candidate', () => {
		// The same replies and positions, each burst moved by up to 5 s.
		for (const seed of [1, 2]) {
			const { finder } = runCapture({ jitterMs: 5000, seed });
			expect([...finder.radars, ...finder.candidates]).toEqual([]);
		}
	}, 30_000);
});

describe('synthetic radars', () => {
	const centre = { lat: 52, lon: 14 };
	/** Aircraft criss-crossing 200 km around the centre at cruise speed. */
	const fleet: SyntheticAircraft[] = Array.from({ length: 8 }, (_, i) => ({
		icao: `AAA00${i}`,
		start: destination(centre, i * 45, 60 + 15 * i),
		track: (i * 97) % 360,
		speed: 230
	}));

	test('one radar: found where it is, its period and direction', () => {
		const position = destination(centre, 300, 180);
		const finder = simulate(
			[{ code: 'SI 9', position, period: 4800, clockwise: true, t0: 1234 }],
			fleet,
			8 * 60_000
		);
		const [r] = finder.radars;
		expect(distanceKm(r.position, position)).toBeLessThan(0.5);
		expect(r.period).toBeCloseTo(4800, 1);
		expect(r.clockwise).toBe(true);
	});

	test('an anticlockwise one is found turning that way', () => {
		const position = destination(centre, 120, 250);
		const finder = simulate(
			[{ code: 'II 3', position, period: 10_000, clockwise: false, t0: 0 }],
			fleet,
			10 * 60_000
		);
		const [r] = finder.radars;
		expect(r.clockwise).toBe(false);
		expect(distanceKm(r.position, position)).toBeLessThan(1);
	});

	test('two radars sharing a code (a cluster), same period: both found', () => {
		const a = destination(centre, 0, 150);
		const b = destination(centre, 200, 220);
		const finder = simulate(
			[
				{ code: 'SI 60', position: a, period: 5000, clockwise: true, t0: 0 },
				{ code: 'SI 60', position: b, period: 5000, clockwise: true, t0: 1700 }
			],
			fleet,
			10 * 60_000
		);
		const radars = finder.radars;
		expect(radars.map((r) => r.id)).toEqual(['SI 60', 'SI 60 b']);
		const near = (p: typeof a) => Math.min(...radars.map((r) => distanceKm(r.position, p)));
		expect(near(a)).toBeLessThan(1);
		expect(near(b)).toBeLessThan(1);
		for (const r of radars) expect(r.sharing).toHaveLength(1);
	});

	test('three aircraft are not enough', () => {
		const finder = simulate(
			[
				{
					code: 'SI 9',
					position: destination(centre, 45, 150),
					period: 5000,
					clockwise: true,
					t0: 0
				}
			],
			fleet.slice(0, 3),
			10 * 60_000
		);
		expect(finder.radars).toEqual([]);
	});

	test('the beam passes each aircraft when it replies', () => {
		const truth = {
			code: 'SI 9',
			position: destination(centre, 300, 180),
			period: 4800,
			clockwise: true,
			t0: 1234
		};
		const [r] = simulate([truth], fleet, 8 * 60_000).radars;
		// When the true beam points at each aircraft in turn 50: the fitted one points there too.
		for (const a of fleet) {
			let t = truth.t0 + 50 * truth.period;
			for (let i = 0; i < 2; i++) {
				const p = destination(a.start, a.track, (a.speed * t) / 1e6);
				t = truth.t0 + truth.period * (50 + bearing(truth.position, p) / 360);
			}
			const p = destination(a.start, a.track, (a.speed * t) / 1e6);
			const miss = ((beamAt(r, t) - bearing(r.position, p) + 540) % 360) - 180;
			expect(Math.abs(miss)).toBeLessThan(0.2);
		}
	});

	test('where the beam points, by the clock', () => {
		const position = destination(centre, 300, 180);
		const finder = simulate(
			[{ code: 'SI 9', position, period: 4800, clockwise: true, t0: 1234 }],
			fleet,
			8 * 60_000
		);
		const [r] = finder.radars;
		// At t0 + one turn and a quarter, a clockwise beam points east.
		expect(beamAt(r, r.offset + r.t0 + 1.25 * r.period)).toBeCloseTo(90, 0);
		// Synthetic: receiver and server clocks agree.
		expect(r.offset).toBeCloseTo(0, 0);
	});
});

describe("a radar's life", () => {
	const centre = { lat: 52, lon: 14 };
	const fleet: SyntheticAircraft[] = Array.from({ length: 8 }, (_, i) => ({
		icao: `BBB00${i}`,
		start: destination(centre, i * 45, 60 + 15 * i),
		track: (i * 97) % 360,
		speed: 230
	}));
	const here = destination(centre, 300, 180);
	const radar = { code: 'SI 9', position: here, period: 4800, clockwise: true, t0: 1234 };

	test('a candidate first, shown once every fit has found it for CONFIRM_MS', () => {
		const finder = simulate([radar], fleet, 90_000);
		expect(finder.radars).toEqual([]);
		const [candidate] = finder.candidates;
		expect(distanceKm(candidate.position, here)).toBeLessThan(1);
		simulate([radar], fleet, CONFIRM_MS, { finder, from: 90_000 });
		expect(finder.radars.map((r) => r.id)).toEqual(['SI 9']);
		expect(finder.candidates).toEqual([]);
	}, 30_000);

	test('stays while too few aircraft answer to fit it at all', () => {
		const finder = simulate([radar], fleet, 6 * 60_000);
		expect(finder.radars).toHaveLength(1);
		// Then only two aircraft for 15 minutes: plenty of bursts, but no fit passes.
		simulate([radar], fleet.slice(0, 2), 15 * 60_000, { finder, from: 6 * 60_000 });
		expect(finder.radars).toHaveLength(1);
		expect(finder.codes[0].bursts).toBeGreaterThan(100);
	}, 30_000);

	test('dropped when the bursts keep pointing somewhere else', () => {
		const finder = simulate([radar], fleet, 6 * 60_000);
		// The same code from 300 km further on (radars don't move: this stands for a fit
		// that was wrong). Once the window has moved on, the fits find only the new one.
		const there = destination(centre, 160, 200);
		simulate([{ ...radar, position: there }], fleet, 16 * 60_000, {
			finder,
			from: 6 * 60_000
		});
		const all = [...finder.radars, ...finder.candidates];
		expect(all).toHaveLength(1);
		expect(all[0].confirmed).toBe(true);
		expect(distanceKm(all[0].position, there)).toBeLessThan(1);
	}, 30_000);
});

test('codeName', () => {
	expect(codeName({ type: 'SI', code: 44 })).toBe('SI 44');
	expect(codeName({ type: 'II', code: 11 })).toBe('II 11');
	expect(codeName({ type: 'II', code: 0 })).toBeNull(); // squitters, nobody asked
	expect(codeName({ type: 'invalid', code: 100 })).toBeNull();
	expect(codeName(null)).toBeNull();
});
