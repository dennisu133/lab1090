import { expect, test } from 'bun:test';
import { machFromCas, speedOfSound, staticPressure, temperatureFromMach } from './air-data';

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

test('speed of sound: 661.5 kt at 15 °C, 573.6 kt at −56.5 °C (the tropopause)', () => {
	expect(speedOfSound(288.15)).toBeCloseTo(661.48, 2);
	// ICAO standard atmosphere tables (Doc 7488) give 295.07 m/s = 573.57 kt above 11 km.
	expect(speedOfSound(216.65)).toBeCloseTo(573.57, 1);
});

test('temperature from TAS and Mach', () => {
	// At Mach 1, TAS is the speed of sound itself.
	expect(temperatureFromMach(661.4786, 1)).toBeCloseTo(288.15, 6);
	expect(temperatureFromMach(573.57, 1)).toBeCloseTo(216.65, 1);
	// A real 5,0/6,0 pair from the capture (44CE75 at FL390): 432 kt, Mach 0.744.
	expect(temperatureFromMach(432, 0.744) - 273.15).toBeCloseTo(-51.1, 1);
	// The inverse of speedOfSound: TAS = M · a(T).
	for (const t of [200, 230, 260, 300]) {
		expect(temperatureFromMach(0.78 * speedOfSound(t), 0.78)).toBeCloseTo(t, 9);
	}
});
