/**
 * What the three profile charts on the "Now" tab share: the size, and the altitude axis
 * (0 to 45,000 ft, ground at the bottom), so the same layer sits at the same height in
 * each and they can be read side by side.
 */
export const W = 320;
export const H = 360;
export const LEFT = 44;
export const RIGHT = 12;
export const TOP = 14;
export const BOTTOM = 30;
export const H_MAX = 45_000;

/** Altitude (ft) to y. */
export const y = (feet: number) =>
	H - BOTTOM - (Math.min(Math.max(feet, 0), H_MAX) / H_MAX) * (H - BOTTOM - TOP);

/** A linear x axis from `min` to `max`. */
export const xAxis = (min: number, max: number) => (value: number) =>
	LEFT + ((value - min) / (max - min)) * (W - LEFT - RIGHT);

export const LEVELS = [10_000, 20_000, 30_000, 40_000];
