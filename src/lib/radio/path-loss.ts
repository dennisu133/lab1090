/**
 * Signal against distance. In free space a radio wave spreads over a sphere: its power falls
 * with the square of the distance, its amplitude with the distance itself. So twice as far is
 * 6 dB weaker, ten times as far 20 dB:
 *
 *   signal (dBFS) = C − 20·log₁₀(distance)
 *
 * C depends on the transmitter (Mode S transponders send 125 to 500 W, 6 dB apart), the
 * antennas at both ends and the gain, so it's fitted: the median of signal + 20·log₁₀(d)
 * over the points (the median, so the many weak outliers don't pull it). What's left over
 * is the interesting part: the antennas' patterns (a vertical antenna hears little straight
 * up), the building in the way, the ground reflection.
 *
 * TODO: check it against real traffic. Does the line fit? Aircraft high overhead should sit
 * below it. Is the distance where it meets the noise plausible next to the farthest aircraft
 * heard (266 km in fixtures/local/capture-1h.beast)? Our signal is pulse amplitude, 3 dB above
 * readsb's for the same message.
 */

export interface SignalPoint {
	/** When, ms since epoch (the server's clock). */
	t: number;
	icao: string;
	/** Distance from the antenna along the line of sight (height included), km. */
	km: number;
	/** Signal level, dBFS. */
	dbfs: number;
	/** Elevation angle seen from the antenna, degrees; null without an altitude. */
	elevation: number | null;
}

/** C: the free-space line's level at 1 km, dBFS; null without points. */
export function freeSpaceLevel(points: readonly SignalPoint[]): number | null {
	const values = points.filter((p) => p.km > 0).map((p) => p.dbfs + 20 * Math.log10(p.km));
	if (values.length === 0) return null;
	values.sort((a, b) => a - b);
	const mid = values.length >> 1;
	return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** The free-space line at a distance, dBFS. */
export function freeSpace(level: number, km: number): number {
	return level - 20 * Math.log10(km);
}
