/**
 * One weather observation: a track and turn report (5,0) and a heading and speed report
 * (6,0) from the same aircraft, close enough in time to describe the same moment.
 *
 *   5,0: ground speed, true track, true airspeed (TAS), roll angle, track rate
 *   6,0: magnetic heading, indicated airspeed, Mach, vertical rates
 *
 * Wind: the wind triangle (wind.ts) with the ground vector from 5,0 and the air vector
 * from 5,0's TAS along 6,0's heading, turned from magnetic to true by the declination
 * (wmm.ts). Temperature: 5,0's TAS and 6,0's Mach (air-data.ts).
 *
 * A radar reads the two registers one after the other, often in the same antenna sweep
 * (milliseconds apart), sometimes seconds apart. That only matters while the aircraft
 * turns: its heading changes at up to 3°/s, and each degree of heading error at 450 kt
 * is 8 kt of fake crosswind. Hence the two checks for the wind:
 *
 * - The replies are at most MAX_SKEW_MS apart.
 * - The aircraft isn't turning: roll angle at most MAX_ROLL. (In a coordinated turn the
 *   turn rate is g · tan(roll) / TAS: 3° of bank at 450 kt is 0.13°/s, so 2 s apart costs
 *   at most 0.25°, about 2 kt.) In the capture, wind from aircraft banking 10–17° with the
 *   replies 1–3 s apart scattered by ±10 kt; in straight flight it stayed within ~2 kt.
 *
 * Temperature doesn't depend on the heading, so turning is fine for it; it only needs the
 * two speeds to be from the same moment.
 *
 * Every input is rounded to the register's resolution (GS and TAS 2 kt, track and heading
 * 90/512°, Mach 0.004), so every result comes with the range those roundings allow:
 * we recompute with each input at both ends of its step and keep the extremes. That
 * assumes the transponder rounds to the nearest step; if it truncated, the true values
 * would be up to a whole step higher, which shifts the result but hardly widens it.
 *
 * Shared by server and browser; no state here (pairing replies is tracker.ts's job).
 */
import { temperatureFromMach } from '#lib/modes/air-data.ts';
import type { HeadingAndSpeed, TrackAndTurn } from '#lib/modes/registers.ts';
import { declination } from './wmm';
import { angleDifference, normalise, toVector, windTriangle, type Vector, type Wind } from './wind';

/** Replies further apart than this don't describe the same moment, ms. */
export const MAX_SKEW_MS = 2000;
/** More bank than this, degrees, and the aircraft is turning. */
export const MAX_ROLL = 3;

/** One step of each value in the registers (ICAO Doc 9871, tables A-2-80 and A-2-96). */
export const STEP = {
	speed: 2, // GS and TAS, kt
	angle: 90 / 512, // track and heading, °
	mach: 2.048 / 512
};

const G = 9.806_65; // m/s²
const KT = 1852 / 3600; // m/s per kt

/** Turn rate of a coordinated turn, °/s: g · tan(roll) / speed. */
export function turnRate(rollDegrees: number, tasKt: number): number {
	return ((G * Math.tan((rollDegrees * Math.PI) / 180)) / (tasKt * KT)) * (180 / Math.PI);
}

export interface Reading<T> {
	value: T;
	/** Wall clock, ms: for ages and the date of the magnetic model. */
	rx: number;
	/** Receiver clock, ms (Beast timestamp): precise, for the time between the two replies. */
	t: number;
}

export interface Inputs {
	trackAndTurn: Reading<TrackAndTurn>;
	headingAndSpeed: Reading<HeadingAndSpeed>;
	/** Pressure altitude, ft, and where it was heard. */
	altitude: { feet: number; from: string } | null;
	/** Where the declination is looked up: the aircraft's own ADS-B position if known. */
	position: { lat: number; lon: number; from: 'ADS-B' | 'receiver' } | null;
}

export interface WindResult {
	/** Degrees east, at `inputs.position`. */
	declination: number;
	/** 6,0's magnetic heading + declination. */
	trueHeading: number;
	ground: Vector;
	air: Vector;
	wind: Wind;
	/** What the rounding of the four inputs allows: speed min/max (kt), direction ± (°). */
	speedRange: [number, number];
	directionSpread: number;
}

export interface TemperatureResult {
	kelvin: number;
	/** TAS / Mach, kt: the step in between. */
	speedOfSound: number;
	/** What the rounding of TAS and Mach allows, K. */
	range: [number, number];
}

export interface Observation {
	icao: string;
	/** When the later of the two replies arrived (wall clock, ms). */
	rx: number;
	/** Time between the two replies, ms. */
	skewMs: number;
	inputs: Inputs;
	/** null if an input is missing. Computed even when it isn't trusted (see windProblem). */
	wind: WindResult | null;
	/** Why the wind can't be computed or trusted; null if it's good. */
	windProblem: string | null;
	temperature: TemperatureResult | null;
	temperatureProblem: string | null;
}

export function observe(icao: string, inputs: Inputs): Observation {
	const { trackAndTurn: a, headingAndSpeed: b } = inputs;
	const skewMs = Math.abs(a.t - b.t);
	const tooFar =
		skewMs > MAX_SKEW_MS
			? `5,0 and 6,0 are ${(skewMs / 1000).toFixed(1)} s apart (at most ${MAX_SKEW_MS / 1000} s)`
			: null;

	const { groundSpeed, track, tas, roll, trackRate } = a.value;
	const { heading, mach } = b.value;

	const missing = (what: [string, unknown][]) =>
		what.filter(([, v]) => v === null).map(([name]) => name);

	// Wind.
	let wind: WindResult | null = null;
	let windProblem: string | null;
	const windMissing = missing([
		['5,0 ground speed', groundSpeed],
		['5,0 track', track],
		['5,0 true airspeed', tas],
		['6,0 heading', heading]
	]);
	if (windMissing.length > 0) windProblem = `no ${windMissing.join(', ')}`;
	else if (!inputs.position) windProblem = 'no position to look up the magnetic declination';
	else {
		const decl = declination(
			inputs.position.lat,
			inputs.position.lon,
			inputs.altitude?.feet ?? 0,
			Math.max(a.rx, b.rx)
		);
		wind = windResult(groundSpeed!, track!, tas!, heading!, decl);
		windProblem = tooFar ?? turning(roll, trackRate, tas!);
	}

	// Temperature.
	let temperature: TemperatureResult | null = null;
	let temperatureProblem: string | null;
	const tMissing = missing([
		['5,0 true airspeed', tas],
		['6,0 Mach', mach]
	]);
	if (tMissing.length > 0) temperatureProblem = `no ${tMissing.join(', ')}`;
	else if (mach! <= STEP.mach) temperatureProblem = `Mach ${mach!.toFixed(3)} is too small`;
	else {
		temperature = temperatureResult(tas!, mach!);
		temperatureProblem = tooFar;
	}

	return {
		icao,
		rx: Math.max(a.rx, b.rx),
		skewMs,
		inputs,
		wind,
		windProblem,
		temperature,
		temperatureProblem
	};
}

/** Why the aircraft counts as turning, or null. Roll if 5,0 has it, else the track rate. */
function turning(roll: number | null, trackRate: number | null, tas: number): string | null {
	if (roll !== null) {
		return Math.abs(roll) > MAX_ROLL
			? `turning: banked ${Math.abs(roll).toFixed(1)}° (at most ${MAX_ROLL}°)`
			: null;
	}
	if (trackRate !== null) {
		const limit = turnRate(MAX_ROLL, tas);
		return Math.abs(trackRate) > limit
			? `turning: ${Math.abs(trackRate).toFixed(2)}°/s (at most ${limit.toFixed(2)}°/s, ${MAX_ROLL}° of bank)`
			: null;
	}
	return "5,0 has neither roll angle nor track rate: can't tell if it's turning";
}

function windResult(
	groundSpeed: number,
	track: number,
	tas: number,
	magneticHeading: number,
	decl: number
): WindResult {
	const trueHeading = normalise(magneticHeading + decl);
	const wind = windTriangle({ speed: groundSpeed, track }, { speed: tas, heading: trueHeading });

	// Every combination of the four inputs at the ends of their rounding steps.
	let min = Infinity;
	let max = -Infinity;
	let spread = 0;
	const s = STEP.speed / 2;
	const d = STEP.angle / 2;
	for (const gs of [groundSpeed - s, groundSpeed + s])
		for (const trk of [track - d, track + d])
			for (const v of [tas - s, tas + s])
				for (const hdg of [trueHeading - d, trueHeading + d]) {
					const w = windTriangle({ speed: gs, track: trk }, { speed: v, heading: hdg });
					min = Math.min(min, w.speed);
					max = Math.max(max, w.speed);
					spread = Math.max(spread, Math.abs(angleDifference(wind.direction, w.direction)));
				}

	return {
		declination: decl,
		trueHeading,
		ground: toVector(groundSpeed, track),
		air: toVector(tas, trueHeading),
		wind,
		speedRange: [min, max],
		directionSpread: spread
	};
}

function temperatureResult(tas: number, mach: number): TemperatureResult {
	const s = STEP.speed / 2;
	const m = STEP.mach / 2;
	return {
		kelvin: temperatureFromMach(tas, mach),
		speedOfSound: tas / mach,
		// Coldest: slowest TAS at the highest Mach; warmest the other way round.
		range: [temperatureFromMach(tas - s, mach + m), temperatureFromMach(tas + s, mach - m)]
	};
}
