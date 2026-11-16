import { describe, expect, test } from 'bun:test';
import {
	aircraftElevation,
	distanceAtElevation,
	EFFECTIVE_EARTH_KM,
	elevationAngle,
	radioHorizon
} from './geometry';

describe('radio horizon', () => {
	test('FL350 from sea level: ~425 km, as the roadmap reckoned with 4.12·√h', () => {
		// 4.12·√10668 = 425.5 km; √(2R'h) with R' = 8494.7 km gives the same.
		expect(radioHorizon(35_000)).toBeCloseTo(4.12 * Math.sqrt(10_668), -1);
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
		expect(elevationAngle(10, 0.1, 0.1)).toBeCloseTo(
			-(10 / (2 * EFFECTIVE_EARTH_KM)) * (180 / Math.PI),
			6
		);
		expect(elevationAngle(50, 0, 0.1)).toBeLessThan(0);
	});

	test('distanceAtElevation undoes it', () => {
		for (const [e, ft] of [
			[0, 35_000],
			[2.5, 35_000],
			[20, 38_000],
			[-0.3, 1_000]
		]) {
			const d = distanceAtElevation(e, ft)!;
			expect(aircraftElevation(d, ft)).toBeCloseTo(e, 6);
		}
		// At 0° from sea level, that's the horizon.
		expect(distanceAtElevation(0, 35_000)).toBeCloseTo(radioHorizon(35_000), 6);
		expect(distanceAtElevation(5, 100, 0.2)).toBeNull();
	});
});
