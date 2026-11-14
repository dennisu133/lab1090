import { describe, expect, test } from 'bun:test';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { timedMessages } from '#lib/modes/testing.ts';
import type { Observation } from './observation';
import { WeatherPipeline } from './pipeline';
import { angleDifference } from './wind';

/**
 * The capture, through the same pipeline as /weather. Its wall-clock time is reconstructed
 * from when it was recorded (fixtures/README.md: 13 Nov 2026, 16:18:23 CET), which only
 * matters for the magnetic model. The receiver position is the one the CPR oracle derived
 * from the capture itself (tools/README.md), in case an aircraft has no ADS-B position.
 */
const START = Date.UTC(2026, 10, 13, 15, 18, 23);
const t0 = timedMessages[0].t;

const pipeline = new WeatherPipeline(() => ({ lat: 52, lon: 14 }));
const observations: Observation[] = (() => {
	const filter = new AddressFilter();
	const out: Observation[] = [];
	for (const { t, data } of timedMessages) {
		const rx = START + (t - t0);
		const o = pipeline.add(data, filter.check(data, t), rx, t);
		if (o) out.push(o);
	}
	return out;
})();
const aircraft = pipeline.tracker.list();
const trustedWind = observations.filter((o) => o.wind && !o.windProblem);
const trustedTemperature = observations.filter((o) => o.temperature && !o.temperatureProblem);

describe('the capture', () => {
	test('how many pairs, and why some are not trusted', () => {
		expect(observations.length).toBe(4586);
		const reasons: Record<string, number> = {};
		for (const o of observations) {
			// "turning: banked 12.3°" → "turning: banked #°"
			const key = (o.windProblem ?? 'trusted').replace(/\d+(\.\d+)?/g, '#').replace(/#,#/g, 'B');
			reasons[key] = (reasons[key] ?? 0) + 1;
		}
		expect(reasons).toEqual({
			trusted: 3995,
			'B and B are # s apart (at most # s)': 529,
			'turning: banked #° (at most #°)': 62
		});
		expect(trustedTemperature.length).toBe(3995 + 62); // turning doesn't matter for it
		expect(pipeline.contradicted).toBe(30);
	});

	test('11 aircraft; all but one have their own ADS-B position for the declination', () => {
		expect(aircraft.length).toBe(11);
		const fromReceiver = aircraft.filter((a) => a.latest.inputs.position?.from === 'receiver');
		expect(fromReceiver.map((a) => a.callsign)).toEqual(['CCA749']);
		// Even among these few aircraft the declination differs by 0.7°: 5 kt of crosswind
		// at 450 kt if the receiver's value were used for all of them.
		const declinations = trustedWind.map((o) => o.wind!.declination);
		expect(Math.min(...declinations)).toBeCloseTo(4.8, 1);
		expect(Math.max(...declinations)).toBeCloseTo(5.5, 1);
	});

	test('temperatures between −63 and −47 °C, at 31,700–39,050 ft', () => {
		// The standard atmosphere has −51 to −56.5 °C at these altitudes; real air is often
		// 5–10 K warmer or colder. So these are plausible, not checked against a reference.
		const celsius = trustedTemperature.map((o) => o.temperature!.kelvin - 273.15);
		expect(Math.min(...celsius)).toBeCloseTo(-62.4, 1);
		expect(Math.max(...celsius)).toBeCloseTo(-47.1, 1);
		const feet = observations.flatMap((o) => o.inputs.altitude?.feet ?? []);
		expect([Math.min(...feet), Math.max(...feet)]).toEqual([31_700, 39_050]);
	});

	test("each aircraft's trusted winds stay close to its own average", () => {
		// The jet stream doesn't change much in a minute, so this mostly measures noise:
		// rounding, the time between the replies, the register update rates.
		for (const a of aircraft) {
			const mine = trustedWind.filter((o) => o.icao === a.icao && o.rx > a.lastRx - 60_000);
			for (const o of mine) {
				const avg = a.average.wind!;
				const d = Math.hypot(
					o.wind!.wind.vector.north - avg.vector.north,
					o.wind!.wind.vector.east - avg.vector.east
				);
				expect(d).toBeLessThan(12);
			}
		}
	});

	test('every aircraft sees a westerly: 255–295°, 40–90 kt', () => {
		// Up here the air moves west to east almost everywhere at these latitudes (the
		// westerlies, with the jet stream inside them), so a wind from the east would mean
		// a sign error somewhere.
		for (const a of aircraft) {
			const w = a.average.wind!;
			expect(Math.abs(angleDifference(w.direction, 275))).toBeLessThan(21);
			expect(w.speed).toBeGreaterThan(39);
			expect(w.speed).toBeLessThan(90);
		}
	});

	test('the rounding ranges stay small at cruise: under ±2.5 kt, ±2°, ±2.5 K', () => {
		for (const o of trustedWind) {
			expect(o.wind!.speedRange[1] - o.wind!.speedRange[0]).toBeLessThan(5);
			expect(o.wind!.directionSpread).toBeLessThan(4);
		}
		for (const o of trustedTemperature) {
			expect(o.temperature!.range[1] - o.temperature!.range[0]).toBeLessThan(5);
		}
	});
});
