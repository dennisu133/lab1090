/**
 * Message rates from running totals: the server counts every frame (and the demodulator
 * every candidate) since it started, and a rate is how much a total grew over the last
 * WINDOW_MS, per second. The navigation bar, /frames, /comm-b and /receiver all work them
 * out this way.
 *
 * From the totals rather than from the frames seen: the totals are right from the first
 * update, whatever this tab saw (after a reconnect it skips the frames it already has).
 *
 * Ten seconds: long enough that a rate doesn't jump with every 250-ms batch (a few messages
 * more or less), short enough to follow the traffic. Under a second there is nothing to
 * say yet (one batch).
 */

export const WINDOW_MS = 10_000;
const MIN_MS = 1_000;

export class RateWindow<T> {
	#samples: { t: number; totals: T }[] = [];
	#windowMs: number;

	constructor(windowMs = WINDOW_MS) {
		this.#windowMs = windowMs;
	}

	/** Start over: the totals did (a new server run, a new source). */
	clear(): void {
		this.#samples = [];
	}

	/**
	 * The totals at `t` (ms, any clock, never going back). Returns the oldest totals still in
	 * the window and the seconds since, to divide the growth by; null while the window is
	 * shorter than a second.
	 */
	add(t: number, totals: T): { then: T; seconds: number } | null {
		this.#samples.push({ t, totals });
		// Two stay whatever their age: when updates stop for a while, the next rate covers
		// the gap rather than nothing.
		while (this.#samples.length > 2 && t - this.#samples[0].t > this.#windowMs) {
			this.#samples.shift();
		}
		const oldest = this.#samples[0];
		const ms = t - oldest.t;
		return ms < MIN_MS ? null : { then: oldest.totals, seconds: ms / 1000 };
	}
}

/** Per second, key by key: how much each of `now`'s totals grew since `then` (absent: 0). */
export function perSecond<K extends string | number>(
	now: Partial<Record<K, number>>,
	then: Partial<Record<K, number>>,
	seconds: number
): Record<K, number> {
	const rates = {} as Record<K, number>;
	for (const key of Object.keys(now) as K[]) {
		rates[key] = ((now[key] ?? 0) - (then[key] ?? 0)) / seconds;
	}
	return rates;
}
