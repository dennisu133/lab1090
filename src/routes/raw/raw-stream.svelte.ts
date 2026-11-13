import { CprPairs, decodeLocal, type LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat, fromHex, payload, signalDbfs, typeCode } from '#lib/modes/frame.ts';
import { airbornePosition } from '#lib/modes/position.ts';
import type { RawUpdate, ReceiverCounts, WireFrame } from '#lib/receiver-types.ts';
import { describe, type Field, type Located } from './describe';

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
 * Client side of /api/raw: holds the latest counts, a feed of recent frames, and message rates.
 * Rates are computed here from how the server's running totals change over the last 10 s.
 */
export class RawStream {
	/** Is the browser <-> server stream open? (The server <-> Pi link is in `update.status`.) */
	online = $state(false);
	update = $state.raw<RawUpdate | null>(null);
	/** Newest first. */
	frames = $state.raw<FeedFrame[]>([]);
	rates = $state.raw<Rates>({ total: 0, byDf: {}, byTc: {}, byVerdict: {} });

	paused = $state(false);
	/** Frames that arrived while paused. */
	held = $state(0);

	#heldFrames: FeedFrame[] = [];
	#samples: { t: number; counts: ReceiverCounts }[] = [];
	/** Each aircraft's latest even and odd position, for global CPR decoding. */
	#pairs = new CprPairs();

	/** REFERENCE_POINT from the server, if set (for local CPR decoding). */
	#reference: () => LatLon | null;

	constructor(reference: () => LatLon | null) {
		this.#reference = reference;
	}

	/** Open the stream; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		const source = new EventSource('/api/raw');
		source.onopen = () => (this.online = true);
		source.onerror = () => (this.online = false); // EventSource retries by itself
		source.onmessage = (e) => this.#receive(JSON.parse(e.data));
		return () => source.close();
	}

	togglePause(): void {
		this.paused = !this.paused;
		if (!this.paused) {
			this.frames = [...this.#heldFrames, ...this.frames].slice(0, MAX_FRAMES);
			this.#heldFrames = [];
			this.held = 0;
		}
	}

	#receive(update: RawUpdate): void {
		// A new server run (e.g. dev reload) resets the totals: start the rate window over.
		if (this.update && update.since !== this.update.since) {
			this.#samples = [];
			this.frames = [];
		}
		this.update = update;
		this.#updateRates(update.counts);

		if (update.frames.length === 0) return;
		// In arrival order (pairing depends on it), then newest first for the feed.
		const fresh = update.frames.map((f) => this.#decorate(f)).reverse();
		this.#pairs.prune(update.frames.at(-1)!.rx); // the server's clock, like the frames'
		if (this.paused) {
			this.#heldFrames = [...fresh, ...this.#heldFrames].slice(0, MAX_FRAMES);
			this.held = this.#heldFrames.length;
		} else {
			this.frames = [...fresh, ...this.frames].slice(0, MAX_FRAMES);
		}
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
