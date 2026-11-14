import { describe, expect, test } from 'bun:test';
import { geoidUndulation } from './geoid';

/**
 * Reference values: bilinear interpolation on GeographicLib's full 15-minute EGM96 grid
 * (egm96-15.pgm, the source of egm96.ts; see tools/README.md). Our 2° grid may stray by a
 * few metres from it (egm96.ts quotes how far), more where the geoid bends sharply.
 */
const REFERENCE: [string, number, number, number][] = [
	['Berlin', 52.52, 13.4, 39.53],
	['Amsterdam', 52.31, 4.76, 43.04],
	['the lowest point, south of India', 4.7, 78.8, -106.96],
	['the highest, New Guinea', -4.6, 147.4, 77.99],
	['Denver (west: negative longitude)', 39.86, -104.67, -18.33],
	['0°N 0°E', 0, 0, 17.16],
	['the South Pole', -90, 0, -29.53],
	['just west of the date line', 10, 179.9, 12.78]
];

describe('geoidUndulation', () => {
	for (const [name, lat, lon, expected] of REFERENCE) {
		test(name, () => {
			expect(Math.abs(geoidUndulation(lat, lon) - expected)).toBeLessThan(3.5);
		});
	}

	test('longitudes wrap: −10° and 350° are the same place', () => {
		expect(geoidUndulation(50, -10)).toBe(geoidUndulation(50, 350));
	});
});
