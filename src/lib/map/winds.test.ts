import { describe, expect, test } from 'bun:test';
import type { HeadingCheck } from '#lib/weather/headings.ts';
import type { WindSample } from '#lib/weather/profile.ts';
import { toVector } from '#lib/weather/wind.ts';
import {
	BARB_BIN_MS,
	BARB_FADE_MS,
	barbFeatures,
	barbIcon,
	barbParts,
	barbShape,
	parseBarbIcon
} from './winds';

describe('barbParts: the WMO feathers', () => {
	test.each([
		[0, 0, 0, false],
		[2, 0, 0, false], // calm: under 2.5 kt rounds to 0
		[5, 0, 0, true],
		[10, 0, 1, false],
		[25, 0, 2, true],
		[47, 0, 4, true], // 47 → 45
		[48, 1, 0, false], // 48 → 50: a pennant
		[65, 1, 1, true],
		[155, 3, 0, true]
	])('%p kt: %p pennants, %p barbs, half %p', (kt, pennants, barbs, half) => {
		expect(barbParts(kt)).toMatchObject({ pennants, barbs, half });
	});
});

test('icon names say the rounded speed and the hemisphere, and parse back', () => {
	expect(barbIcon(63.4, 52)).toBe('barb-n-65');
	expect(barbIcon(63.4, -33)).toBe('barb-s-65');
	expect(parseBarbIcon('barb-s-65')).toEqual({ knots: 65, south: true });
	expect(parseBarbIcon('jet')).toBeNull();
});

describe('barbShape', () => {
	test('pointing up from the station; feathers to the right in the north, left in the south', () => {
		const north = barbShape(25, false);
		const [staff, ...feathers] = north.lines;
		const [x, bottom, , tip] = staff;
		expect(x).toBe(north.width / 2);
		expect(bottom).toBe(north.station.y);
		expect(tip).toBeLessThan(bottom);
		expect(feathers.length).toBe(3); // two barbs, a half
		for (const [, , x2] of feathers) expect(x2).toBeGreaterThan(x);
		for (const [, , x2] of barbShape(25, true).lines.slice(1)) expect(x2).toBeLessThan(x);
	});

	test('feathers lean towards the tip, the half is half as long', () => {
		const [, full, half] = barbShape(15, false).lines;
		expect(full[3]).toBeLessThan(full[1]); // the free end is further out along the staff
		expect(half[2] - half[0]).toBe((full[2] - full[0]) / 2);
	});

	test('a lone half barb is set back from the tip, so 5 kt is not read as 10', () => {
		const [staff, half] = barbShape(5, false).lines;
		expect(half[1]).toBeGreaterThan(staff[3]);
		const [, ten] = barbShape(10, false).lines;
		expect(ten[1]).toBe(staff[3]);
	});

	test('a calm is a ring, no staff; strong winds get a longer staff, all inside the image', () => {
		expect(barbShape(0, false)).toMatchObject({ lines: [], station: { calm: true } });
		const strong = barbShape(195, false); // 3 pennants, 4 barbs, a half
		expect(strong.triangles.length).toBe(3);
		expect(strong.height).toBeGreaterThan(barbShape(20, false).height);
		const ys = [
			...strong.lines.flatMap(([, y1, , y2]) => [y1, y2]),
			...strong.triangles.flat().map(([, y]) => y)
		];
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(8);
		expect(Math.max(...ys)).toBeLessThanOrEqual(strong.height - 8);
	});
});

describe('barbFeatures', () => {
	const T0 = 100 * BARB_BIN_MS;
	const sample = (over: Partial<WindSample> & { rx: number }): WindSample => ({
		icao: 'ABC123',
		altitude: 36_000,
		wind: toVector(60, 90), // from the west
		air: toVector(450, 0),
		from: '5,0/6,0',
		at: { lat: 52, lon: 14 + over.rx / 1e7 },
		...over
	});

	test('one barb per aircraft and minute: the mean wind, at the middle sample', () => {
		const winds = [
			sample({ rx: T0, wind: toVector(50, 90) }),
			sample({ rx: T0 + 10_000, wind: toVector(70, 90) }),
			sample({ rx: T0 + 20_000, wind: toVector(60, 90) }),
			sample({ rx: T0 + BARB_BIN_MS }), // the next minute
			sample({ rx: T0, icao: 'DEF456' })
		];
		const { features } = barbFeatures(winds, new Map(), T0 + BARB_BIN_MS);
		expect(features.length).toBe(3);
		const first = features.find(
			(f) => f.properties.icao === 'ABC123' && f.properties.samples === 3
		)!;
		expect(first.properties.speed).toBeCloseTo(60, 6);
		expect(first.properties.direction).toBeCloseTo(270, 6); // from the west
		expect(first.properties.icon).toBe('barb-n-60');
		expect(first.geometry.coordinates).toEqual([14 + (T0 + 10_000) / 1e7, 52]);
	});

	test('no position, no barb; older than the fade, gone; fading and sorted newest first', () => {
		const now = T0 + BARB_FADE_MS;
		const { features } = barbFeatures(
			[
				sample({ rx: T0, at: null }),
				sample({ rx: T0 - BARB_BIN_MS }), // too old
				sample({ rx: T0 }),
				sample({ rx: now })
			],
			new Map(),
			now
		);
		expect(features.map((f) => f.properties.opacity)).toEqual([expect.closeTo(0.3, 6), 1]);
		expect(features.map((f) => f.properties.sort)).toEqual([BARB_FADE_MS, 0]);
	});

	test('says which were corrected (only real readings: a turn has no heading)', () => {
		const check = { correction: 3.5, significant: true } as HeadingCheck;
		const { features } = barbFeatures(
			[sample({ rx: T0 }), sample({ rx: T0, from: 'turn', air: null })],
			new Map([['ABC123', check]]),
			T0
		);
		expect(features.map((f) => [f.properties.from, f.properties.corrected])).toEqual([
			['5,0/6,0', 3.5],
			['turn', 0]
		]);
	});
});
