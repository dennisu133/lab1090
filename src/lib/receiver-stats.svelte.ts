import type { ReceiverCounts, StreamUpdate } from '#lib/receiver-types.ts';
import { perSecond, RateWindow } from '#lib/rate-window.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';

export interface Rates {
	total: number;
	byDf: Record<number, number>;
	byTc: Record<number, number>;
	byVerdict: Record<string, number>;
}

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

	#window = new RateWindow<ReceiverCounts>();

	/** A new server run: the totals start over, so does the rate window. */
	reset(): void {
		this.#window.clear();
		this.rates = NO_RATES;
	}

	receive(update: StreamUpdate): void {
		this.since = update.since;
		this.counts = update.counts;

		const counts = update.counts;
		const window = this.#window.add(performance.now(), counts);
		if (!window) return;
		const { then, seconds } = window;
		this.rates = {
			total: (counts.total - then.total) / seconds,
			byDf: perSecond(counts.byDf, then.byDf, seconds),
			byTc: perSecond(counts.byTc, then.byTc, seconds),
			byVerdict: perSecond(counts.byVerdict, then.byVerdict, seconds)
		};
	}
}
