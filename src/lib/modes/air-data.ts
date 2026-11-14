/**
 * Airspeed physics, for checking a Comm-B heading and speed report (6,0) against itself:
 * its indicated airspeed and Mach number are two views of the same thing.
 *
 * The airspeed indicator measures the dynamic pressure qc (pitot minus static pressure).
 * Mach follows from qc and the static pressure p alone, and p follows from the pressure
 * altitude: that's what pressure altitude means. Temperature cancels out. So IAS and
 * altitude predict Mach, using the International Standard Atmosphere (ISA).
 *
 * The other way round, for /weather: true airspeed and Mach *do* depend on temperature,
 * and together they give it away (see temperatureFromMach).
 *
 * Shared by server and browser; no state here.
 */

/**
 * The International Standard Atmosphere (ISA, ICAO Doc 7488): an agreed, average
 * atmosphere that altimeters, airspeed indicators and performance tables are built on.
 * At sea level 1013.25 hPa and 15 °C; the temperature falls by 6.5 °C per km (1.98 °C per
 * 1,000 ft) up to the tropopause at 11 km (36,089 ft), then stays at −56.5 °C up to 20 km.
 */
export const P0 = 101_325; // Pa
export const T0 = 288.15; // K
export const A0 = 661.4786; // speed of sound, kt
/** Specific gas constant of dry air, J/(kg·K). */
export const R_AIR = 287.053;
/** Sea-level density, 1.225 kg/m³ (from the gas law, so it matches isaDensity(0) exactly). */
export const RHO0 = P0 / (R_AIR * T0);
/** Lapse rate (K/m), tropopause height (m) and temperature (K). */
const LAPSE = 0.0065;
const H11 = 11_000;
export const T11 = 216.65;
export const G0 = 9.806_65;
/** g / (L·R) = 5.25588: how pressure follows temperature in the troposphere. */
const EXPONENT = G0 / (LAPSE * R_AIR);
/** Above the tropopause pressure and density fall by e every R·T/g = 6,341.6 m. */
const SCALE_HEIGHT = (R_AIR * T11) / G0;
const RHO11 = RHO0 * (T11 / T0) ** (EXPONENT - 1);
const FT = 0.3048;

/** ISA temperature at a pressure altitude, K. */
export function isaTemperature(altitudeFt: number): number {
	return Math.max(T0 - LAPSE * altitudeFt * FT, T11);
}

/** Static pressure at a pressure altitude, Pa (ISA, valid up to 65,000 ft). */
export function staticPressure(altitudeFt: number): number {
	const h = altitudeFt * FT;
	if (h <= H11) return P0 * (isaTemperature(altitudeFt) / T0) ** EXPONENT;
	// Above 11 km (36,089 ft) the temperature stays at −56.5 °C: pressure falls exponentially.
	return P0 * (T11 / T0) ** EXPONENT * Math.exp(-(h - H11) / SCALE_HEIGHT);
}

/**
 * Pressure altitude of a static pressure (Pa), ft: the inverse of staticPressure. E.g. a
 * sea-level pressure (QNH) of 1023 hPa is at −265 ft: an altimeter set to standard
 * (1013.25) reads −265 ft on a sea-level runway that day.
 */
export function pressureAltitude(pascal: number): number {
	const p11 = staticPressure(H11 / FT);
	if (pascal >= p11) return ((T0 / LAPSE) * (1 - (pascal / P0) ** (1 / EXPONENT))) / FT;
	return (H11 + SCALE_HEIGHT * Math.log(p11 / pascal)) / FT;
}

/**
 * Mach number from calibrated airspeed (≈ IAS) at a pressure altitude. Subsonic only.
 * E.g. 254 kt at 38,000 ft is Mach 0.80: the same airspeed indicator reading means a much
 * higher true speed in the thin air up there.
 */
export function machFromCas(casKt: number, altitudeFt: number): number {
	const qc = P0 * ((1 + 0.2 * (casKt / A0) ** 2) ** 3.5 - 1);
	const p = staticPressure(altitudeFt);
	return Math.sqrt(5 * ((qc / p + 1) ** (2 / 7) - 1));
}

/**
 * Speed of sound at a temperature, kt. Sound is a pressure wave carried by the air
 * molecules, so it travels as fast as they move: a = √(γ·R·T) with γ = 1.4 for air and R its
 * gas constant. Only the temperature varies, so a = a₀ · √(T / T₀).
 */
export function speedOfSound(kelvin: number): number {
	return A0 * Math.sqrt(kelvin / T0);
}

/**
 * Static air temperature (K) from true airspeed (kt) and Mach number.
 *
 * Mach is TAS divided by the local speed of sound, so a = TAS / M, and the speed of sound
 * depends only on the temperature (speedOfSound, solved for T):
 *
 *   T = T₀ · (TAS / (M · a₀))²
 *
 * This works because the aircraft's air data computer did the opposite: it measured the
 * temperature (with a probe outside) and the pressures (pitot and static ports), worked
 * out Mach from the pressures, and TAS = M · a(T). Registers 5,0 (TAS) and 6,0 (Mach)
 * hand us both results, so we can undo the last step. E.g. 432 kt at Mach 0.744: a =
 * 580.6 kt, T = 222.0 K = −51.1 °C.
 */
export function temperatureFromMach(tasKt: number, mach: number): number {
	return T0 * (tasKt / (mach * A0)) ** 2;
}

/**
 * Total air temperature, K: what a temperature probe on the outside of the aircraft reads.
 * The air hitting it is brought to a stop, and its kinetic energy turns into heat:
 *
 *   TAT = SAT · (1 + (γ − 1)/2 · M²) = SAT · (1 + 0.2 M²)
 *
 * At Mach 0.8 that's 13 % warmer in kelvin: about +28 °C at cruise. Air data computers go
 * the other way (they measure TAT and work out SAT). Real probes recover slightly less
 * than all the heat (a recovery factor of 0.97–1); this is the ideal value.
 */
export function totalTemperature(staticKelvin: number, mach: number): number {
	return staticKelvin * (1 + 0.2 * mach ** 2);
}

/** Air density, kg/m³, from pressure (Pa) and temperature (K): the ideal gas law ρ = p / (R·T). */
export function airDensity(pascal: number, kelvin: number): number {
	return pascal / (R_AIR * kelvin);
}

/** ISA density at a pressure altitude, kg/m³. */
export function isaDensity(altitudeFt: number): number {
	return airDensity(staticPressure(altitudeFt), isaTemperature(altitudeFt));
}

/**
 * Density altitude, ft: the altitude in the standard atmosphere where the air is this
 * dense. Wings and engines feel density, not pressure: in air colder than standard they
 * perform as if lower, in warm air as if higher (why hot airports need longer runways).
 *
 * Inverts isaDensity: in the troposphere ρ/ρ₀ = (T/T₀)^4.256, above it ρ falls by e every
 * 6,341.6 m.
 */
export function densityAltitude(rho: number): number {
	if (rho >= RHO11) {
		const theta = (rho / RHO0) ** (1 / (EXPONENT - 1));
		return (T0 * (1 - theta)) / LAPSE / FT;
	}
	return (H11 - SCALE_HEIGHT * Math.log(rho / RHO11)) / FT;
}
