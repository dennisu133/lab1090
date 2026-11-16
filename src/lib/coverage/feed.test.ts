import { describe, expect, test } from 'bun:test';
import { timedMessages } from '#lib/modes/testing.ts';
import { Coverage, summarize } from './coverage';
import { radioHorizon } from './geometry';
import { CoverageFeed } from './feed';
import { runCoverage } from './testing';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import type { Trail } from '#lib/tracker/trail.ts';

// Tests use 52,14, never the real antenna position. The capture's wedge (open to the west,
// blocked to the east) only shows from where the antenna really stands; ROADMAP.md has it.
const RECEIVER = { lat: 52, lon: 14 };

const aircraft = (icao: string, trail: Trail) => ({ icao, trail }) as unknown as TrackedAircraft;
const point = (t: number, lon: number, altitude: number | null = 35_000, ground = false) => ({
	lat: 52,
	lon,
	altitude,
	ground,
	t
});

describe('CoverageFeed', () => {
	test("waits for a segment's second point, then feeds both, once", () => {
		const c = new Coverage(RECEIVER);
		const feed = new CoverageFeed();
		feed.add(c, [aircraft('A', [[point(0, 13)]])]);
		expect(c.positions).toBe(0);
		feed.add(c, [aircraft('A', [[point(0, 13), point(4000, 13.01)]])]);
		expect(c.positions).toBe(2);
		feed.add(c, [aircraft('A', [[point(0, 13), point(4000, 13.01)]])]);
		expect(c.positions).toBe(2);
		// The head moved on: one more.
		feed.add(c, [aircraft('A', [[point(0, 13), point(5000, 13.02)]])]);
		expect(c.positions).toBe(3);
	});

	test('skips surface points and points without an altitude', () => {
		const c = new Coverage(RECEIVER);
		new CoverageFeed().add(c, [
			aircraft('A', [[point(0, 13, null), point(1, 13, 0, true), point(2, 13.1)]])
		]);
		expect(c.positions).toBe(1);
	});

	test('a new unconfirmed segment waits, the confirmed one before it still counts', () => {
		const c = new Coverage(RECEIVER);
		new CoverageFeed().add(c, [
			aircraft('A', [[point(0, 13), point(4000, 13.01)], [point(60_000, 12)]])
		]);
		expect(c.positions).toBe(2);
	});
});

describe('the capture', () => {
	const coverage = runCoverage(timedMessages, RECEIVER);

	test('every confirmed airborne position of the 10 minutes', () => {
		expect(coverage.positions).toBe(2723);
		expect((coverage.last! - coverage.first!) / 60_000).toBeCloseTo(9.9, 1);
	});

	test('the farthest is under half its radio horizon: the signal gives out first', () => {
		const { farthest } = summarize(coverage.sectors(), (ft) => radioHorizon(ft));
		expect(farthest!.point.distance).toBeGreaterThan(150);
		expect(farthest!.point.distance).toBeLessThan(200);
		expect(farthest!.ofHorizon).toBeLessThan(0.5);
	});

	test('a new tab starts with the trails of the aircraft still in view: a part of the live run', () => {
		// Fed only at the end, like the stream's first update with the server's history. The
		// aircraft gone for over a minute have left the tracker, and their trails with them.
		const once = runCoverage(timedMessages, RECEIVER, Infinity);
		expect(once.positions).toBeGreaterThan(0);
		expect(once.positions).toBeLessThan(coverage.positions / 2);
		const live = coverage.sectors();
		for (const [i, s] of once.sectors().entries()) {
			if (s.lowest) expect(s.lowest.elevation).toBeGreaterThanOrEqual(live[i].lowest!.elevation);
			for (const [band, p] of s.farthest.entries())
				if (p) expect(p.distance).toBeLessThanOrEqual(live[i].farthest[band]!.distance);
		}
	});
});
