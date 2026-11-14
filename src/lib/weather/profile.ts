/**
 * The atmosphere above the receiver, by altitude: every aircraft's samples (sky.ts) put
 * into 1,000 ft layers, and what the layers show together.
 *
 * - Temperature and wind per layer, from the 5,0/6,0 observations (observation.ts).
 * - The column below each layer, from GNSS − baro (column.ts).
 * - The tropopause: where the temperature stops falling with height (see tropopause()).
 * - The strongest wind, and whether it's a jet stream (see strongestWind()).
 *
 * Climbing and descending aircraft sample every layer on the way, like a weather balloon
 * (airlines report the same way to weather services: AMDAR). Aircraft in cruise fill the
 * layers between FL300 and FL410. Layers are by pressure altitude: transponders always
 * report it against 1013.25 hPa, whatever the pilots set on their altimeters.
 *
 * Shared by server and browser; no state here.
 */
import { isaTemperature } from '#lib/modes/air-data.ts';
import type { ColumnInputs } from './column';
import { meanWind, speedOf, type Vector, type Wind } from './wind';

export const LAYER_FT = 1000;
/** Fewer samples than this, and a layer isn't used for the tropopause or the jet stream … */
export const MIN_SAMPLES = 5;
/**
 * … nor if they all come from one aircraft. Each aircraft has its own errors that don't
 * average out over its samples: compared with Lindenberg's weather balloons, one aircraft
 * in the capture read 7 K too cold, and another's heading was 3.5° off, which made 29 kt of
 * wind that wasn't there (src/lib/weather/sounding.test.ts).
 */
export const MIN_AIRCRAFT = 2;
/** WMO: the tropopause is where the lapse rate drops to 2 K/km or less … */
export const TROPOPAUSE_LAPSE = 2;
/** … and stays there on average for the next 2 km. */
export const TROPOPAUSE_DEPTH_FT = 2000 / 0.3048;
/** WMO: a jet stream has at least 30 m/s along its axis. */
export const JET_KT = 30 / (1852 / 3600);

export interface TemperatureSample {
	icao: string;
	rx: number;
	altitude: number;
	kelvin: number;
}

export interface WindSample {
	icao: string;
	rx: number;
	altitude: number;
	wind: Vector;
}

export interface ColumnSample extends ColumnInputs {
	icao: string;
	rx: number;
	/** Where the geoid was looked up: the aircraft's ADS-B position, or the receiver's. */
	position: { lat: number; lon: number; from: 'ADS-B' | 'receiver' };
}

export interface Count {
	/** Samples. */
	n: number;
	/** Different aircraft among them. */
	aircraft: number;
}

export interface Layer {
	/** Middle of the layer, ft: it spans ±500 ft. */
	level: number;
	temperature:
		| (Count & {
				kelvin: number;
				isaDeviation: number;
				/** Standard deviation of the samples, K: how much the aircraft disagree. */
				spread: number;
		  })
		| null;
	wind:
		| (Count & {
				wind: Wind;
				/**
				 * Length of the mean wind vector / mean wind speed: 1 if every sample blew the same
				 * way, near 0 if they cancel out.
				 */
				steadiness: number;
		  })
		| null;
	/** The mean of the column samples (column.ts turns it into a temperature). */
	column: (Count & ColumnInputs & { spread: number }) | null;
}

/** Enough samples, from enough aircraft, to count for the tropopause and the jet stream. */
export function enough<T extends Count>(c: T | null): c is T {
	return c !== null && c.n >= MIN_SAMPLES && c.aircraft >= MIN_AIRCRAFT;
}

const layerOf = (feet: number) => Math.round(feet / LAYER_FT) * LAYER_FT;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs: number[]) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const count = (samples: { icao: string }[]): Count => ({
	n: samples.length,
	aircraft: new Set(samples.map((s) => s.icao)).size
});

function group<T extends { altitude: number }>(samples: T[]): Map<number, T[]> {
	const byLayer = new Map<number, T[]>();
	for (const s of samples) {
		const level = layerOf(s.altitude);
		let list = byLayer.get(level);
		if (!list) byLayer.set(level, (list = []));
		list.push(s);
	}
	return byLayer;
}

/** Every layer with at least one sample of any kind, lowest first. */
export function layers(
	temperatures: TemperatureSample[],
	winds: WindSample[],
	columns: ColumnSample[]
): Layer[] {
	const t = group(temperatures);
	const w = group(winds);
	const c = group(columns);
	const levels = [...new Set([...t.keys(), ...w.keys(), ...c.keys()])].sort((a, b) => a - b);
	return levels.map((level) => {
		const ts = t.get(level);
		const ws = w.get(level);
		const cs = c.get(level);
		let wind: Layer['wind'] = null;
		if (ws) {
			const winds = ws.map((s) => ({ vector: s.wind, speed: speedOf(s.wind), direction: 0 }));
			const m = meanWind(winds)!;
			wind = { ...count(ws), wind: m, steadiness: m.speed / mean(winds.map((x) => x.speed)) };
		}
		return {
			level,
			temperature: ts
				? {
						...count(ts),
						kelvin: mean(ts.map((s) => s.kelvin)),
						isaDeviation: mean(ts.map((s) => s.kelvin - isaTemperature(s.altitude))),
						spread: std(ts.map((s) => s.kelvin))
					}
				: null,
			wind,
			column: cs
				? {
						...count(cs),
						altitude: mean(cs.map((s) => s.altitude)),
						gnssMinusBaro: mean(cs.map((s) => s.gnssMinusBaro)),
						geoid: mean(cs.map((s) => s.geoid)),
						spread: std(cs.map((s) => s.gnssMinusBaro))
					}
				: null
		};
	});
}

/** Lapse rate between two layers, K/km: how much colder it gets per km up (negative: warmer). */
export function lapseRate(
	lower: { level: number; kelvin: number },
	upper: { level: number; kelvin: number }
): number {
	return (lower.kelvin - upper.kelvin) / (((upper.level - lower.level) * 0.3048) / 1000);
}

export type Tropopause =
	| {
			found: true;
			level: number;
			/** Lapse rate to the next layer up, K/km. */
			lapse: number;
			/** The highest layer the 2 km check could use, ft. */
			checkedTo: number;
			/**
			 * The lowest layer with enough data already qualifies: the tropopause is here or lower,
			 * we can't see further down.
			 */
			atOrBelow: boolean;
	  }
	| { found: false; reason: string };

/**
 * The tropopause by the WMO's definition (1957, still the one radiosondes use): the lowest
 * level where the lapse rate drops to 2 K/km or less, provided the average lapse rate from
 * there to every higher level within 2 km stays at 2 K/km or less.
 *
 * Below it (the troposphere) the air is heated from the ground and cools with height,
 * about 6.5 K/km; above it (the stratosphere) the temperature stays level or rises,
 * because ozone absorbs sunlight there. Weather happens below it; airliners cruise just
 * below or just above it. Its height varies: about 8 km (26,000 ft) over the poles and in
 * cold air, 16 km over the tropics; over Europe usually 9–12 km (FL300–FL390). The ISA
 * puts it at 36,089 ft.
 *
 * Only layers with enough temperatures count (MIN_SAMPLES, from MIN_AIRCRAFT aircraft). Heights are pressure
 * altitudes rather than real heights, a few percent off: fine for a 2 K/km threshold.
 */
export function tropopause(all: Layer[]): Tropopause {
	const usable = all.flatMap((l) =>
		enough(l.temperature) ? [{ level: l.level, kelvin: l.temperature.kelvin }] : []
	);
	if (usable.length < 2)
		return { found: false, reason: 'Needs temperatures in at least two layers.' };

	let tooShort = false;
	for (let i = 0; i < usable.length - 1; i++) {
		const here = usable[i];
		const lapse = lapseRate(here, usable[i + 1]);
		if (lapse > TROPOPAUSE_LAPSE) continue;
		const above = usable.filter(
			(l) => l.level > here.level && l.level - here.level <= TROPOPAUSE_DEPTH_FT
		);
		if (above.length === 0) continue; // the next layer is more than 2 km up: a gap
		if (above.every((l) => lapseRate(here, l) <= TROPOPAUSE_LAPSE)) {
			// Data to at least 1 km above, or the 2 km check means little.
			if (above.at(-1)!.level - here.level < TROPOPAUSE_DEPTH_FT / 2) {
				tooShort = true;
				continue;
			}
			return {
				found: true,
				level: here.level,
				lapse,
				checkedTo: above.at(-1)!.level,
				atOrBelow: i === 0
			};
		}
	}
	return {
		found: false,
		reason: tooShort
			? 'A layer qualifies, but there are no temperatures far enough above it to check the next 2 km.'
			: `The temperature keeps falling faster than ${TROPOPAUSE_LAPSE} K/km through every layer with data (FL${usable[0].level / 100}–FL${usable.at(-1)!.level / 100}): the tropopause is higher.`
	};
}

export interface StrongestWind {
	level: number;
	wind: Wind;
	n: number;
	/** At least JET_KT: jet stream strength. */
	jet: boolean;
	/** The strongest layer is the highest / lowest one with data: the core may be beyond it. */
	atTop: boolean;
	atBottom: boolean;
}

/**
 * The layer with the strongest wind. Jet streams are narrow bands of fast wind just below
 * the tropopause, where cold polar air meets warmer air (the polar front jet over Europe):
 * at least 30 m/s (58 kt) by the WMO's definition, often 100–200 kt in winter. Eastbound
 * flights ride them, westbound ones avoid them.
 */
export function strongestWind(all: Layer[]): StrongestWind | null {
	const usable = all.filter((l) => enough(l.wind));
	if (usable.length === 0) return null;
	const best = usable.reduce((a, b) => (b.wind!.wind.speed > a.wind!.wind.speed ? b : a));
	return {
		level: best.level,
		wind: best.wind!.wind,
		n: best.wind!.n,
		jet: best.wind!.wind.speed >= JET_KT,
		atTop: best === usable.at(-1) && usable.length > 1,
		atBottom: best === usable[0] && usable.length > 1
	};
}
