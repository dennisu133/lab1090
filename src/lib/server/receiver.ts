import { BeastClient } from './beast/client';
import type { BeastFrame } from './beast/parser';
import { FrameBuffers } from './frame-buffers';
import { FrameCounts } from './frame-counts';
import { TrackHistory } from './track-history';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { downlinkFormat, signalDbfs, toHex, typeCode } from '#lib/modes/frame.ts';
import { formatEndpoint } from './settings';
import type { StreamUpdate, ReceiverCounts, WireFrame } from '#lib/receiver-types.ts';

const BATCH_MS = 250;
const HISTORY = 1000;
/** Frames kept per downlink format, type code and verdict (see FrameBuffers). */
const PER_KIND = 200;

type Subscriber = { send: (update: StreamUpdate) => void; close: () => void };

/**
 * The app's single connection to the Pi. Each frame gets an address verdict (AddressFilter)
 * and goes to the counts (FrameCounts), the per-kind buffers (FrameBuffers), the trail
 * history (TrackHistory) and the next batch. Batches fan out to any number of subscribers
 * (browser tabs) every 250 ms: one update with ~12 frames instead of ~12 separate events.
 */
export class Receiver {
	readonly source: string;
	readonly since = Date.now();
	/** The latest frames of every kind, for filtering (/api/frames). */
	readonly buffers = new FrameBuffers(PER_KIND);
	/** Thinned position frames of the last 10 minutes, for the tracker's trails. */
	readonly tracks = new TrackHistory();

	#client: BeastClient;
	#counts = new FrameCounts();
	#addresses = new AddressFilter();
	#nextId = 1;
	/** Recent frames, so a new tab doesn't start with an empty feed. */
	#history: WireFrame[] = [];
	#pending: WireFrame[] = [];
	#subscribers = new Set<Subscriber>();
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(host: string, port: number) {
		this.source = formatEndpoint({ host, port });
		this.#client = new BeastClient({
			host,
			port,
			onFrame: (f) => this.#onFrame(f)
		});
	}

	/** Every frame since the server started (FrameCounts). */
	get counts(): ReceiverCounts {
		return this.#counts.counts;
	}

	start(): this {
		this.#client.start();
		this.#timer = setInterval(() => this.#flush(), BATCH_MS);
		return this;
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#client.close();
		this.disconnectAll();
	}

	/**
	 * End every tab's stream; the browsers reconnect by themselves (EventSource). After a new
	 * receiver position: the first update of the new stream carries it, and the tabs reload.
	 */
	disconnectAll(): void {
		for (const s of this.#subscribers) s.close();
		this.#subscribers.clear();
	}

	/**
	 * Get an update right away, then one every 250 ms. The first holds the recent history,
	 * and the position history (TrackHistory) in its own field: the browser merges that in
	 * for the tracker alone (StreamUpdate.tracks).
	 */
	subscribe(send: Subscriber['send'], close: Subscriber['close']): () => void {
		const subscriber = { send, close };
		this.#subscribers.add(subscriber);
		// History only: frames still pending go out with the next batch, to everyone.
		// (Sending them here too would deliver them twice.) The same for position frames:
		// pending ones are in TrackHistory already.
		const last = this.#history.at(-1)?.id ?? 0;
		send({
			...this.#update(this.#history),
			tracks: this.tracks.frames.filter((f) => f.id <= last)
		});
		return () => this.#subscribers.delete(subscriber);
	}

	#onFrame(f: BeastFrame): void {
		if (f.kind === 'modeac') return; // only Mode S here (readsb doesn't send Mode A/C unless asked)
		const now = Date.now();
		const df = downlinkFormat(f.data);
		const tc = typeCode(f.data);
		const addr = this.#addresses.check(f.data, now);
		const traits = { df, tc, verdict: addr?.verdict ?? null };
		this.#counts.add(traits, signalDbfs(f.signal));

		const frame: WireFrame = {
			id: this.#nextId++,
			rx: now,
			ts: f.timestamp,
			sig: f.signal,
			hex: toHex(f.data),
			addr
		};
		this.#pending.push(frame);
		this.buffers.add(frame, traits);
		this.tracks.add(frame, f.data, df, tc);
	}

	#flush(): void {
		const now = Date.now();
		this.#addresses.prune(now);
		this.tracks.prune(now);
		const frames = this.#pending;
		this.#pending = [];
		this.#history = [...this.#history, ...frames].slice(-HISTORY);
		const update = this.#update(frames);
		for (const s of this.#subscribers) s.send(update);
	}

	#update(frames: WireFrame[]): StreamUpdate {
		return {
			status: this.#client.status,
			source: this.source,
			since: this.since,
			counts: this.counts,
			frames
		};
	}
}
