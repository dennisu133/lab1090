import { describe, expect, test } from 'bun:test';
import { angleDifference, components, meanWind, windTriangle } from './wind';

describe('the wind triangle', () => {
	test('no wind: the aircraft goes where it points, as fast as it flies', () => {
		expect(windTriangle({ speed: 450, track: 80 }, { speed: 450, heading: 80 }).speed).toBeCloseTo(
			0,
			9
		);
	});

	test('a pure tailwind: ground speed minus airspeed, blowing from behind', () => {
		// Flying east (090°) at 400 kt TAS, making 450 kt over the ground: 50 kt from the west.
		const w = windTriangle({ speed: 450, track: 90 }, { speed: 400, heading: 90 });
		expect(w.speed).toBeCloseTo(50, 9);
		expect(w.direction).toBeCloseTo(270, 9);
	});

	test('a pure headwind', () => {
		const w = windTriangle({ speed: 380, track: 0 }, { speed: 420, heading: 0 });
		expect(w.speed).toBeCloseTo(40, 9);
		expect(w.direction).toBeCloseTo(0, 9); // from the north, ahead
	});

	test('a crosswind: the aircraft points into it and drifts', () => {
		// Heading north at 100 kt, a 10 kt wind from the west pushes it to track 005.7°.
		const ground = { speed: Math.hypot(100, 10), track: (Math.atan2(10, 100) * 180) / Math.PI };
		const w = windTriangle(ground, { speed: 100, heading: 0 });
		expect(w.speed).toBeCloseTo(10, 9);
		expect(w.direction).toBeCloseTo(270, 9);
	});
});

describe('helpers', () => {
	test('angleDifference goes the short way round', () => {
		expect(angleDifference(350, 10)).toBe(20);
		expect(angleDifference(10, 350)).toBe(-20);
		expect(angleDifference(0, 180)).toBe(-180);
	});

	test('meanWind averages vectors, not angles', () => {
		// Tailwinds: heading north, the wind comes from the south; heading east, from the west.
		const a = windTriangle({ speed: 410, track: 0 }, { speed: 400, heading: 0 });
		const b = windTriangle({ speed: 410, track: 90 }, { speed: 400, heading: 90 });
		expect([a.direction, b.direction]).toEqual([180, 270]);
		const m = meanWind([a, b])!;
		expect(m.direction).toBeCloseTo(225, 9); // the average of the angles, here (no wrap-around)
		expect(m.speed).toBeCloseTo(Math.SQRT2 * 5, 9);
		// Across north: 350° and 10° average to 0°, not 180°.
		const c = windTriangle({ speed: 410, track: 170 }, { speed: 400, heading: 170 });
		const d = windTriangle({ speed: 410, track: 190 }, { speed: 400, heading: 190 });
		expect(angleDifference(meanWind([c, d])!.direction, 0)).toBeCloseTo(0, 9);
		expect(meanWind([])).toBeNull();
	});
});

describe('components', () => {
	test('a pure tailwind and a pure crosswind', () => {
		const tail = windTriangle({ speed: 450, track: 90 }, { speed: 400, heading: 90 });
		expect(components(tail, 90, 90)).toEqual({
			tailwind: 50,
			crosswind: expect.any(Number),
			drift: 0
		});
		expect(components(tail, 90, 90).crosswind).toBeCloseTo(0, 9);
		// Heading north, 10 kt from the west: pushed right (east), drifting right.
		const ground = { speed: Math.hypot(100, 10), track: (Math.atan2(10, 100) * 180) / Math.PI };
		const c = components(windTriangle(ground, { speed: 100, heading: 0 }), 0, ground.track);
		expect(c.tailwind).toBeCloseTo(0, 9);
		expect(c.crosswind).toBeCloseTo(10, 9);
		expect(c.drift).toBeCloseTo(5.71, 2);
	});

	test('they rebuild the ground vector: tan(drift) = crosswind / (TAS + tailwind)', () => {
		const tas = 432;
		const heading = 81.595;
		const ground = { speed: 488, track: 80.332 };
		const c = components(windTriangle(ground, { speed: tas, heading }), heading, ground.track);
		expect(Math.hypot(tas + c.tailwind, c.crosswind)).toBeCloseTo(ground.speed, 9);
		expect((Math.atan2(c.crosswind, tas + c.tailwind) * 180) / Math.PI).toBeCloseTo(c.drift, 9);
	});
});
