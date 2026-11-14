/**
 * The air column below an aircraft, from the gap between its two altitudes.
 *
 * An aircraft knows its altitude twice:
 * - barometric (pressure altitude): the static pressure outside, turned into a height
 *   with the standard atmosphere (ISA). It's what it flies by; "FL350" is a pressure.
 * - GNSS height: a geometric height from the satellites.
 *
 * ADS-B airborne velocity messages (TC 19) carry the difference, GNSS − baro, in 25 ft
 * steps (DO-260B; the aircraft computes it itself, so both are from the same moment).
 *
 * Pressure altitude is only a true height if the whole column of air below is standard.
 * Two things move the real height of a pressure level:
 *
 * 1. The pressure at the bottom. If sea-level pressure (QNH) is higher than 1013.25 hPa,
 *    every pressure level is lifted by the height that extra pressure takes up at the
 *    bottom: −(pressure altitude of QNH), about 27 ft per hPa.
 * 2. The temperature of the column. Warm air is less dense, so the same pressure drop
 *    takes more height; cold air packs it into less (why altimeters over-read in the
 *    cold, and why approach charts have cold-temperature corrections). The hypsometric
 *    equation says how much: between two pressures p₁ > p₂ the thickness is
 *
 *      Δz = (R / g) · T̄ · ln(p₁ / p₂)
 *
 *    with R / g = 29.27 m/K for dry air, T̄ the mean temperature in between. A column
 *    ΔT warmer than standard throughout is thicker by (R / g) · ΔT · ln(p₁ / p₂).
 *
 * Together, with ΔT the column's mean deviation from ISA and p the pressure at the aircraft:
 *
 *   height − pressure altitude = −(pressure altitude of QNH) + (R / g) · ΔT · ln(QNH / p)
 *
 * We measure the left side and get QNH from aircraft that report it (sky.ts), so the
 * column's ΔT is what's left. It's an average over the whole column from the ground up,
 * each layer weighted by its share of ln p (roughly by height), so it's not the
 * temperature at the aircraft: in winter the cold air near the ground can make the column
 * colder than standard while the air at cruise level is warmer than standard.
 *
 * Getting the left side right takes two corrections:
 * - GNSS heights are above the WGS84 ellipsoid (DO-260B; dump1090-fa documents its alt_geom
 *   the same way), sea level is above or below it by the geoid undulation (geoid.ts). Some
 *   avionics may send heights above sea level instead; the page lets you switch.
 * - The ISA is defined in geopotential height (height scaled by how gravity weakens with
 *   it), GNSS measures geometric height. H = r · z / (r + z) with r = 6,356,766 m (ICAO
 *   Doc 7488): 59 ft less at 35,000 ft, worth 0.4 K.
 *
 * Simplifications: the ground is taken to be at sea level (the formula's ln starts at
 * QNH, not at the airfield's pressure: fine for the North German plain), the air is dry
 * (humidity makes it slightly lighter, a fraction of a kelvin near the ground), and the
 * column isn't straight below the aircraft but wherever it's been. Gravity varies with
 * latitude too (geopotential uses g₀, 9.80665 m/s², as at 45°); at 52° that's 0.06 %.
 *
 * Shared by server and browser; no state here.
 */
import { G0, R_AIR, pressureAltitude, staticPressure } from '#lib/modes/air-data.ts';

const FT = 0.3048;
/** R / g₀, ft per kelvin per unit of ln p: 96.03 ft. */
export const R_OVER_G_FT = R_AIR / G0 / FT;
/** The Earth radius the ISA's geopotential heights use, m (ICAO Doc 7488). */
const EARTH_RADIUS = 6_356_766;

/** Where GNSS heights are measured from. */
export type HeightReference = 'ellipsoid' | 'sea level';

export interface ColumnInputs {
	/** Pressure altitude, ft. */
	altitude: number;
	/** GNSS height − pressure altitude, ft, as the aircraft sends it. */
	gnssMinusBaro: number;
	/** Geoid undulation where the aircraft is, m (geoid.ts). */
	geoid: number;
}

export interface ColumnSettings {
	/** Sea-level pressure, hPa. */
	qnh: number;
	heights: HeightReference;
}

/** Every step, in ft unless noted, so the page can show the calculation. */
export interface Column {
	/** The GNSS height as sent: pressure altitude + difference. */
	gnssHeight: number;
	/** Above sea level: minus the geoid undulation, if heights are above the ellipsoid. */
	seaLevelHeight: number;
	/** Geopotential: what the ISA's heights mean. */
	geopotential: number;
	/** Geopotential height − pressure altitude: what the weather did to this level. */
	offset: number;
	/** Of that, what the sea-level pressure explains: −(pressure altitude of QNH). */
	pressurePart: number;
	/** The rest, which the column's temperature explains. */
	temperaturePart: number;
	/** Static pressure at the aircraft, Pa. */
	pressure: number;
	/** (R / g) · ln(QNH / p): how much each kelvin of column deviation lifts this level. */
	feetPerKelvin: number;
	/** The column's mean deviation from ISA, K. */
	isaDeviation: number;
}

/** Geopotential height (ft) of a geometric height above sea level (ft). */
export function geopotential(feet: number): number {
	const z = feet * FT;
	return (EARTH_RADIUS * z) / (EARTH_RADIUS + z) / FT;
}

/** How much a hectopascal of QNH above standard lifts every level: −(pressure altitude of QNH), ft. */
export function pressurePart(qnh: number): number {
	return -pressureAltitude(qnh * 100);
}

/** (R / g) · ln(QNH / p), ft per kelvin of column deviation. */
export function feetPerKelvin(altitudeFt: number, qnh: number): number {
	return R_OVER_G_FT * Math.log((qnh * 100) / staticPressure(altitudeFt));
}

export function column(inputs: ColumnInputs, settings: ColumnSettings): Column {
	const gnssHeight = inputs.altitude + inputs.gnssMinusBaro;
	const seaLevelHeight =
		settings.heights === 'ellipsoid' ? gnssHeight - inputs.geoid / FT : gnssHeight;
	const h = geopotential(seaLevelHeight);
	const offset = h - inputs.altitude;
	const fromPressure = pressurePart(settings.qnh);
	const perKelvin = feetPerKelvin(inputs.altitude, settings.qnh);
	return {
		gnssHeight,
		seaLevelHeight,
		geopotential: h,
		offset,
		pressurePart: fromPressure,
		temperaturePart: offset - fromPressure,
		pressure: staticPressure(inputs.altitude),
		feetPerKelvin: perKelvin,
		isaDeviation: (offset - fromPressure) / perKelvin
	};
}

/**
 * The offset (geopotential height − pressure altitude, ft) a column with this mean ISA
 * deviation and sea-level pressure would give at a pressure altitude: the chart's guides.
 */
export function expectedOffset(altitudeFt: number, isaDeviation: number, qnh: number): number {
	return pressurePart(qnh) + isaDeviation * feetPerKelvin(altitudeFt, qnh);
}
