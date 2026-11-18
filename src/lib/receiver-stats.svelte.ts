import type { ReceiverCounts, StreamUpdate } from '#lib/receiver-types.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';

export interface Rates {
	total: number;
	byDf: Record<number, number>;
	byTc: Record<number, number>;
	byVerdict: Record<string, number>;
}

/** Rates are averaged over this window. */
const RATE_WINDOW_MS = 10_000;

const NO_RATES: Rates = { total: 0, byDf: {}, byTc: {}, byVerdict: {} };

/**
 * How busy the receiver is: the server's running counts (every Mode S frame since it
 * started, by DF, type code, signal and verdict) and the message rates worked out from them.
 * Fed by the app's StreamConnection with every update; the navigation bar shows the totals,
 * /frames the breakdown.
 *
 * The rates come from how the totals grow, not from the frames received: the counts are
 * the server's, so they're right from the first update and don't depend on which frames this
 * tab saw (after a reconnect it skips the ones it already has).
 */
export class ReceiverStats implements UpdateListener {
	counts = $state.raw<ReceiverCounts | null>(null);
	/** When the server started counting, ms since epoch. */
	since = $state.raw<number | null>(null);
	/** Per second, over the last 10 s. */
	rates = $state.raw<Rates>(NO_RATES);

	#samples: { t: number; counts: ReceiverCounts }[] = [];

	/** A new server run: the totals start over, so does the rate window. */
	reset(): void {
		this.#samples = [];
		this.rates = NO_RATES;
	}

	receive(update: StreamUpdate): void {
		this.since = update.since;
		this.counts = update.counts;

		const now = performance.now();
		this.#samples.push({ t: now, counts: update.counts });
		while (this.#samples.length > 2 && now - this.#samples[0].t > RATE_WINDOW_MS)
			this.#samples.shift();

		const oldest = this.#samples[0];
		const seconds = (now - oldest.t) / 1000;
		if (seconds < 1) return; // too short a window to say anything
		const counts = update.counts;
		const per = (a: Record<string, number>, b: Record<string, number>) =>
			Object.fromEntries(Object.keys(a).map((k) => [k, ((a[k] ?? 0) - (b[k] ?? 0)) / seconds]));
		this.rates = {
			total: (counts.total - oldest.counts.total) / seconds,
			byDf: per(counts.byDf, oldest.counts.byDf),
			byTc: per(counts.byTc, oldest.counts.byTc),
			byVerdict: per(counts.byVerdict, oldest.counts.byVerdict)
		};
	}
}
