import { describe, expect, test } from 'bun:test';
import { staticPressure } from '#lib/modes/air-data.ts';
import { contrailRange, thresholds } from '#lib/weather/contrail.ts';
import { LAYER_FT, layers, type Layer } from '#lib/weather/profile.ts';
import { runCapture } from '#lib/weather/testing.ts';
import {
	contrailField,
	contrailHeadline,
	contrailRuns,
	humidityNeeded,
	runText,
	type ContrailRun
} from './contrail';

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

describe('contrailHeadline', () => {
	const run = (verdict: ContrailRun['verdict'], from: number, to = from): ContrailRun => ({
		verdict,
		from,
		to,
		needed: verdict === 'humid' ? '10–80\u00a0%' : null,
		split: null
	});
	test('joins "any air" runs split only by layers without data, not across another verdict', () => {
		const gap = [run('humid', 33_000), run('always', 35_000, 37_000), run('always', 39_000)];
		expect(contrailHeadline(gap)).toEqual({ text: 'FL350–FL390', always: true });
		const between = [run('always', 31_000), run('humid', 32_000), run('always', 35_000, 36_000)];
		expect(contrailHeadline(between).text).toBe('FL310, FL350–FL360');
	});
	test('without any, the next best answer', () => {
		expect(contrailHeadline([run('never', 30_000), run('humid', 34_000)]).text).toBe(
			'humid air only'
		);
		expect(contrailHeadline([run('never', 30_000)])).toEqual({ text: 'too warm', always: false });
		expect(contrailHeadline([]).text).toBe('no data yet');
	});
});

describe('contrailRuns', () => {
	/** A layer with enough temperatures, `kelvin` relative to its own thresholds. */
	const layer = (level: number, kelvin: (t: ReturnType<typeof thresholds>) => number): Layer => ({
		level,
		temperature: {
			n: 10,
			aircraft: 3,
			kelvin: kelvin(thresholds(staticPressure(level))),
			isaDeviation: 0,
			spread: 0
		},
		wind: null,
		column: null
	});

	test('a humid run from "any air" to "too warm" says which layers are which, not "0 % or more"', () => {
		// Each layer on its own needs some humidity, but 2 K colder FL270 makes a contrail in
		// any air and 2 K warmer FL210 none at all: across the run, anything goes.
		const all = [
			layer(21_000, (t) => t.saturated - 1),
			...[22_000, 23_000, 24_000, 25_000].map((l) => layer(l, (t) => (t.dry + t.saturated) / 2)),
			layer(26_000, (t) => t.dry + 1),
			layer(27_000, (t) => t.dry + 1)
		];
		const runs = contrailRuns(all);
		expect(runs).toHaveLength(1);
		expect(runs[0].needed).toBe('0\u00a0% or more');
		expect(runs[0].split).toEqual({ anyAir: [26_000, 27_000], tooWarm: [21_000, 21_000] });
		expect(runText(runs[0])).toBe(
			'FL210–FL270 depends on the humidity: any air at FL260–FL270, too warm at FL210'
		);
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

	test("/weather's summary: FL360–FL370 in any air, FL380 depends on the humidity", () => {
		// FL360 at −54.0 °C and FL370 at −57.0 °C are 2.6 and 5.1 K below their dry-air
		// thresholds: more than the 2 K margin, so "any air". Only because their aircraft read
		// 3–6 K colder than the balloons (sounding.test.ts), which the margin can't catch: the
		// balloons say they needed 13–17 %. FL380 is within 0.5 K of the balloons.
		expect(contrailRuns(all)).toEqual([
			{ verdict: 'always', from: 36_000, to: 37_000, needed: null, split: null },
			{ verdict: 'humid', from: 38_000, to: 38_000, needed: 'up to 73\u00a0%', split: null }
		]);
		expect(contrailRuns(all).map(runText)).toEqual([
			'FL360–FL370 in any air',
			'FL380 needs up to 73\u00a0% humidity'
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
