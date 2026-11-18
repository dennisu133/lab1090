/**
 * How an aircraft stands in the antenna's sky: the elevation angle (how far above the
 * horizontal it is seen) and the radio horizon (how far away it can be seen at all).
 *
 * Radio at 1090 MHz bends slightly downwards in the normal atmosphere, because the air gets
 * thinner with height and the refractive index drops. The usual way to account for it is to
 * pretend the Earth is larger and the rays straight: 4/3 of the real radius (ITU-R P.834;
 * Skolnik, _Introduction to Radar Systems_, ch. 8). On that Earth, a point at distance d
 * along the ground lies d²/(2R') below the antenna's horizontal plane (the parabola that
 * approximates the circle for d ≪ R'), and
 *
 *     elevation = atan((h_aircraft − h_antenna − d²/2R') / d)
 *     horizon   = √(2R'·h_antenna) + √(2R'·h_aircraft)  ≈  4.12 (√h_antenna + √h_aircraft) km, h in m
 *
 * The horizon is the distance at which the line of sight just grazes the Earth: one term
 * for each end. FL350 (10,668 m) gives 425 km; a 10 m antenna adds 13 km.
 *
 * Heights are above sea level. An aircraft's barometric altitude isn't its true height (it
 * follows the pressure, so it can be a few hundred feet off in warm or cold air), which moves
 * the elevation by less than 0.1° beyond 50 km: well below what the coverage can show.
 */
import { FT } from '#lib/units.ts';

/** The 4/3 Earth's radius, km: the real mean radius 6371 km × 4/3. */
export const EFFECTIVE_EARTH_KM = (6371 * 4) / 3;

const FT_TO_KM = FT / 1000;
const DEG = 180 / Math.PI;

/**
 * Degrees above the antenna's horizontal at which something `heightKm` above sea level and
 * `distanceKm` away along the ground is seen, by an antenna `antennaKm` above sea level.
 */
export function elevationAngle(distanceKm: number, heightKm: number, antennaKm = 0): number {
	const drop = (distanceKm * distanceKm) / (2 * EFFECTIVE_EARTH_KM);
	return Math.atan2(heightKm - antennaKm - drop, distanceKm) * DEG;
}

/** The same for an aircraft at a barometric altitude in feet. */
export function aircraftElevation(distanceKm: number, altitudeFt: number, antennaKm = 0): number {
	return elevationAngle(distanceKm, altitudeFt * FT_TO_KM, antennaKm);
}

/** One end's share of the radio horizon, km: √(2R'h). */
function reach(heightKm: number): number {
	return Math.sqrt(2 * EFFECTIVE_EARTH_KM * Math.max(heightKm, 0));
}

/**
 * The radio horizon, km: the farthest an aircraft at `altitudeFt` can be and still have a
 * line of sight to an antenna `antennaKm` above sea level, over a smooth Earth.
 */
export function radioHorizon(altitudeFt: number, antennaKm = 0): number {
	return reach(altitudeFt * FT_TO_KM) + reach(antennaKm);
}
