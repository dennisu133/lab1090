/**
 * How numbers, angles, altitudes and times are written everywhere in the UI: one place, so
 * /frames, the tracker and /weather say the same thing the same way.
 *
 * Always English number formatting ("38,000 ft", "1.5"): the UI is English, and a German
 * browser's "38.000 ft" would read as 38 ft with a decimal point next to the English text.
 * Minus signs are real ones (−, U+2212), as in print.
 */
import { KM_PER_NM } from '#lib/units.ts';

/** Whole numbers with thousands separators: 38,000. */
export const n = (x: number) => Math.round(x).toLocaleString('en');

/** Signed, with a real minus and thousands separators: −0.2, +1,500. No sign when it rounds to 0. */
export function signed(x: number, digits = 1): string {
	const text = Math.abs(x).toLocaleString('en', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
	if (Number(Math.abs(x).toFixed(digits)) === 0) return text;
	return `${x < 0 ? '−' : '+'}${text}`;
}

/**
 * "070°": a direction (heading, track, bearing, wind direction) in three digits, 000–359,
 * like on a chart, a compass rose or in a weather report.
 */
export const directionText = (x: number) =>
	`${String(((Math.round(x) % 360) + 360) % 360).padStart(3, '0')}°`;

/** "1.3°", "70°": any other angle (elevation, bank, a spread), as it is. */
export const angleText = (x: number, digits = 0) => `${x.toFixed(digits)}°`;

/**
 * "FL350" for 35,000 ft: the pressure altitude in hundreds of feet, always three digits
 * (FL050), as ATC says it. For labels where the altitude is always written this way.
 */
export function flightLevel(feet: number): string {
	return `FL${String(Math.round(feet / 100)).padStart(3, '0')}`;
}

/**
 * "FL370" from 18,000 ft, else feet ("4,500 ft"). 18,000 ft is the highest transition
 * altitude (the US); where it is lower (5,000 ft over most of Germany) an aircraft between
 * the two flies a flight level too, but feet are never wrong there, so one rule serves
 * everywhere.
 */
export function levelOrFeet(feet: number): string {
	return feet >= 18_000 ? flightLevel(feet) : `${n(feet)} ft`;
}

/** −53.5 °C from kelvin, with a real minus sign. */
export function celsius(kelvin: number, digits = 1): string {
	const c = kelvin - 273.15;
	const text = Math.abs(c).toFixed(digits);
	return `${c < 0 && Number(text) !== 0 ? '−' : ''}${text} °C`;
}

/** "1018.4 hPa", but the standard pressure as itself: "1013.25 hPa". */
export const hpa = (x: number) => `${x.toFixed(Math.round(x * 100) % 10 ? 2 : 1)} hPa`;

/** "4 s ago", "2 min ago". */
export function ago(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 120 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** "320 ms", "1.4 s": a short time between two events, e.g. two replies. */
export const interval = (ms: number) =>
	ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

/** Distances and speeds on the tracker: NM and kt (aviation's units), or km and km/h. */
export type Unit = 'NM' | 'km';

/** Whole units, or one decimal below 10 (dead reckoning moves aircraft by fractions of a mile). */
export function distanceText(km: number, unit: Unit): string {
	const d = unit === 'NM' ? km / KM_PER_NM : km;
	return `${d < 10 ? d.toFixed(1) : n(d)} ${unit}`;
}
