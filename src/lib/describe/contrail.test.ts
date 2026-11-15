import { describe, expect, test } from 'bun:test';
import { staticPressure } from '#lib/modes/air-data.ts';
import { contrailRange, thresholds } from '#lib/weather/contrail.ts';
import { LAYER_FT, layers } from '#lib/weather/profile.ts';
import { runCapture } from '#lib/weather/testing.ts';
import { contrailField, contrailRuns, humidityNeeded } from './contrail';

describe('humidityNeeded', () => {
	const p = staticPressure(37_000);
	const t = thresholds(p);
	test('a range, from 0 ("up to"), or open-ended near the saturated threshold', () => {
		expect(humidityNeeded(contrailRange(t.dry + 4, p))).toMatch(/^\d+–\d+\u00a0%$/);
		expect(humidityNeeded(contrailRange(t.dry + 1, p))).toMatch(/^up to \d+\u00a0%$/);
		expect(humidityNeeded(contrailRange(t.saturated - 1, p))).toMatch(/^\d+\u00a0% or more$/);
		expect(humidityNeeded(contrailRange(t.saturated + 3, p))).toBeNull();
	});
});

describe('on the capture', () => {
	const { pipeline } = runCapture();
	const all = layers(pipeline.sky.samples.temperatures, [], []);
	const aircraft = pipeline.tracker.list();
	const field = (icao: string) => {
		const a = aircraft.find((x) => x.icao === icao)!;
		const feet = a.lastTemperature!.inputs.altitude!.feet;
		const level = Math.round(feet / LAYER_FT) * LAYER_FT;
		return contrailField(a, all.find((l) => l.level === level) ?? null)!;
	};

	test("/weather's summary: FL370 in any air, FL360 and FL380 depend on the humidity", () => {
		// FL360 at −54.0 °C is 1.9 K below the dry-air threshold: within the 2 K margin, so
		// "humid", though it needs very little. FL370 is 4.4 K below it, but only because
		// its 2 aircraft read 3–6 K colder than the balloons (sounding.test.ts): the margin
		// can't catch that. FL380 is within 0.5 K of the balloons.
		expect(contrailRuns(all)).toEqual([
			{ verdict: 'humid', from: 36_000, to: 36_000, needed: 'up to 3\u00a0%' },
			{ verdict: 'always', from: 37_000, to: 37_000, needed: null },
			{ verdict: 'humid', from: 38_000, to: 38_000, needed: '10–80\u00a0%' }
		]);
	});

	test('every aircraft with a temperature and an altitude gets a line', () => {
		for (const a of aircraft)
			if (a.lastTemperature?.temperature && a.lastTemperature.inputs.altitude)
				expect(contrailField(a, null)).not.toBeNull();
	});

	test("the layer's mean when it has enough, and how far the aircraft's own reading is off", () => {
		// 501C2B, the aircraft the balloons put 7 K too cold, shares FL370 with one other.
		const f = field('501C2B');
		expect(f.value).toBe('probably: cold enough even in dry air');
		expect(f.title).toContain('the mean of 64 samples from 2 aircraft');
		expect(f.title).toContain('K colder than the mean');
		expect(f.title).toContain('Look up: if it doesn');
		expect(f.title).toContain('saturated over ice');
	});

	test('its own reading where its level has too few aircraft', () => {
		const f = field('3C4B4B'); // FL337, alone there
		expect(f.value).toMatch(/^needs up to \d+\u00a0% humidity$/);
		expect(f.title).toContain('its own reading (fewer than 2 aircraft');
	});
});
