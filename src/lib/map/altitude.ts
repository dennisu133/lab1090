/**
 * Aircraft colours by altitude: warm near the ground, cool at cruise level. The colour
 * shows at a glance who is climbing out, who is on approach and who is passing over at
 * FL350 (most of what this receiver sees).
 *
 * Continuous, not in steps: an aircraft holding FL350 reads 35,000 and sometimes 35,025 ft
 * (the altitude comes in 25 ft steps), and that mustn't change its colour. Here it's
 * 1/400 of the way between two stops: invisible.
 *
 * Shared by the map (as a MapLibre expression) and the legend (as a CSS gradient), so they
 * can't disagree.
 */
import type { ExpressionSpecification } from 'maplibre-gl';

/** Barometric altitude (ft) → colour. Tailwind's 400 shades: bright on the dark map. */
export const ALTITUDE_STOPS: readonly [feet: number, colour: string][] = [
	[0, '#fb923c'], // orange-400: on approach, just took off
	[4_000, '#facc15'], // yellow-400
	[10_000, '#a3e635'], // lime-400
	[20_000, '#22d3ee'], // cyan-400
	[30_000, '#60a5fa'], // blue-400
	[40_000, '#c084fc'] // purple-400: the top of the airliners' range
];

/** On the ground (surface positions): no altitude, just "here". */
export const GROUND_COLOUR = '#a1a1aa'; // zinc-400
/** Airborne, but no altitude known (yet). */
export const UNKNOWN_COLOUR = '#e4e4e7'; // zinc-200

/**
 * The colour for features with an `altitude` property (ft; absent or null: unknown) and a
 * `ground` one. Interpolated in the Lab colour space, so the in-betweens look evenly spaced.
 */
export function altitudeColour(): ExpressionSpecification {
	return [
		'case',
		['==', ['get', 'ground'], true],
		GROUND_COLOUR,
		['==', ['typeof', ['get', 'altitude']], 'number'],
		['interpolate-lab', ['linear'], ['get', 'altitude'], ...ALTITUDE_STOPS.flat()],
		UNKNOWN_COLOUR
	];
}

/** The same in CSS, for the legend: left = 0 ft, right = the top stop. */
export function altitudeGradient(): string {
	const top = ALTITUDE_STOPS.at(-1)![0];
	const stops = ALTITUDE_STOPS.map(([feet, colour]) => `${colour} ${(feet / top) * 100}%`);
	return `linear-gradient(to right in oklab, ${stops.join(', ')})`;
}

/** One colour for CSS (e.g. the list's altitudes): the ramp at `feet`, mixed in oklab like the map. */
export function altitudeCss(feet: number | null, ground = false): string {
	if (ground) return GROUND_COLOUR;
	if (feet === null) return UNKNOWN_COLOUR;
	const i = ALTITUDE_STOPS.findIndex(([f]) => f > feet);
	if (i === 0) return ALTITUDE_STOPS[0][1];
	if (i === -1) return ALTITUDE_STOPS.at(-1)![1];
	const [f0, c0] = ALTITUDE_STOPS[i - 1];
	const [f1, c1] = ALTITUDE_STOPS[i];
	const share = Math.round(((feet - f0) / (f1 - f0)) * 100);
	return `color-mix(in oklab, ${c0}, ${c1} ${share}%)`;
}
