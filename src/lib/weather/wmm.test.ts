import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { decimalYear, magneticField } from './wmm';

/**
 * NOAA's test values for WMM2025 (oracle/wmm/WMM2025_TestValues.txt, shipped with the
 * coefficients): 100 points from pole to pole over 2025–2029.5, with the field to 2 decimals
 * for angles and 6 for nT.
 */
const values = (
	await Bun.file(join(import.meta.dir, '../../../oracle/wmm/WMM2025_TestValues.txt')).text()
)
	.split('\n')
	.filter((line) => line.trim() && !line.startsWith('#'))
	.map((line) => {
		const [year, heightKm, lat, lon, declination, inclination, , x, y, z] = line
			.trim()
			.split(/\s+/)
			.map(Number);
		return { year, heightKm, lat, lon, declination, inclination, x, y, z };
	});

describe("NOAA's test values", () => {
	test('there are 100 of them', () => expect(values.length).toBe(100));

	test('declination and inclination to the published 2 decimals', () => {
		for (const v of values) {
			const f = magneticField(v.lat, v.lon, v.heightKm, v.year);
			expect(Math.abs(f.declination - v.declination)).toBeLessThanOrEqual(0.005 + 1e-9);
			expect(Math.abs(f.inclination - v.inclination)).toBeLessThanOrEqual(0.005 + 1e-9);
		}
	});

	test('the field components to within 0.01 nT', () => {
		for (const v of values) {
			const f = magneticField(v.lat, v.lon, v.heightKm, v.year);
			expect(f.x).toBeCloseTo(v.x, 2);
			expect(f.y).toBeCloseTo(v.y, 2);
			expect(f.z).toBeCloseTo(v.z, 2);
		}
	});
});

describe('decimalYear', () => {
	test('the start and middle of a year', () => {
		expect(decimalYear(Date.UTC(2026, 0, 1))).toBe(2026);
		expect(decimalYear(Date.UTC(2026, 6, 2, 12))).toBeCloseTo(2026.5, 3);
	});
});
