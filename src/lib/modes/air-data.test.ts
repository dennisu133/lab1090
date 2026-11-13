import { expect, test } from 'bun:test';
import { machFromCas, staticPressure } from './air-data';

test('standard atmosphere pressure', () => {
	expect(staticPressure(0)).toBeCloseTo(101_325, 0);
	expect(staticPressure(36_089)).toBeCloseTo(22_632, -1); // 11 km, the tropopause
	expect(staticPressure(18_000)).toBeCloseTo(50_600, -2); // about half
});

test('Mach from indicated airspeed and altitude', () => {
	// At sea level, CAS = TAS, so Mach is just CAS over the speed of sound (661.5 kt).
	expect(machFromCas(300, 0)).toBeCloseTo(300 / 661.4786, 4);
	// A real 6,0 reply from the capture: 254 kt at 38,050 ft, Mach 0.804.
	expect(machFromCas(254, 38_050)).toBeCloseTo(0.802, 3);
	// Same airspeed indicator reading, higher up: faster through the air.
	expect(machFromCas(254, 30_000)).toBeLessThan(machFromCas(254, 38_000));
});
