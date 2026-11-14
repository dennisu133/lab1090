import {
	CprPairs,
	decodeLocal,
	decodeSurfaceGlobal,
	decodeSurfaceLocal,
	type LatLon
} from '#lib/modes/cpr.ts';
import { downlinkFormat, fromHex, payload, signalDbfs, typeCode } from '#lib/modes/frame.ts';
import { airbornePosition, surfacePosition } from '#lib/modes/position.ts';
import { esFormat } from '#lib/modes/squitter.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import { toSearchParams, type FrameQuery } from '#lib/frame-query.ts';
import type {
	FramesResponse,
	StreamUpdate,
	ReceiverCounts,
	WireFrame
} from '#lib/receiver-types.ts';
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

/** How many frames the live list keeps (stored frames come on top, see lookup). */
export const LIVE_FRAMES = 1000;
const RATE_WINDOW_MS = 10_000;

/**
 * The /frames page's view of the live stream: every frame, decoded, plus message rates. Rates are
 * computed here from how the server's running totals change over the last 10 s.
 */
export class FrameStream extends LiveFeed<FeedFrame> {
	rates = $state.raw<Rates>({ total: 0, byDf: {}, byTc: {}, byVerdict: {} });

	#samples: { t: number; counts: ReceiverCounts }[] = [];
	/** REFERENCE_POINT from the server, if set (for local CPR decoding). */
	#reference: () => LatLon | null;
	#decoder: FrameDecoder;

	constructor(reference: () => LatLon | null) {
		super(LIVE_FRAMES);
		this.#reference = reference;
		this.#decoder = new FrameDecoder(reference);
	}

	/**
	 * The latest frames the server stored for a filter (see FrameBuffers), newest first:
	 * also those that arrived before this tab opened, or have long left the live feed.
	 */
	async lookup(
		query: FrameQuery,
		signal?: AbortSignal
	): Promise<FramesResponse & { frames: FeedFrame[] }> {
		const response = await fetch(`/api/frames?${toSearchParams(query)}`, { signal });
		if (!response.ok) throw new Error(`/api/frames: ${response.status} ${await response.text()}`);
		const { since, frames }: FramesResponse = await response.json();
		// A decoder of their own, fed in arrival order: these frames are older than the live
		// ones and must not end up in the live pairing. Pairs within the batch still work.
		const decoder = new FrameDecoder(this.#reference);
		return { since, frames: frames.map((f) => decoder.decorate(f)).reverse() };
	}

	/** Newest first. */
	get frames(): FeedFrame[] {
		return this.items;
	}

	protected reset(): void {
		this.#samples = []; // the totals start over: so does the rate window
	}

	protected process(frames: WireFrame[], update: StreamUpdate): FeedFrame[] {
		this.#updateRates(update.counts);
		if (frames.length === 0) return [];
		// In arrival order: pairing depends on it.
		const decorated = frames.map((f) => this.#decoder.decorate(f));
		this.#decoder.prune(frames.at(-1)!.rx); // the server's clock, like the frames'
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
}

/**
 * Decodes frames for display. Remembers each aircraft's latest even and odd positions to
 * decode pairs (global CPR), so frames must come in arrival order.
 */
class FrameDecoder {
	#reference: () => LatLon | null;
	#pairs = new CprPairs();
	/** The same for surface positions: a separate grid, and pairs need the reference too. */
	#surfacePairs = new CprPairs(10_000, (even, odd, newer) => {
		const reference = this.#reference();
		return reference ? decodeSurfaceGlobal(even, odd, newer, reference) : null;
	});

	constructor(reference: () => LatLon | null) {
		this.#reference = reference;
	}

	/** Forget positions too old to pair with (rx: the server's clock). */
	prune(rx: number): void {
		this.#pairs.prune(rx);
		this.#surfacePairs.prune(rx);
	}

	/** A frame with everything the feed shows. */
	decorate(f: WireFrame): FeedFrame {
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
	 * Positions (ADS-B, relayed TIS-B/ADS-R, or the copy in a DF16 reply): decode locally
	 * with the reference point, and globally if the same sender recently sent one from the
	 * other grid. Surface positions need the reference point either way.
	 */
	#locate(data: Uint8Array, f: WireFrame): Located | null {
		const df = downlinkFormat(data);
		const me = payload(data);
		const es = esFormat(data) !== null;
		if (!me || !(es || df === 16)) return null;
		const reference = this.#reference();
		// Only pair messages whose address the CRC checked: DF16's comes from the parity and
		// could be wrong. DF18/19 get their own key: their addresses aren't all ICAO addresses.
		const key = es && f.addr?.verdict === 'valid' ? `${df}/${f.addr.icao}` : null;

		const surface = es ? surfacePosition(me) : null;
		if (surface) {
			return {
				reference,
				local: reference ? decodeSurfaceLocal(surface.cpr, reference) : null,
				global: key ? this.#surfacePairs.add(key, surface.cpr, f.rx) : null,
				surface: true
			};
		}
		const position = airbornePosition(me);
		if (!position?.cpr) return null;
		return {
			reference,
			local: reference ? decodeLocal(position.cpr, reference) : null,
			global: key ? this.#pairs.add(key, position.cpr, f.rx) : null
		};
	}
}
