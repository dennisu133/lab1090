import { describe, expect, test } from 'bun:test';
import { applyHeadingChecks, correctedWind, headingChecks, turn } from './headings';
import type { WindSample } from './profile';
import { speedOf, toVector, type Vector } from './wind';

/** The capture's wind at cruise: 55 kt from 266°. */
const WIND = toVector(55, 266 + 180);

/**
 * An aircraft at 450 kt TAS on `heading`, whose heading is reported `error` degrees off:
 * the wind triangle then takes off an air vector turned by `error`. One sample a minute.
 */
function aircraft(
	icao: string,
	altitude: number,
	heading: number,
	error = 0,
	n = 10
): WindSample[] {
	const air = toVector(450, heading);
	const ground = { north: air.north + WIND.north, east: air.east + WIND.east };
	const reported = toVector(450, heading + error);
	return Array.from({ length: n }, (_, i) => ({
		icao,
		rx: i * 60_000,
		altitude,
		air: reported,
		from: '5,0/6,0' as const,
		at: null,
		wind: { north: ground.north - reported.north, east: ground.east - reported.east }
	}));
}

const off = (v: Vector) => speedOf({ north: v.north - WIND.north, east: v.east - WIND.east });

describe('turning a heading', () => {
	test('clockwise, like a heading: north turned 90° points east', () => {
		const v = turn({ north: 1, east: 0 }, 90);
		expect(v.north).toBeCloseTo(0, 12);
		expect(v.east).toBeCloseTo(1, 12);
	});

	test('a heading 3.5° off at 450 kt makes 27.5 kt of wind that is not there', () => {
		// 2 × 450 × sin(1.75°): the chord between the two air vectors.
		const [w] = aircraft('A', 35_000, 171, -3.5);
		expect(off(w.wind)).toBeCloseTo(27.5, 1);
		// Turning the reported heading back by +3.5° restores it.
		expect(off(correctedWind(w, 3.5))).toBeCloseTo(0, 9);
	});
});

describe('heading checks against the other aircraft', () => {
	const fleet = [
		...aircraft('A', 35_000, 171, -3.5),
		...aircraft('B', 36_000, 264),
		...aircraft('C', 37_000, 179),
		...aircraft('D', 36_000, 77),
		...aircraft('E', 34_000, 4)
	];

	test('finds the one aircraft whose heading is off, and by how much', () => {
		const checks = headingChecks(fleet);
		expect(checks.size).toBe(5);
		const a = checks.get('A')!;
		expect(a.correction).toBeCloseTo(3.5, 1);
		expect(a.others).toBe(4);
		expect(a.before).toBeCloseTo(27.5, 0);
		expect(a.after).toBeLessThan(0.5);
		expect(a.crosswind).toBeCloseTo(27.5, 0); // 450 × sin 3.5°
		expect(a.significant).toBe(true);
		for (const icao of ['B', 'C', 'D', 'E'])
			expect(Math.abs(checks.get(icao)!.correction)).toBeLessThan(0.05);
	});

	test('applied, every wind is the true one again', () => {
		const fixed = applyHeadingChecks(fleet, headingChecks(fleet));
		for (const w of fixed) expect(off(w.wind)).toBeLessThan(0.5);
	});

	test('with two errors among five, both are found; 2° is too small to apply', () => {
		const two = [
			...aircraft('A', 35_000, 171, -3.5),
			...aircraft('B', 36_000, 264, 2),
			...aircraft('C', 37_000, 179),
			...aircraft('D', 36_000, 77),
			...aircraft('E', 34_000, 4)
		];
		const checks = headingChecks(two);
		expect(checks.get('A')!.correction).toBeCloseTo(3.5, 0);
		expect(checks.get('B')!.correction).toBeCloseTo(-2, 0);
		expect(checks.get('B')!.significant).toBe(false);
		const fixed = applyHeadingChecks(two, checks);
		expect(off(fixed.find((w) => w.icao === 'A')!.wind)).toBeLessThan(1);
		expect(fixed.filter((w) => w.icao === 'B')).toEqual(two.filter((w) => w.icao === 'B'));
	});

	test('one against one: nobody can tell who is wrong, so no check', () => {
		const pair = [...aircraft('A', 35_000, 171, -3.5), ...aircraft('B', 36_000, 264)];
		expect(headingChecks(pair).size).toBe(0);
	});

	test('others too far away in height or time, or too few own samples: no check', () => {
		const apart = [
			...aircraft('A', 30_000, 171, -3.5),
			...aircraft('B', 36_000, 264),
			...aircraft('C', 37_000, 179)
		];
		expect(headingChecks(apart).has('A')).toBe(false);
		const late = [
			...aircraft('A', 35_000, 171, -3.5),
			...aircraft('B', 36_000, 264).map((w) => ({ ...w, rx: w.rx + 3_600_000 })),
			...aircraft('C', 37_000, 179).map((w) => ({ ...w, rx: w.rx + 3_600_000 }))
		];
		expect(headingChecks(late).has('A')).toBe(false);
		const few = [
			...aircraft('A', 35_000, 171, -3.5, 4),
			...aircraft('B', 36_000, 264),
			...aircraft('C', 37_000, 179)
		];
		expect(headingChecks(few).has('A')).toBe(false);
	});
});
