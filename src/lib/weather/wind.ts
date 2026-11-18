/**
 * The wind triangle: wind = ground velocity − air velocity.
 *
 * An aircraft moves through the air (true airspeed TAS, in the direction its nose points:
 * the heading), and the air itself moves over the ground (the wind). What the aircraft
 * makes over the ground (ground speed GS along the track) is the sum of the two:
 *
 *   ground = air + wind   →   wind = ground − air
 *
 *              ground (GS, track)
 *   origin ●───────────────────────▶
 *            ╲                  ↗
 *    air (TAS, ╲            wind
 *    heading)   ╲───────▶
 *
 * Pilots solve this the other way round on every flight (which heading to fly to make
 * good a track in a known wind). Registers 5,0 (GS, track, TAS) and 6,0 (heading) give
 * all three other sides, so a receiver on the ground can do it backwards.
 *
 * Directions are true (relative to geographic north), clockwise, in degrees. Vectors
 * point where things move *to*; wind direction is reported where it blows *from*, as
 * in every weather report (a westerly wind, 270°, blows towards the east).
 *
 * Pure, no state here.
 */

/** A velocity as north and east components, kt. */
export interface Vector {
	north: number;
	east: number;
}

export interface Wind {
	/** kt */
	speed: number;
	/** Where it blows from, true, 0–360°. */
	direction: number;
	/** Where the air moves to, kt. */
	vector: Vector;
}

const RAD = Math.PI / 180;

/** Normalise an angle to 0–360°. */
export const normalise = (degrees: number) => ((degrees % 360) + 360) % 360;

/** Smallest difference between two directions, −180 to +180° (b − a). */
export function angleDifference(a: number, b: number): number {
	return normalise(b - a + 180) - 180;
}

/** A speed in a direction (degrees clockwise from north) as north/east components. */
export function toVector(speed: number, direction: number): Vector {
	return { north: speed * Math.cos(direction * RAD), east: speed * Math.sin(direction * RAD) };
}

/** The direction a vector points to, 0–360°. atan2(east, north): clockwise from north. */
export function directionOf(v: Vector): number {
	return normalise(Math.atan2(v.east, v.north) / RAD);
}

export function speedOf(v: Vector): number {
	return Math.hypot(v.north, v.east);
}

/**
 * Wind from the ground vector (GS along the true track) and the air vector (TAS along the
 * true heading).
 */
export function windTriangle(
	ground: { speed: number; track: number },
	air: { speed: number; heading: number }
): Wind {
	const g = toVector(ground.speed, ground.track);
	const a = toVector(air.speed, air.heading);
	const vector = { north: g.north - a.north, east: g.east - a.east };
	return { speed: speedOf(vector), direction: normalise(directionOf(vector) + 180), vector };
}

/** The wind that moves the air along this vector (kt): reported where it blows from. */
export function windOf(vector: Vector): Wind {
	return { speed: speedOf(vector), direction: normalise(directionOf(vector) + 180), vector };
}

/** Mean wind of several, as vectors: averaging 350° and 10° must give 0°, not 180°. */
export function meanWind(winds: Wind[]): Wind | null {
	if (winds.length === 0) return null;
	return windOf({
		north: winds.reduce((s, w) => s + w.vector.north, 0) / winds.length,
		east: winds.reduce((s, w) => s + w.vector.east, 0) / winds.length
	});
}

/**
 * The wind as the aircraft feels it: split along its heading and across it.
 *
 * - tailwind: the part blowing in the direction the nose points (negative = headwind).
 *   It's what makes the ground speed differ from the airspeed.
 * - crosswind: the part across, positive when it pushes the aircraft to the right (so it
 *   comes from the left).
 * - drift: the angle between where the nose points and where the aircraft goes (track −
 *   heading, positive = drifting right). The crosswind causes it: tan(drift) =
 *   crosswind / (TAS + tailwind).
 *
 * Pilots work these out before every take-off and landing (the runway's crosswind limit)
 * and for every leg of a flight plan (the tailwind changes the flight time).
 */
export interface Components {
	tailwind: number;
	crosswind: number;
	drift: number;
}

export function components(wind: Wind, trueHeading: number, track: number): Components {
	const nose = toVector(1, trueHeading);
	const right = toVector(1, trueHeading + 90);
	const { north, east } = wind.vector;
	return {
		tailwind: north * nose.north + east * nose.east,
		crosswind: north * right.north + east * right.east,
		drift: angleDifference(trueHeading, track)
	};
}
