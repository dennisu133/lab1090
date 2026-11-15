import type { FrameTraits } from '#lib/frame-query.ts';
import { signalBucket } from '#lib/modes/frame.ts';
import type { ReceiverCounts } from '#lib/receiver-types.ts';

/**
 * The server's running totals: every Mode S frame since it started, by downlink format, by
 * type code (DF17 only, like the /frames table), by signal level and by parity verdict.
 * They go out with every stream update; the browser turns them into rates (ReceiverStats).
 */
export class FrameCounts {
	readonly counts: ReceiverCounts = { total: 0, byDf: {}, byTc: {}, bySignal: {}, byVerdict: {} };

	/** One frame: what it is, and its signal level in dBFS. */
	add({ df, tc, verdict }: FrameTraits, dbfs: number): void {
		const c = this.counts;
		c.total++;
		increment(c.byDf, df);
		if (tc !== null && df === 17) increment(c.byTc, tc);
		increment(c.bySignal, signalBucket(dbfs));
		if (verdict) increment(c.byVerdict, verdict);
	}
}

function increment<K extends string | number>(counts: Partial<Record<K, number>>, key: K): void {
	counts[key] = (counts[key] ?? 0) + 1;
}
