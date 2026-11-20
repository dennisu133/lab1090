/**
 * Collects what /weather's Profile tab shows, over the last WINDOW_MS: temperatures and
 * winds by altitude (from the observations), GNSS − baro (from ADS-B), and the pressure
 * settings aircraft report (for QNH). profile.ts and column.ts turn them into layers.
 *
 * Thinned to one sample per aircraft and kind every SAMPLE_EVERY_MS: radars read some
 * aircraft several times a second and ADS-B sends twice a second, so without it the
 * busiest aircraft would decide every layer's average. Ten seconds is 300 ft of climb at
 * 2,000 ft/min, well inside a 1,000 ft layer.
 *
 * Runs in the browser; state is the samples of the last half hour.
 */
import type { LatLon } from '#lib/modes/cpr.ts';
import type { TurnWind } from './circle';
import { geoidUndulation } from './geoid';
import type { LookupPosition, Observation } from './observation';
import type { ColumnSample, TemperatureSample, WindSample } from './profile';

export const WINDOW_MS = 30 * 60_000;
export const SAMPLE_EVERY_MS = 10_000;
/** A pressure setting this far from 1013.25 hPa is a local one (QNH); closer, it's standard. */
export const STANDARD_TOLERANCE = 0.5;
export const STANDARD_HPA = 1013.25;

export interface SettingSample {
	icao: string;
	rx: number;
	hPa: number;
	/** Pressure altitude when it was reported, ft. */
	altitude: number | null;
	from: '4,0' | 'TC 29';
}

/** Immutable: every change makes new arrays, so the page knows when to recompute. */
export interface SkySamples {
	temperatures: TemperatureSample[];
	winds: WindSample[];
	columns: ColumnSample[];
	/** Every pressure setting heard, standard or not. */
	settings: SettingSample[];
	/** Winds from turns, with their fits (they're also in `winds`). */
	turns: TurnWind[];
}

export class Sky {
	samples: SkySamples = { temperatures: [], winds: [], columns: [], settings: [], turns: [] };
	/** Last accepted sample per aircraft and kind, for the thinning. */
	#last = new Map<string, number>();

	/** `at`: where it was measured, for the map (WindSample.at). */
	addObservation(o: Observation, at: LatLon | null = null): void {
		const altitude = o.inputs.altitude?.feet;
		if (altitude === undefined) return;
		if (o.temperature && !o.temperatureProblem && this.#due('t', o.icao, o.rx))
			this.#push('temperatures', {
				icao: o.icao,
				rx: o.rx,
				altitude,
				kelvin: o.temperature.kelvin
			});
		if (o.wind && !o.windProblem && this.#due('w', o.icao, o.rx))
			this.#push('winds', {
				icao: o.icao,
				rx: o.rx,
				altitude,
				wind: o.wind.wind.vector,
				air: o.wind.air,
				from: '5,0/6,0',
				at
			});
	}

	/** GNSS − baro from a TC 19, with the pressure altitude from a TC 9–18 shortly before. */
	addColumn(
		icao: string,
		rx: number,
		altitude: number,
		gnssMinusBaro: number,
		position: LookupPosition
	): void {
		if (!this.#due('c', icao, rx)) return;
		this.#push('columns', {
			icao,
			rx,
			altitude,
			gnssMinusBaro,
			geoid: geoidUndulation(position.lat, position.lon),
			position
		});
	}

	/** A wind from a turn (circle.ts): one per turn, so no thinning. `at`: where it ended. */
	addTurn(t: TurnWind, at: LatLon | null = null): void {
		this.#push('turns', t);
		this.#push('winds', {
			icao: t.icao,
			rx: t.end,
			altitude: t.altitude,
			wind: t.wind.vector,
			air: null,
			from: 'turn',
			at
		});
	}

	addSetting(setting: SettingSample): void {
		if (!this.#due(`s${setting.from}`, setting.icao, setting.rx)) return;
		this.#push('settings', setting);
	}

	prune(now: number): void {
		const fresh = <T extends { rx: number }>(xs: T[]) =>
			xs.length && now - xs[0].rx > WINDOW_MS ? xs.filter((x) => now - x.rx <= WINDOW_MS) : xs;
		const s = this.samples;
		const next = {
			temperatures: fresh(s.temperatures),
			winds: fresh(s.winds),
			columns: fresh(s.columns),
			settings: fresh(s.settings),
			turns:
				s.turns.length && now - s.turns[0].end > WINDOW_MS
					? s.turns.filter((t) => now - t.end <= WINDOW_MS)
					: s.turns
		};
		if (Object.keys(next).some((k) => next[k as keyof SkySamples] !== s[k as keyof SkySamples]))
			this.samples = next;
		for (const [key, rx] of this.#last) if (now - rx > SAMPLE_EVERY_MS) this.#last.delete(key);
	}

	#due(kind: string, icao: string, rx: number): boolean {
		const key = `${kind} ${icao}`;
		const last = this.#last.get(key);
		if (last !== undefined && rx - last < SAMPLE_EVERY_MS) return false;
		this.#last.set(key, rx);
		return true;
	}

	#push<K extends keyof SkySamples>(kind: K, sample: SkySamples[K][number]): void {
		this.samples = { ...this.samples, [kind]: [...this.samples[kind], sample] };
	}
}

export interface Qnh {
	/** hPa: the median of the local settings, or standard if there are none. */
	hPa: number;
	/** Each aircraft's latest local setting, newest first. */
	local: SettingSample[];
	/** Aircraft whose latest setting is standard. */
	standard: number;
}

/**
 * Sea-level pressure from what the pilots set on their altimeters.
 *
 * Below the transition altitude (5,000 ft over most of Germany, higher around some
 * airports) pilots set the altimeter to QNH, the local pressure reduced to sea level, so
 * it reads height above sea level; air traffic control gives it out with every approach.
 * Above it, everyone uses the standard 1013.25 hPa so that all aircraft agree on what
 * "FL350" is. Aircraft report their setting in register 4,0 and ADS-B TC 29 (0.1 and 0.8
 * hPa steps).
 *
 * So a setting more than STANDARD_TOLERANCE from standard is someone's QNH. If the real
 * QNH is within that of standard we can't tell it apart, but then using standard is off by
 * at most 14 ft. Pressure varies by a few hPa across the receiver's range; the median of
 * the aircraft's settings is an average for the area. (Some pilots set QFE, the pressure at
 * the airfield itself, which reads height above the runway: rare outside military fields.)
 */
export function qnh(settings: SettingSample[]): Qnh {
	const latest = new Map<string, SettingSample>();
	for (const s of settings) latest.set(s.icao, s); // in arrival order: the last one wins
	const all = [...latest.values()];
	const local = all
		.filter((s) => Math.abs(s.hPa - STANDARD_HPA) > STANDARD_TOLERANCE)
		.sort((a, b) => b.rx - a.rx);
	const sorted = local.map((s) => s.hPa).sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	const median =
		sorted.length === 0
			? STANDARD_HPA
			: sorted.length % 2
				? sorted[mid]
				: (sorted[mid - 1] + sorted[mid]) / 2;
	return { hPa: median, local, standard: all.length - local.length };
}
