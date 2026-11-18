/**
 * What the weather charts share. The three profile charts on the "Now" tab share the
 * height and the altitude axis (0 to 45,000 ft, ground at the bottom), so the same layer
 * sits at the same height in each and they can be read side by side. Their width is the
 * element's, in px (bind:clientWidth), so the 10 px labels stay 10 px at any card width.
 *
 * The temperature charts (the profile, the per-aircraft ISA chart, the contrail diagram)
 * share the standard atmosphere's line and the °C grid labels.
 */
import { FT } from '#lib/units.ts';
import { T11, isaTemperature } from '#lib/modes/air-data.ts';

/** The width before the element has been measured, and the least it is drawn at, px. */
export const MIN_W = 240;
export const H = 360;
export const LEFT = 44;
export const RIGHT = 12;
export const TOP = 14;
export const BOTTOM = 30;
export const H_MAX = 45_000;

/** The chart's width, px: the measured one, at least MIN_W. */
export const chartWidth = (measured: number) => Math.max(measured, MIN_W);

/** Altitude (ft) to y. */
export const y = (feet: number) =>
	H - BOTTOM - (Math.min(Math.max(feet, 0), H_MAX) / H_MAX) * (H - BOTTOM - TOP);

/** A linear x axis from `min` to `max`, on a chart `width` px wide. */
export const xAxis = (min: number, max: number, width: number) => (value: number) =>
	LEFT + ((value - min) / (max - min)) * (width - LEFT - RIGHT);

export const LEVELS = [10_000, 20_000, 30_000, 40_000];

/** The standard atmosphere's tropopause: 11 km (ICAO Doc 7488), 36,089 ft. */
export const ISA_TROPOPAUSE_FT = 11_000 / FT;

/**
 * The standard atmosphere as an SVG polyline: 15 °C at sea level, −6.5 K/km (−1.98 °C per
 * 1,000 ft) up to the tropopause, then −56.5 °C up to H_MAX. `x` takes kelvin, `y` feet.
 */
export function isaPolyline(x: (kelvin: number) => number, y: (feet: number) => number): string {
	return [
		[isaTemperature(0), 0],
		[T11, ISA_TROPOPAUSE_FT],
		[T11, H_MAX]
	]
		.map(([t, h]) => `${x(t)},${y(h)}`)
		.join(' ');
}

/** Grid temperatures, °C: every `step` from `from` up to `to`. */
export const celsiusTicks = (from: number, to: number, step: number) =>
	Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** A °C grid label: "−40°", with a real minus, as in print. */
export const degrees = (c: number) => `${c < 0 ? '−' : ''}${Math.abs(c)}°`;
