import { CprPairs, decodeLocal, type LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat, fromHex, payload, signalDbfs, typeCode } from '#lib/modes/frame.ts';
import { airbornePosition } from '#lib/modes/position.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import type { RawUpdate, ReceiverCounts, WireFrame } from '#lib/receiver-types.ts';
import { describe, type Field, type Located } from '#lib/describe/frame.ts';

export interface FeedFrame extends WireFrame {
	df: number;
	tc: number | null;
	dbfs: number;
	/** Everything decoded from the frame, for the Content column. */
	fields: Field[];
}

export interface Rates {
	total: number;
	byDf: Record<number, number>;
	byTc: Record<number, number>;
	byVerdict: Record<string, number>;
}

const MAX_FRAMES = 1000;
const RATE_WINDOW_MS = 10_000;

/**
 * /raw's view of the live stream: every frame, decoded, plus message rates. Rates are
 * computed here from how the server's running totals change over the last 10 s.
 */
export class RawStream extends LiveFeed<FeedFrame> {
	rates = $state.raw<Rates>({ total: 0, byDf: {}, byTc: {}, byVerdict: {} });

	#samples: { t: number; counts: ReceiverCounts }[] = [];
	/** Each aircraft's latest even and odd position, for global CPR decoding. */
	#pairs = new CprPairs();

	/** REFERENCE_POINT from the server, if set (for local CPR decoding). */
	#reference: () => LatLon | null;

	constructor(reference: () => LatLon | null) {
		super(MAX_FRAMES);
		this.#reference = reference;
	}

	/** Newest first. */
	get frames(): FeedFrame[] {
		return this.items;
	}

	protected reset(): void {
		this.#samples = []; // the totals start over: so does the rate window
	}

	protected process(frames: WireFrame[], update: RawUpdate): FeedFrame[] {
		this.#updateRates(update.counts);
		if (frames.length === 0) return [];
		// In arrival order: pairing depends on it.
		const decorated = frames.map((f) => this.#decorate(f));
		this.#pairs.prune(frames.at(-1)!.rx); // the server's clock, like the frames'
		return decorated;
	}

	#updateRates(counts: ReceiverCounts): void {
		const now = performance.now();
		this.#samples.push({ t: now, counts });
		while (this.#samples.length > 2 && now - this.#samples[0].t > RATE_WINDOW_MS)
			this.#samples.shift();

		const oldest = this.#samples[0];
		const seconds = (now - oldest.t) / 1000;
		if (seconds < 1) return; // too short a window to say anything
		const per = (a: Record<string, number>, b: Record<string, number>) =>
			Object.fromEntries(Object.keys(a).map((k) => [k, ((a[k] ?? 0) - (b[k] ?? 0)) / seconds]));
		this.rates = {
			total: (counts.total - oldest.counts.total) / seconds,
			byDf: per(counts.byDf, oldest.counts.byDf),
			byTc: per(counts.byTc, oldest.counts.byTc),
			byVerdict: per(counts.byVerdict, oldest.counts.byVerdict)
		};
	}

	#decorate(f: WireFrame): FeedFrame {
		const data = fromHex(f.hex);
		return {
			...f,
			df: downlinkFormat(data),
			tc: typeCode(data),
			fields: describe(data, this.#locate(data, f)),
			dbfs: signalDbfs(f.sig)
		};
	}

	/**
	 * Airborne positions (ADS-B, or the copy in a DF16 reply): decode locally with the
	 * reference point, and globally if the same aircraft sent one from the other grid recently.
	 */
	#locate(data: Uint8Array, f: WireFrame): Located | null {
		const df = downlinkFormat(data);
		const position = df === 17 || df === 16 ? airbornePosition(payload(data)!) : null;
		if (!position?.cpr) return null;
		const reference = this.#reference();
		// Only pair checked ADS-B: DF16's address comes from the parity and could be wrong.
		const pairable = df === 17 && f.addr?.verdict === 'valid';
		return {
			reference,
			local: reference ? decodeLocal(position.cpr, reference) : null,
			global: pairable ? this.#pairs.add(f.addr!.icao, position.cpr, f.rx) : null
		};
	}
}
