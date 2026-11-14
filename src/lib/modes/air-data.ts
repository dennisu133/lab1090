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

/** Sea-level pressure (Pa), temperature (K) and speed of sound (kt) in the standard atmosphere. */
const P0 = 101_325;
export const T0 = 288.15;
export const A0 = 661.4786;

/** Static pressure at a pressure altitude, Pa (ISA, valid up to 65,000 ft). */
export function staticPressure(altitudeFt: number): number {
	const h = altitudeFt * 0.3048;
	if (h <= 11_000) return P0 * (1 - (0.0065 * h) / 288.15) ** 5.255_88;
	// Above 11 km (36,089 ft) the temperature stays at −56.5 °C: pressure falls exponentially.
	return 22_632.06 * Math.exp(-(h - 11_000) / 6341.62);
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
