import { describe, expect, test } from 'bun:test';
import { headingChecks } from '#lib/weather/headings.ts';
import { runCapture } from '#lib/weather/testing.ts';
import { weatherHereFields } from './weather';

describe('weatherHereFields: the tracker panel, on the capture', () => {
	const { pipeline } = runCapture();
	const checks = headingChecks(pipeline.sky.samples.winds);
	// The capture's last aircraft still in the weather tracker, at its end.
	const aircraft = pipeline.tracker.list();
	const now = Math.max(...aircraft.map((a) => a.lastRx));
	const fields = new Map(
		aircraft.map((a) => [a.icao, weatherHereFields(a, checks.get(a.icao) ?? null, now)])
	);

	test('every aircraft with a trusted wind gets wind, components and temperature', () => {
		for (const a of aircraft) {
			const labels = fields.get(a.icao)!.map((f) => f.label);
			if (a.lastWind) expect(labels).toContain('Wind');
			if (a.lastWind) expect(labels).toContain('For it');
			if (a.lastTemperature) expect(labels).toContain('Outside air');
		}
	});

	test('the aircraft whose heading is off says so, and what the map uses instead', () => {
		// Against the weather balloons its heading is 3.5° off (sounding.test.ts); the other
		// aircraft say 4.0°. Corrected, its wind at FL350 is 57 kt: the balloons measured
		// 53–61 kt there. As sent it's 88 kt over its last minute (83 kt over its whole time at FL350,
		// pipeline.test.ts).
		const off = [...checks.values()].filter((c) => c.significant);
		expect(off.length).toBe(1);
		const mine = new Map(fields.get(off[0].icao)!.map((f) => [f.label, f]));
		expect(mine.get('Wind')!.value).toBe('W 265° · 57 kt');
		expect(mine.get('Heading check')!.tone).toBe('alert');
		expect(mine.get('Heading check')!.value).toBe('4.0° off, corrected (as sent: 88 kt)');
		expect(mine.get('Heading check')!.title).toContain('the barbs on the map');
		const others = [...fields.values()].flat().filter((f) => f.label === 'Heading check');
		expect(others.filter((f) => f.tone === 'minor').length).toBe(checks.size - 1);
	});

	test('values read like a weather report', () => {
		for (const f of [...fields.values()].flat()) {
			if (f.label === 'Wind' && f.value !== 'not now')
				expect(f.value).toMatch(/^[NESW]{1,2} \d{3}° · \d+ kt$/);
			if (f.label === 'Outside air') expect(f.value).toMatch(/^−\d+\.\d °C · ISA [+−]?\d+$/);
		}
	});
});
