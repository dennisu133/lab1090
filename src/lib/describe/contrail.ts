/**
 * Contrails in words (lib/weather/contrail.ts): the tracker panel's "Contrail" line for the
 * selected aircraft, and /weather's summary of the layers. Humidity is never known here,
 * and temperatures are a couple of kelvin off, so most answers are a range of humidity:
 * the reader can settle it by looking up.
 */
import { staticPressure } from '#lib/modes/air-data.ts';
import {
	TEMPERATURE_MARGIN,
	contrailRange,
	type ContrailRange,
	type Verdict
} from '#lib/weather/contrail.ts';
import { LAYER_FT, MIN_AIRCRAFT, enough, type Layer } from '#lib/weather/profile.ts';
import type { WeatherAircraft } from '#lib/weather/tracker.ts';
import type { Field } from './field';
import { celsius, levelOrFeet } from './format';

const percent = (x: number) => `${Math.round(x * 100)} %`;

/**
 * A humidity range, 0–1 each: "10–80 %", "up to 44 %", "40 % or more"; hi null: no limit.
 * A no-break space before the %, so it never wraps onto a line of its own.
 */
function rangeText(lo: number, hi: number | null): string {
	const [a, b] = [Math.round(lo * 100), hi === null ? null : Math.round(hi * 100)];
	if (b === null) return `${a}\u00a0% or more`;
	if (a === b) return `${a}\u00a0%`;
	return a === 0 ? `up to ${b}\u00a0%` : `${a}–${b}\u00a0%`;
}

/**
 * The humidity (over water) the air needs, allowing TEMPERATURE_MARGIN either way. null
 * when the verdict is `never` even 2 K colder.
 */
export function humidityNeeded(r: ContrailRange): string | null {
	const lo = r.colder.humidityNeeded;
	return lo === null ? null : rangeText(lo, r.warmer.humidityNeeded);
}

/** The thresholds at a pressure, in a sentence. */
function thresholdText(r: ContrailRange, pressure: number): string {
	const t = r.at.thresholds;
	return `Whether its exhaust should leave a contrail. The hot, moist exhaust cools as it mixes with the air, and if it gets past the point where water condenses, droplets form and freeze. At its level (${(pressure / 100).toFixed(0)} hPa) that takes air colder than ${celsius(t.saturated)} if the air is saturated, and colder than ${celsius(t.dry)} if it's perfectly dry (the [Schmidt–Appleman criterion](https://elib.dlr.de/32128/)).`;
}

/** Whether a contrail lasts: ice saturation, which nobody here measures. */
function persistText(r: ContrailRange): string {
	return `A trail only lasts where the air is saturated over ice, here at ${percent(r.at.iceSaturation)} humidity: one that stays and spreads means air at least that humid.`;
}

const MARGIN_TEXT = `The temperature can be a couple of kelvin off, so the answer allows ${TEMPERATURE_MARGIN} K either way.`;

/** The short answer, as the panel's value and the worked example's headline. */
export function contrailValue(r: ContrailRange): string {
	return {
		always: 'probably: cold enough even in dry air',
		never: 'no: too warm',
		humid: `needs ${humidityNeeded(r)} humidity`
	}[r.verdict];
}

/** What the tracker decides for one aircraft, and from which temperature. */
export interface TrackerContrail {
	/** Its pressure altitude, ft, and the static pressure there, Pa. */
	feet: number;
	pressure: number;
	/** The temperature used, K: the layer's mean if `layer`, else `own`. */
	kelvin: number;
	/** Its own: the mean of its last minute, or its latest reading. */
	own: number;
	/** The layer whose mean is used: enough samples from enough aircraft. */
	layer: { level: number; n: number; aircraft: number } | null;
	range: ContrailRange;
}

/**
 * The temperature is its layer's mean when the layer has samples from at least
 * MIN_AIRCRAFT aircraft (each aircraft's own errors partly cancel), else its own. null
 * without a temperature or an altitude.
 */
export function trackerContrail(w: WeatherAircraft, layer: Layer | null): TrackerContrail | null {
	const t = w.lastTemperature;
	const feet = t?.inputs.altitude?.feet;
	if (!t?.temperature || feet === undefined) return null;
	const own = w.average.temperatureCount > 1 ? w.average.kelvin! : t.temperature.kelvin;
	const mean = layer?.temperature && enough(layer.temperature) ? layer.temperature : null;
	const kelvin = mean?.kelvin ?? own;
	const pressure = staticPressure(feet);
	return {
		feet,
		pressure,
		kelvin,
		own,
		layer: mean ? { level: layer!.level, n: mean.n, aircraft: mean.aircraft } : null,
		range: contrailRange(kelvin, pressure)
	};
}

/** Where the temperature comes from, in a sentence. */
export function temperatureSource(c: TrackerContrail): string {
	const { kelvin, own, layer } = c;
	return layer
		? `The air at ${levelOrFeet(layer.level)}: ${celsius(kelvin)}, the mean of ${layer.n} samples from ${layer.aircraft} aircraft (its own reading: ${celsius(own)}${
				Math.abs(own - kelvin) > TEMPERATURE_MARGIN
					? `, ${Math.abs(own - kelvin).toFixed(1)} K ${own < kelvin ? 'colder' : 'warmer'} than the mean: rounding, or a probe that's off, its own or another's; the data can't tell which`
					: ''
			}).`
		: `The air it flies through: ${celsius(kelvin)}, its own reading (fewer than ${MIN_AIRCRAFT} aircraft at its level to compare with).`;
}

/** The tracker panel's line for one aircraft (trackerContrail). */
export function contrailField(
	w: WeatherAircraft,
	layer: Layer | null
): (Field & { label: string }) | null {
	const c = trackerContrail(w, layer);
	if (!c) return null;
	const r = c.range;
	const needed = humidityNeeded(r);
	const verdictText = {
		always: `Cold enough even for dry air, so it should leave a contrail. Look up: if it doesn't, the temperature is off.`,
		never: `Too warm: no contrail, however humid the air.`,
		humid: `In between, so the humidity decides, and nobody here measures it: it needs ${needed}${r.at.humidityNeeded === null ? '' : ` (${percent(r.at.humidityNeeded)} at the temperature as measured)`}. Look up: a trail behind it means the air is at least that humid.`
	}[r.verdict];
	return {
		label: 'Contrail',
		value: contrailValue(r),
		// Paragraphs (Details.svelte): the rule, this air and the answer, persistence, where
		// to see it worked through.
		title: [
			thresholdText(r, c.pressure),
			`${temperatureSource(c)} ${MARGIN_TEXT} ${verdictText}`,
			r.verdict === 'never' ? '' : persistText(r),
			`Worked through step by step, with a diagram, on [Weather → Aircraft](/weather/aircraft?icao=${w.icao}#contrail).`
		]
			.filter(Boolean)
			.join('\n\n'),
		tone: 'main'
	};
}

export interface ContrailRun {
	verdict: Verdict;
	/** Lowest and highest layer, ft. */
	from: number;
	to: number;
	/** For `humid`: the humidity needed over the run, as humidityNeeded(). */
	needed: string | null;
	/**
	 * For a `humid` run whose layers range from any air (2 K colder) to too warm (2 K
	 * warmer), where `needed` would read "0 % or more": which layers are which. Else null.
	 */
	split: { anyAir: [number, number]; tooWarm: [number, number] } | null;
}

/** "FL360–FL370", "FL380" */
const levels = (from: number, to: number) =>
	from === to ? levelOrFeet(from) : `${levelOrFeet(from)}–${levelOrFeet(to)}`;
const runLevels = (r: ContrailRun) => levels(r.from, r.to);

/**
 * One run in /weather's summary: "FL360–FL370 in any air", "FL380 too warm", "FL340 needs
 * 40–90 % humidity", "FL210–FL270 depends on the humidity: any air at FL260–FL270, too
 * warm at FL210". Shorter than contrailValue: the summary lists several in a line.
 */
export function runText(r: ContrailRun): string {
	const verdict = {
		always: 'in any air',
		never: 'too warm',
		humid: r.split
			? `depends on the humidity: any air at ${levels(...r.split.anyAir)}, too warm at ${levels(...r.split.tooWarm)}`
			: `needs ${r.needed} humidity`
	}[r.verdict];
	return `${runLevels(r)} ${verdict}`;
}

/**
 * The Temperature card's headline: the levels where any air makes contrails (the blue runs).
 * Runs split only by layers without enough temperatures count as one: no layer in between
 * said otherwise, and the header has room for one range. Without any, the next best answer.
 */
export function contrailHeadline(runs: ContrailRun[]): { text: string; always: boolean } {
	const always: ContrailRun[] = [];
	let previous = -2;
	for (const [i, r] of runs.entries()) {
		if (r.verdict !== 'always') continue;
		if (previous === i - 1) always[always.length - 1] = { ...always.at(-1)!, to: r.to };
		else always.push(r);
		previous = i;
	}
	if (always.length) return { text: always.map(runLevels).join(', '), always: true };
	if (runs.some((r) => r.verdict === 'humid')) return { text: 'humid air only', always: false };
	if (runs.length) return { text: 'too warm', always: false };
	return { text: 'no data yet', always: false };
}

/**
 * /weather's summary: the layers with enough temperatures, lowest first, joined into runs
 * of neighbouring layers with the same verdict.
 */
export function contrailRuns(all: Layer[]): ContrailRun[] {
	const runs: (ContrailRun & { ranges: { level: number; range: ContrailRange }[] })[] = [];
	for (const l of all) {
		if (!enough(l.temperature)) continue;
		const r = contrailRange(l.temperature.kelvin, staticPressure(l.level));
		const last = runs.at(-1);
		if (last && last.verdict === r.verdict && l.level - last.to === LAYER_FT) {
			last.to = l.level;
			last.ranges.push({ level: l.level, range: r });
		} else
			runs.push({
				verdict: r.verdict,
				from: l.level,
				to: l.level,
				needed: null,
				split: null,
				ranges: [{ level: l.level, range: r }]
			});
	}
	return runs.map(({ ranges, ...run }) => {
		if (run.verdict !== 'humid') return run;
		// The run's range: the least any layer needs to the most.
		const lo = Math.min(...ranges.map(({ range }) => range.colder.humidityNeeded ?? 1));
		const his = ranges.map(({ range }) => range.warmer.humidityNeeded);
		const hi = his.includes(null) ? null : Math.max(...(his as number[]));
		const needed = rangeText(lo, hi);
		if (Math.round(lo * 100) !== 0 || hi !== null) return { ...run, needed };
		// "0 % or more" would read as "any air": say which layers go which way instead.
		const span = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];
		const anyAir = ranges.filter(
			({ range }) => Math.round((range.colder.humidityNeeded ?? 1) * 100) === 0
		);
		const tooWarm = ranges.filter(({ range }) => range.warmer.humidityNeeded === null);
		return {
			...run,
			needed,
			split: {
				anyAir: span(anyAir.map((x) => x.level)),
				tooWarm: span(tooWarm.map((x) => x.level))
			}
		};
	});
}
