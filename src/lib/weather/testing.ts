/**
 * Test helpers for the weather code: the capture run through the pipeline, and the weather
 * balloon ascents in fixtures/sounding/ (tools/sounding.ts). Only imported by tests.
 */
import { join } from 'node:path';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { pressureAltitude, staticPressure } from '#lib/modes/air-data.ts';
import { timedMessages } from '#lib/modes/testing.ts';
import { FT, KT } from '#lib/units.ts';
import { EPSILON, saturationOverWater } from './contrail';
import type { Observation } from './observation';
import { WeatherPipeline } from './pipeline';
import { toVector, type Vector } from './wind';

const root = join(import.meta.dir, '../../..');

/**
 * When the capture was recorded (fixtures/README.md: 13 Nov 2026, 16:18:23 CET). The
 * receiver's Beast timestamps only count from when readsb started, so the wall clock is
 * reconstructed from this; it only matters for the magnetic model.
 */
export const CAPTURE_START = Date.UTC(2026, 10, 13, 15, 18, 23);

let capture: { pipeline: WeatherPipeline; observations: Observation[] } | undefined;

/**
 * The capture through the same pipeline as /weather, once per test run. The receiver
 * position is the one the CPR oracle derived from the capture itself (tools/README.md),
 * in case an aircraft has no ADS-B position.
 */
export function runCapture() {
	if (capture) return capture;
	const pipeline = new WeatherPipeline(() => ({ lat: 52, lon: 14 }));
	const filter = new AddressFilter();
	const observations: Observation[] = [];
	const t0 = timedMessages[0].t;
	for (const { t, data } of timedMessages) {
		const o = pipeline.add(data, filter.check(data, t), CAPTURE_START + (t - t0), t);
		if (o) observations.push(o);
	}
	return (capture = { pipeline, observations });
}

export interface SoundingLevel {
	/** UTC, ms. */
	time: number;
	lat: number;
	lon: number;
	/** Pa */
	pressure: number;
	/** Geopotential height above sea level, ft: the same kind of height as column.ts's. */
	height: number;
	kelvin: number;
	/** Water vapour per dry air, kg/kg. */
	mixingRatio: number;
	/** kt, pointing where the air goes, like wind.ts's vectors. */
	wind: Vector;
}

export interface Sounding {
	/** UTC, ms. */
	launched: number;
	/** From the ground up. */
	levels: SoundingLevel[];
}

/** A file in fixtures/sounding/, e.g. "10393-2026-11-13-18z". */
export async function loadSounding(name: string): Promise<Sounding> {
	const text = await Bun.file(join(root, `fixtures/sounding/${name}.csv`)).text();
	const lines = text.trim().split('\n');
	const launch = lines.find((l) => l.startsWith('# Launched'))!;
	const [, date] = launch.match(/(\d{4}-\d\d-\d\d) /)!;
	const levels = lines
		.filter((l) => !l.startsWith('#'))
		.slice(1)
		.map((line): SoundingLevel => {
			const [time, lat, lon, hPa, m, celsius, mixing, from, ms] = line.split(',');
			return {
				time: Date.parse(`${date}T${time}Z`),
				lat: Number(lat),
				lon: Number(lon),
				pressure: Number(hPa) * 100,
				height: Number(m) / FT,
				kelvin: Number(celsius) + 273.15,
				mixingRatio: Number(mixing) / 1000,
				// Reported where it blows from, in m/s.
				wind: toVector(Number(ms) / KT, Number(from) + 180)
			};
		});
	return { launched: levels[0].time, levels };
}

/** The sounding at a pressure, interpolated in ln p (linear in height, roughly). */
export function atPressure(s: Sounding, pascal: number): SoundingLevel {
	const i = s.levels.findIndex((l) => l.pressure <= pascal);
	if (i <= 0) throw new Error(`${pascal} Pa is outside the sounding`);
	const a = s.levels[i - 1];
	const b = s.levels[i];
	const k = Math.log(a.pressure / pascal) / Math.log(a.pressure / b.pressure);
	const mix = (x: number, y: number) => x + k * (y - x);
	return {
		time: mix(a.time, b.time),
		lat: mix(a.lat, b.lat),
		lon: mix(a.lon, b.lon),
		pressure: pascal,
		height: mix(a.height, b.height),
		kelvin: mix(a.kelvin, b.kelvin),
		mixingRatio: mix(a.mixingRatio, b.mixingRatio),
		wind: { north: mix(a.wind.north, b.wind.north), east: mix(a.wind.east, b.wind.east) }
	};
}

/** The mean of the levels within a 1,000 ft layer of pressure altitude (profile.ts's layers). */
export function inLayer(s: Sounding, level: number): { kelvin: number; wind: Vector } {
	const top = staticPressure(level + 500);
	const bottom = staticPressure(level - 500);
	const ls = s.levels.filter((l) => l.pressure <= bottom && l.pressure >= top);
	const mean = (f: (l: SoundingLevel) => number) =>
		ls.reduce((sum, l) => sum + f(l), 0) / ls.length;
	return {
		kelvin: mean((l) => l.kelvin),
		wind: { north: mean((l) => l.wind.north), east: mean((l) => l.wind.east) }
	};
}

/**
 * QNH from the balloon's first level: the pressure the standard atmosphere has that many
 * feet below it. That's how a QNH is defined (ICAO Doc 8896): the station's pressure,
 * reduced to sea level through the ISA, whatever the real temperature.
 */
export function qnhOf(s: Sounding): number {
	const ground = s.levels[0];
	return staticPressure(pressureAltitude(ground.pressure) - ground.height) / 100;
}

/**
 * Relative humidity over water (0–1) from a mixing ratio (kg/kg), pressure (Pa), temperature
 * (K): what a radiosonde's humidity means for contrails. Aircraft don't measure humidity, so
 * only the balloon comparison needs it. E.g. 0.01 g/kg at 250 hPa, −50 °C: e = 0.402 Pa of
 * 6.44 Pa saturated, 6 %.
 */
export function humidityOf(mixingRatio: number, pressure: number, kelvin: number): number {
	const e = (mixingRatio * pressure) / (EPSILON + mixingRatio);
	return e / saturationOverWater(kelvin);
}
