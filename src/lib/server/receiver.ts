import { openSource, type FrameSource, type ModeSFrame } from './frame-source';
import { BeastServer } from './beast/server';
import { FrameBuffers } from './frame-buffers';
import { FrameCounts } from './frame-counts';
import { RadioHistory } from './radio-history';
import { TrackHistory } from './track-history';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { downlinkFormat, signalDbfs, toHex, typeCode } from '#lib/modes/frame.ts';
import { describeSource, type Source } from './settings';
import type {
	RadioUpdate,
	ReceiverCounts,
	SourceEvent,
	StreamUpdate,
	WireFrame
} from '#lib/receiver-types.ts';

const BATCH_MS = 250;
/** The demodulator's report goes out this often (only /receiver reads it). */
const DEMOD_MS = 1000;
const HISTORY = 1000;
/** Frames kept per downlink format, type code and verdict (see FrameBuffers). */
const PER_KIND = 200;

/**
 * `eventId`: what the update brings the subscriber up to, for the SSE `id:` line (see
 * subscribe). The same for every subscriber.
 */
type Subscriber = { send: (update: StreamUpdate, eventId: string) => void; close: () => void };

/**
 * The app's single source of messages (frame-source.ts: the RTL-SDR, rtl_tcp, a Beast feed,
 * a recording). Each frame gets an address verdict (AddressFilter)
 * and goes to the counts (FrameCounts), the per-kind buffers (FrameBuffers), the trail
 * history (TrackHistory) and the next batch. Batches fan out to any number of subscribers
 * (browser tabs) every 250 ms: one update with ~12 frames instead of ~12 separate events.
 * With `beastOut`, every frame also goes out at once as Beast on that port (BeastServer).
 */
export class Receiver {
	readonly source: string;
	readonly since = Date.now();
	/** The latest frames of every kind, for filtering (/api/frames). */
	readonly buffers = new FrameBuffers(PER_KIND);
	/** Thinned position frames of the last 10 minutes, for the tracker's trails. */
	readonly tracks = new TrackHistory();
	/** The last hour in 10-second points, and the link's events: for /receiver. */
	readonly radio = new RadioHistory(this.since);

	#client: FrameSource;
	#beast: BeastServer | null;
	#counts = new FrameCounts();
	#addresses = new AddressFilter();
	#nextId = 1;
	/** Recent frames, so a new tab doesn't start with an empty feed. */
	#history: WireFrame[] = [];
	#pending: WireFrame[] = [];
	#subscribers = new Set<Subscriber>();
	#timer: ReturnType<typeof setInterval> | undefined;
	/** When the demodulator's report last went out with a batch. */
	#demodSentAt = -Infinity;
	/** Say on the console which source this is and how its link is doing (#log). */
	#logging: boolean;

	constructor(
		source: Source,
		{ log = true, beastOut = null }: { log?: boolean; beastOut?: number | null } = {}
	) {
		this.source = describeSource(source);
		this.#logging = log;
		this.#beast = beastOut === null ? null : new BeastServer({ port: beastOut });
		this.#client = openSource(
			source,
			(f) => this.#onFrame(f),
			(status) => {
				const event = this.radio.status(status, Date.now());
				if (this.#logging && event) this.#log(event);
			}
		);
	}

	/**
	 * Say on the console when the link to the receiver comes up or goes down, and why: on a
	 * Pi without a screen that's the first place to look. Only new events (RadioHistory): a
	 * retry for the same reason is said once, not every 30 s.
	 */
	#log(event: SourceEvent): void {
		if (event.state === 'waiting') console.warn(`${this.source}: ${event.reason}, trying again`);
		else if (event.state === 'connected') console.log(`${this.source}: receiving`);
		else console.log(`${this.source}: the recording has ended`);
	}

	/** Every frame since the server started (FrameCounts). */
	get counts(): ReceiverCounts {
		return this.#counts.counts;
	}

	/**
	 * The source is named before the first attempt, so that its outcome (`…: receiving`, or
	 * why not) reads as the next line. In dev, a hot reload starts a new Receiver: named again.
	 */
	start(): this {
		if (this.#logging) console.log(`Source: ${this.source}`);
		try {
			this.#beast?.start();
		} catch (error) {
			// The page still works without it; say so where a Pi's owner looks.
			console.error(`Beast output on port ${this.#beast?.port}: ${(error as Error).message}`);
		}
		this.#client.start();
		this.#timer = setInterval(() => this.#flush(), BATCH_MS);
		return this;
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#client.close();
		this.#beast?.stop();
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
	 *
	 * Unless it picks up where an earlier subscription of this tab left off: `lastEventId`,
	 * the id of the last update it got (EventSource sends it as Last-Event-ID when it
	 * reconnects by itself). If that names this run and the history still reaches back to it,
	 * the first update holds only the frames since, and no positions: the tab has the rest.
	 * A reconnect after a dropped Wi-Fi then costs a few frames, not 1,000 frames and 10
	 * minutes of positions. Otherwise (a new tab, a restarted server, a tab that was away
	 * too long) it gets everything, and the browser drops what it already has (by id).
	 */
	subscribe(
		send: Subscriber['send'],
		close: Subscriber['close'],
		lastEventId: string | null = null
	): () => void {
		const subscriber = { send, close };
		this.#subscribers.add(subscriber);
		// History only: frames still pending go out with the next batch, to everyone.
		// (Sending them here too would deliver them twice.) The same for position frames:
		// pending ones are in TrackHistory already.
		const radio = this.radio.full(this.#client.decoder?.report() ?? null);
		const after = this.#resumeAfter(lastEventId);
		const frames = after === null ? this.#history : this.#history.filter((f) => f.id > after);
		const update: StreamUpdate = { ...this.#update(frames, radio), source: this.source };
		if (after === null) {
			const last = this.#history.at(-1)?.id ?? 0;
			update.tracks = this.tracks.frames.filter((f) => f.id <= last);
		}
		send(update, this.#eventId());
		return () => this.#subscribers.delete(subscriber);
	}

	/**
	 * An update's event id: this run and the newest frame sent so far, "1795000000000-4711".
	 * Every subscriber has every frame up to there once the update arrives: the history
	 * and then every batch.
	 */
	#eventId(): string {
		return `${this.since}-${this.#history.at(-1)?.id ?? 0}`;
	}

	/**
	 * The frame id to go on after, from an event id (#eventId); null: start from scratch.
	 * The id must be from this run (after a restart the ids start over) and the history
	 * must still hold every frame after it (it keeps the last HISTORY).
	 */
	#resumeAfter(eventId: string | null): number | null {
		const m = eventId?.match(/^(\d+)-(\d+)$/);
		if (!m || Number(m[1]) !== this.since) return null;
		const after = Number(m[2]);
		const first = this.#history[0]?.id ?? 1;
		const last = this.#history.at(-1)?.id ?? 0;
		return after >= first - 1 && after <= last ? after : null;
	}

	#onFrame(f: ModeSFrame): void {
		this.#beast?.add(f);
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
		const demod = this.#client.decoder?.report() ?? null;
		this.radio.read(now, this.counts.total, demod);
		const sendDemod = now - this.#demodSentAt >= DEMOD_MS;
		if (sendDemod) this.#demodSentAt = now;
		const update = this.#update(frames, this.radio.take(sendDemod ? demod : undefined));
		const eventId = this.#eventId();
		for (const s of this.#subscribers) s.send(update, eventId);
	}

	#update(frames: WireFrame[], radio: RadioUpdate): StreamUpdate {
		return {
			status: this.#client.status,
			since: this.since,
			counts: this.counts,
			radio,
			frames
		};
	}
}
