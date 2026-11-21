/**
 * Signal against distance. In free space a radio wave spreads over a sphere: its power falls
 * with the square of the distance, its amplitude with the distance itself. So twice as far is
 * 6 dB weaker, ten times as far 20 dB:
 *
 *   signal (dBFS) = C − 20·log₁₀(distance)
 *
 * C depends on the transmitter (Mode S transponders send at least 70 W, or 125 W above
 * 15,000 ft or 175 kt, and at most 500 W: Annex 10 Vol IV 3.1.2.10.2), the
 * antennas at both ends and the gain, so it's fitted: the median of signal + 20·log₁₀(d)
 * over the points (the median, so the many weak outliers don't pull it). What's left over
 * is the interesting part: the antennas' patterns (a vertical antenna hears little straight
 * up), the building in the way, the ground reflection.
 *
 * Checked on 30 minutes of afternoon traffic (21 Nov 2026, 1,615 points from 47 aircraft):
 * above 20° elevation 85 of 101 points sit below the line (median −9.1 dB), 5–20° on it
 * (−0.1), below 5° just above (+0.6). The dots' own slope is −10 dB per decade, not −20:
 * close aircraft are high up (the antenna's null) and far ones are only heard when strong.
 * It met the noise at ~540 km, the farthest aircraft was 232 km: messages are rarely read
 * less than ~10 dB above the noise (1 % of them), a third of that distance on the line.
 * Our signal is pulse amplitude, about 4.5 dB above readsb's for the same message.
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
