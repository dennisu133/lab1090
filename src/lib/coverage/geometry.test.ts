import { describe, expect, test } from 'bun:test';
import { aircraftElevation, elevationAngle, radioHorizon } from './geometry';

describe('radio horizon', () => {
	test('FL350 from sea level: ~425 km, as 4.12·√h reckons', () => {
		// 4.12·√10668 = 425.5 km; √(2R'h) with R' = 8494.7 km gives the same.
		expect(Math.round(radioHorizon(35_000))).toBe(426);
	});

	test('a 10 m antenna adds ~13 km', () => {
		expect(radioHorizon(35_000, 0.01) - radioHorizon(35_000)).toBeCloseTo(13.0, 0);
	});

	test('an aircraft at the horizon is seen straight across from a sea-level antenna', () => {
		// There the drop d²/2R' equals its height: the grazing ray leaves horizontally.
		expect(aircraftElevation(radioHorizon(35_000), 35_000)).toBeCloseTo(0, 6);
	});
});

describe('elevation angle', () => {
	test('flat-Earth limit up close: FL380 at 29 km is ~22° up (the capture, north-east)', () => {
		// atan(11.58 / 29) = 21.8°; the Earth's curve takes 0.05 km off the height.
		expect(aircraftElevation(29, 38_000)).toBeCloseTo(21.7, 1);
	});

	test('0° at the antenna height straight across, negative below', () => {
		// Over 10 km the Earth drops away by d²/2R' = 100 / (2 × 8,494.7) km = 5.9 m: 0.0337° down.
		expect(elevationAngle(10, 0.1, 0.1)).toBeCloseTo(-0.0337, 4);
		expect(elevationAngle(50, 0, 0.1)).toBeLessThan(0);
	});
});
