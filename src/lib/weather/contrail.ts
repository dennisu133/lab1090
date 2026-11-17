/**
 * Contrails: whether an engine's exhaust condenses into a trail at a given temperature and
 * pressure, by the Schmidt–Appleman criterion (Schmidt 1941, Appleman 1953; in the form of
 * Schumann 1996, "On conditions for contrail formation from aircraft exhausts",
 * Meteorologische Zeitschrift 5, 4–23).
 *
 * Burning kerosene makes water vapour and heat. Behind the engine the hot, moist exhaust
 * mixes with the cold ambient air; on the way from one to the other, vapour pressure and
 * temperature change in the same proportion, so in a (temperature, vapour pressure) diagram
 * the mixture moves along a straight line, the mixing line, of slope
 *
 *   G = EI_H2O · c_p · p / (ε · Q · (1 − η))      [Pa/K]
 *
 * EI_H2O: water per kg of fuel, c_p: heat capacity of air, p: ambient pressure, ε: molar
 * mass of water over air's, Q: the fuel's combustion heat, η: the share of it that goes
 * into pushing the aircraft (overall propulsion efficiency) instead of heating the plume.
 * If the line crosses the saturation curve over liquid water (it bulges upward, steeper as
 * it warms), the mixture is supersaturated for a moment: droplets form and freeze. That's
 * the contrail, a cloud made by the engine.
 *
 * The line just touches the curve where the curve's slope is G: at T_LM, the warmest air
 * a contrail can form in, and then only if that air is saturated (100 % relative humidity
 * over water). Colder air needs less moisture; at T_LM − e_w(T_LM) / G even bone-dry air
 * gives one. In between, the humidity decides: the ambient point must lie on or above the
 * tangent through (T_LM, e_w(T_LM)).
 *
 * Humidity at cruise level is almost never known here (register 4,4 is rare), so the page
 * shows both ends: above the 100 % threshold (warmer) never, below the 0 % one always.
 *
 * Whether the contrail *persists* is another question: its ice crystals survive only where
 * the air is saturated over ice. The air we can't see into, so we say so.
 *
 * Shared by server and browser; no state here.
 */

/** Water vapour per kg of kerosene burnt, kg/kg (Schumann 1996). */
export const EI_H2O = 1.25;
/** Kerosene's specific combustion heat, J/kg (Schumann 1996). */
export const Q = 43e6;
/** Air's specific heat at constant pressure, J/(kg K). */
export const CP = 1004;
/** Molar mass of water / of dry air. */
export const EPSILON = 0.622;
/**
 * Overall propulsion efficiency. Schumann (2000) gives ~0.3 for the engines of the 1990s,
 * up to ~0.4 for modern high-bypass ones: more of the heat leaves as thrust, the plume is
 * cooler, and contrails form in warmer air. One value for all, since we can't tell the
 * engine; ETA_MODERN is for /weather's "how much would it move".
 */
export const ETA = 0.3;
export const ETA_MODERN = 0.4;

/** The mixing line's slope G, Pa/K, at a static pressure (Pa). */
export function mixingLineSlope(pressure: number, eta = ETA): number {
	return (EI_H2O * CP * pressure) / (EPSILON * Q * (1 - eta));
}

/**
 * Saturation vapour pressure over liquid water, Pa (Sonntag 1994, the formula Schumann
 * 1996 uses): valid down to −100 °C for supercooled water.
 */
export function saturationOverWater(kelvin: number): number {
	const T = kelvin;
	return (
		100 *
		Math.exp(
			-6096.9385 / T + 16.635794 - 2.711193e-2 * T + 1.673952e-5 * T * T + 2.433502 * Math.log(T)
		)
	);
}

/** Its slope, Pa/K: the derivative of the formula above. */
function saturationSlope(kelvin: number): number {
	const T = kelvin;
	return (
		saturationOverWater(T) *
		(6096.9385 / (T * T) - 2.711193e-2 + 2 * 1.673952e-5 * T + 2.433502 / T)
	);
}

/** Saturation vapour pressure over ice, Pa (Sonntag 1994): for whether a contrail persists. */
export function saturationOverIce(kelvin: number): number {
	const T = kelvin;
	return (
		100 *
		Math.exp(
			-6024.5282 / T + 24.7219 + 1.0613868e-2 * T - 1.3198825e-5 * T * T - 0.49382577 * Math.log(T)
		)
	);
}

export interface Thresholds {
	/** The mixing line's slope, Pa/K. */
	slope: number;
	/** T_LM, K: warmer than this, no contrail even in saturated air (100 % RH over water). */
	saturated: number;
	/** K: colder than this, a contrail even in perfectly dry air (0 % RH). */
	dry: number;
}

/** Both thresholds at a static pressure (Pa). */
export function thresholds(pressure: number, eta = ETA): Thresholds {
	const slope = mixingLineSlope(pressure, eta);
	// Newton's method on e_w'(T) = G; e_w' grows monotonically, so from 230 K it converges
	// in a few steps for any cruise pressure.
	let T = 230;
	for (let i = 0; i < 30; i++) {
		const step =
			(saturationSlope(T) - slope) / ((saturationSlope(T + 0.01) - saturationSlope(T)) / 0.01);
		T -= step;
		if (Math.abs(step) < 1e-6) break;
	}
	return { slope, saturated: T, dry: T - saturationOverWater(T) / slope };
}

/**
 * Schumann's (1996, eq. 31) fit for T_LM, K: what thresholds() solves exactly. Only for the
 * tests; G in Pa/K.
 */
export function schumannFit(slope: number): number {
	const x = Math.log(slope - 0.053);
	return 273.15 - 46.46 + 9.43 * x + 0.72 * x * x;
}

export type Verdict = 'always' | 'humid' | 'never';

export interface Contrail {
	verdict: Verdict;
	thresholds: Thresholds;
	/**
	 * The relative humidity over water the air needs for a contrail, 0–1: 0 when `always`,
	 * between 0 and 1 when `humid`, null when `never`.
	 */
	humidityNeeded: number | null;
	/** The humidity over water at which the air is saturated over ice, 0–1 (e_i / e_w). */
	iceSaturation: number;
}

/**
 * At an ambient temperature (K) and static pressure (Pa). The humidity needed puts the
 * ambient point on the tangent: U · e_w(T) = e_w(T_LM) − G · (T_LM − T).
 */
export function contrail(kelvin: number, pressure: number, eta = ETA): Contrail {
	const t = thresholds(pressure, eta);
	const iceSaturation = saturationOverIce(kelvin) / saturationOverWater(kelvin);
	if (kelvin > t.saturated)
		return { verdict: 'never', thresholds: t, humidityNeeded: null, iceSaturation };
	const needed =
		(saturationOverWater(t.saturated) - t.slope * (t.saturated - kelvin)) /
		saturationOverWater(kelvin);
	return needed <= 0
		? { verdict: 'always', thresholds: t, humidityNeeded: 0, iceSaturation }
		: { verdict: 'humid', thresholds: t, humidityNeeded: needed, iceSaturation };
}

/** Relative humidity over water (0–1) from a mixing ratio (kg/kg), pressure (Pa), temperature (K). */
export function humidityOf(mixingRatio: number, pressure: number, kelvin: number): number {
	const e = (mixingRatio * pressure) / (EPSILON + mixingRatio);
	return e / saturationOverWater(kelvin);
}

/**
 * How far off a measured temperature may be, K. Against Lindenberg's balloons the capture's
 * aircraft read 2 K cold on average, one 7 K (sounding.test.ts), and near the thresholds
 * 1 K moves the humidity needed by 20–25 points. So a yes or no only counts if it still
 * holds this far either way; a layer's mean of several aircraft is better than one, but
 * gets the same margin.
 */
export const TEMPERATURE_MARGIN = 2;

export interface ContrailRange {
	/** `always` or `never` only if that holds TEMPERATURE_MARGIN either way; else `humid`. */
	verdict: Verdict;
	/** At the temperature as measured. */
	at: Contrail;
	/** The same air TEMPERATURE_MARGIN colder and warmer: the humidity needed runs between. */
	colder: Contrail;
	warmer: Contrail;
}

export function contrailRange(
	kelvin: number,
	pressure: number,
	eta = ETA,
	margin = TEMPERATURE_MARGIN
): ContrailRange {
	const colder = contrail(kelvin - margin, pressure, eta);
	const warmer = contrail(kelvin + margin, pressure, eta);
	const verdict =
		warmer.verdict === 'always' ? 'always' : colder.verdict === 'never' ? 'never' : 'humid';
	return { verdict, at: contrail(kelvin, pressure, eta), colder, warmer };
}
