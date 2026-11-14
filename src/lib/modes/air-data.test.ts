import { describe, expect, test } from 'bun:test';
import {
	airDensity,
	densityAltitude,
	isaDensity,
	isaTemperature,
	machFromCas,
	speedOfSound,
	staticPressure,
	temperatureFromMach,
	totalTemperature
} from './air-data';

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

describe('the standard atmosphere (ICAO Doc 7488 / US Standard Atmosphere 1976 tables)', () => {
	test('temperature: −1.98 °C per 1,000 ft, then −56.5 °C from the tropopause', () => {
		expect(isaTemperature(0)).toBe(288.15);
		expect(isaTemperature(10_000)).toBeCloseTo(268.338, 3); // −4.8 °C
		expect(isaTemperature(36_089)).toBeCloseTo(216.65, 2);
		expect(isaTemperature(45_000)).toBe(216.65);
	});

	test('density', () => {
		expect(isaDensity(0)).toBeCloseTo(1.225, 4);
		expect(isaDensity(10_000)).toBeCloseTo(0.9046, 4); // 3,048 m
		expect(isaDensity(36_089.24)).toBeCloseTo(0.3639, 4); // 11 km
		expect(isaDensity(50_000)).toBeCloseTo(0.1865, 3); // 15,240 m
	});

	test('density altitude undoes isaDensity, below and above the tropopause', () => {
		for (const ft of [0, 5_000, 20_000, 36_000, 36_089, 40_000, 60_000]) {
			expect(densityAltitude(isaDensity(ft))).toBeCloseTo(ft, 6);
		}
	});

	test('density altitude: 30 °C at sea level is like 1,700 ft in standard air', () => {
		// The FAA's rule of thumb (Pilot's Handbook of Aeronautical Knowledge): about 120 ft
		// per °C above standard, so 15 °C too warm ≈ 1,800 ft. Exactly: 1,724 ft.
		const rho = airDensity(101_325, 303.15);
		expect(densityAltitude(rho)).toBeCloseTo(1724, 0);
	});
});

test('total air temperature: the probe is warmed by stopping the air', () => {
	expect(totalTemperature(216.65, 0)).toBe(216.65);
	// Mach 0.8 at −56.5 °C: the probe reads −28.8 °C (244.38 K).
	expect(totalTemperature(216.65, 0.8)).toBeCloseTo(244.38, 2);
});
