import { BeastClient, type BeastClientStatus } from './beast/client';
import type { BeastFrame } from './beast/parser';
import { FrameBuffers } from './frame-buffers';
import { TrackHistory } from './track-history';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { downlinkFormat, signalBucket, signalDbfs, toHex, typeCode } from '#lib/modes/frame.ts';
import type { StreamUpdate, ReceiverCounts, WireFrame } from '#lib/receiver-types.ts';

const BATCH_MS = 250;
const HISTORY = 1000;
/** Frames kept per downlink format, type code and verdict (see FrameBuffers). */
const PER_KIND = 200;

type Subscriber = { send: (update: StreamUpdate) => void; close: () => void };

/**
 * The app's single connection to the Pi. Counts every frame and fans the stream out to any
 * number of subscribers (browser tabs), batched every 250 ms: one update with ~12 frames
 * instead of ~12 separate events.
 */
export class Receiver {
	readonly source: string;
	readonly since = Date.now();
	readonly counts: ReceiverCounts = { total: 0, byDf: {}, byTc: {}, bySignal: {}, byVerdict: {} };
	status: BeastClientStatus = { state: 'closed' };
	/** The latest frames of every kind, for filtering (/api/frames). */
	readonly buffers = new FrameBuffers(PER_KIND);
	/** Thinned position frames of the last 10 minutes, for the tracker's trails. */
	readonly tracks = new TrackHistory();

	#client: BeastClient;
	#addresses = new AddressFilter();
	#nextId = 1;
	/** Recent frames, so a new tab doesn't start with an empty feed. */
	#history: WireFrame[] = [];
	#pending: WireFrame[] = [];
	#subscribers = new Set<Subscriber>();
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(host: string, port: number) {
		this.source = `${host}:${port}`;
		this.#client = new BeastClient({
			host,
			port,
			onFrame: (f) => this.#onFrame(f),
			onStatus: (s) => (this.status = s)
		});
	}

	start(): this {
		this.#client.start();
		this.#timer = setInterval(() => this.#flush(), BATCH_MS);
		return this;
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#client.close();
		for (const s of this.#subscribers) s.close();
		this.#subscribers.clear();
	}

	/**
	 * Get an update right away (with recent history), then one every 250 ms. `tracks`: the
	 * first update also holds the position history (TrackHistory) in its own field. Only the
	 * tracker wants it (the other pages would count 10 minutes of old positions as new), so
	 * the browser merges it in for the tracker alone.
	 */
	subscribe(
		send: Subscriber['send'],
		close: Subscriber['close'],
		{ tracks = false } = {}
	): () => void {
		const subscriber = { send, close };
		this.#subscribers.add(subscriber);
		// History only: frames still pending go out with the next batch, to everyone.
		// (Sending them here too would deliver them twice.)
		const update = this.#update(this.#history);
		if (tracks) {
			// Position frames still pending are in TrackHistory already but come with the next
			// batch: leave them out here, or the tracker would get them twice.
			const last = this.#history.at(-1)?.id ?? 0;
			update.tracks = this.tracks.frames(Date.now()).filter((f) => f.id <= last);
		}
		send(update);
		return () => this.#subscribers.delete(subscriber);
	}

	#onFrame(f: BeastFrame): void {
		if (f.kind === 'modeac') return; // only Mode S here (readsb doesn't send Mode A/C unless asked)
		const c = this.counts;
		c.total++;
		const df = downlinkFormat(f.data);
		c.byDf[df] = (c.byDf[df] ?? 0) + 1;
		const tc = typeCode(f.data);
		if (tc !== null && df === 17) c.byTc[tc] = (c.byTc[tc] ?? 0) + 1;
		const bucket = signalBucket(signalDbfs(f.signal));
		c.bySignal[bucket] = (c.bySignal[bucket] ?? 0) + 1;
		const now = Date.now();
		const addr = this.#addresses.check(f.data, now);
		if (addr) c.byVerdict[addr.verdict] = (c.byVerdict[addr.verdict] ?? 0) + 1;

		const frame: WireFrame = {
			id: this.#nextId++,
			rx: now,
			ts: f.timestamp,
			sig: f.signal,
			hex: toHex(f.data),
			addr
		};
		this.#pending.push(frame);
		this.buffers.add(frame, { df, tc, verdict: addr?.verdict ?? null });
		this.tracks.add(frame, f.data, df, tc);
	}

	#flush(): void {
		this.#addresses.prune(Date.now());
		const frames = this.#pending;
		this.#pending = [];
		this.#history = [...this.#history, ...frames].slice(-HISTORY);
		const update = this.#update(frames);
		for (const s of this.#subscribers) s.send(update);
	}

	#update(frames: WireFrame[]): StreamUpdate {
		return {
			status: this.status,
			source: this.source,
			since: this.since,
			counts: this.counts,
			frames
		};
	}
}
