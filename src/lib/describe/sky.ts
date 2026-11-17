/**
 * What /weather's "Now" tab shows per 1,000 ft layer (lib/weather/profile.ts), as Fields.
 * Each tooltip says what went in and how it was computed, with the layer's own numbers.
 */
import { A0, isaTemperature, T0 } from '#lib/modes/air-data.ts';
import type { Column } from '#lib/weather/column.ts';
import {
	MIN_AIRCRAFT,
	MIN_SAMPLES,
	TROPOPAUSE_LAPSE,
	enough,
	type Count,
	type Layer
} from '#lib/weather/profile.ts';
import { SAMPLE_EVERY_MS } from '#lib/weather/sky.ts';
import type { Field } from './field';
import { celsius, flightLevel, isaText, signed, windText } from './weather';

/** "12 from 3 aircraft" */
const samplesText = (n: number, aircraft: number) =>
	`${n} sample${n === 1 ? '' : 's'} from ${aircraft} aircraft`;

const THINNING = `At most one sample per aircraft every ${SAMPLE_EVERY_MS / 1000} s, so busy aircraft don't outweigh the others.`;

/** What each kind of layer value feeds when it's enough(), and one aircraft's typical error. */
const COUNTED = {
	temperature: {
		usedFor: 'not used for the tropopause or the contrail answer',
		error: 'a few kelvin, compared with weather balloons'
	},
	wind: {
		usedFor: 'not used for the strongest wind',
		error: 'a heading a few degrees off is 10–30 kt of wind, compared with weather balloons'
	},
	'GNSS height': { usedFor: null, error: "its altimeter's own error" }
} as const;

function countField(n: number, aircraft: number, what: keyof typeof COUNTED): Field {
	const ok = enough({ n, aircraft });
	const { usedFor, error } = COUNTED[what];
	return {
		value: `${n}/${aircraft}`,
		title: [
			`${samplesText(n, aircraft)}. ${THINNING}`,
			ok
				? ''
				: ` Fewer than ${MIN_SAMPLES} samples, or fewer than ${MIN_AIRCRAFT} aircraft: shown hollow${usedFor ? `, ${usedFor}` : ''}.`,
			aircraft === 1
				? ` One aircraft only: this is its ${what}, with whatever error it has (${error}).`
				: ''
		].join(''),
		tone: ok ? 'minor' : 'alert'
	};
}

export function layerTemperatureFields(layer: Layer): Field[] {
	const t = layer.temperature;
	if (!t)
		return [{ value: '—', title: 'No trusted 5,0/6,0 temperature in this layer', tone: 'minor' }];
	const isa = isaTemperature(layer.level);
	return [
		{
			value: celsius(t.kelvin),
			title: [
				`Mean static air temperature of ${samplesText(t.n, t.aircraft)}: ${celsius(t.kelvin, 2)}.`,
				`Each one from true airspeed (5,0) and Mach (6,0): T = ${T0} K × (TAS / (Mach × ${A0.toFixed(2)} kt))², see "Per aircraft".`,
				'',
				`They differ by ±${t.spread.toFixed(1)} K (standard deviation): rounding (about ±2 K each at cruise), different air where each aircraft is, and each aircraft's own probe.`
			].join('\n'),
			tone: 'main'
		},
		{
			value: isaText(t.isaDeviation),
			title: `The standard atmosphere has ${celsius(isa)} at ${flightLevel(layer.level)}; each sample is compared at its own altitude, then averaged: ${signed(t.isaDeviation)} K, ${t.isaDeviation >= 0 ? 'warmer' : 'colder'} than standard.`,
			tone: 'minor'
		},
		countField(t.n, t.aircraft, 'temperature')
	];
}

/**
 * Lapse rate from this layer to the next one up with a temperature: how fast the air cools
 * with height. `upper` is null for the highest layer.
 */
export function lapseField(
	lower: { level: number; kelvin: number } & Count,
	upper: ({ level: number; kelvin: number } & Count) | null,
	lapse: number | null
): Field[] {
	if (!upper || lapse === null)
		return [{ value: '—', title: 'No temperature further up', tone: 'minor' }];
	const km = ((upper.level - lower.level) * 0.3048) / 1000;
	const noisy = !enough(lower) || !enough(upper);
	return [
		{
			value: `${signed(lapse)} K/km`,
			title: [
				`From ${flightLevel(lower.level)} to ${flightLevel(upper.level)} (${km.toFixed(2)} km): ${celsius(lower.kelvin)} → ${celsius(upper.kelvin)}, ${lapse >= 0 ? 'colder' : 'warmer'} by ${Math.abs(lapse * km).toFixed(1)} K.`,
				'',
				'The standard atmosphere cools by 6.5 K/km up to the tropopause, then not at all. Real air can cool faster or slower; an inversion is negative (warmer above).',
				`At ${TROPOPAUSE_LAPSE} K/km or less, staying so for 2 km, the WMO calls it the tropopause.`,
				'',
				`Over this gap, 1 K of noise in a layer's mean is ${(1 / km).toFixed(1)} K/km: trust the trend over several layers more than one value.${noisy ? ` One of these layers has fewer than ${MIN_SAMPLES} samples or ${MIN_AIRCRAFT} aircraft.` : ''}`
			].join('\n'),
			tone: noisy ? 'minor' : lapse <= TROPOPAUSE_LAPSE ? 'alert' : 'main'
		}
	];
}

export function layerWindFields(layer: Layer): Field[] {
	const w = layer.wind;
	if (!w) return [{ value: '—', title: 'No trusted wind in this layer', tone: 'minor' }];
	return [
		{
			value: windText(w.wind),
			title: [
				`Mean wind of ${samplesText(w.n, w.aircraft)}, averaged as vectors (north and east parts separately): from ${w.wind.direction.toFixed(0)}° at ${w.wind.speed.toFixed(1)} kt.`,
				'Each one from the wind triangle: ground vector (5,0) − air vector (5,0 TAS along 6,0 heading), see "Per aircraft"; or from the circle fit of a turn.'
			].join('\n'),
			tone: 'main',
			mono: true
		},
		{
			value: `${Math.round(w.steadiness * 100)} %`,
			title: `Steadiness: the mean vector's length over the mean speed. 100 % if every sample blew the same way; lower if they disagree in direction (different places, a wind changing direction with height or time).`,
			tone: w.steadiness < 0.9 ? 'alert' : 'minor'
		},
		countField(w.n, w.aircraft, 'wind')
	];
}

export function layerColumnFields(layer: Layer, c: Column | null): Field[] {
	const col = layer.column;
	if (!col || !c)
		return [{ value: '—', title: 'No GNSS − baro in this layer (ADS-B TC 19)', tone: 'minor' }];
	return [
		{
			value: `${signed(col.gnssMinusBaro, 0)} ft`,
			title: [
				`Mean GNSS height − pressure altitude of ${samplesText(col.n, col.aircraft)}, as the aircraft send it (ADS-B TC 19, 25 ft steps).`,
				`They differ by ±${col.spread.toFixed(0)} ft: different places and times, and avionics that send different kinds of height.`,
				'',
				'Pressure altitude assumes a standard column of air below. The real height of this pressure level is off from it by what the sea-level pressure and the temperature of the column did.'
			].join('\n'),
			tone: 'main'
		},
		countField(col.n, col.aircraft, 'GNSS height')
	];
}

export function columnDeviationFields(c: Column | null): Field[] {
	if (!c) return [{ value: '—', title: 'No GNSS − baro in this layer', tone: 'minor' }];
	return [
		{
			value: isaText(c.isaDeviation),
			title: [
				`The air column from the ground up to here is on average ${Math.abs(c.isaDeviation).toFixed(1)} K ${c.isaDeviation >= 0 ? 'warmer' : 'colder'} than standard.`,
				'',
				`Offset after the geoid and geopotential corrections: ${signed(c.offset, 0)} ft.`,
				`The sea-level pressure explains ${signed(c.pressurePart, 0)} ft of it, the rest (${signed(c.temperaturePart, 0)} ft) is temperature: at ${c.feetPerKelvin.toFixed(0)} ft per kelvin here, ${signed(c.isaDeviation)} K.`,
				'',
				"Not the temperature at this level (that's the Temperature column): an average over everything below, which in winter includes the cold air near the ground."
			].join('\n'),
			tone: 'main'
		}
	];
}
