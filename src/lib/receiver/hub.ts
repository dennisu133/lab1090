import { AddressFilter } from '#lib/modes/address-filter.ts';
import { downlinkFormat, signalDbfs, toHex, typeCode } from '#lib/modes/frame.ts';
import type {
	DemodReport,
	RadioUpdate,
	ReceiverCounts,
	RecordingReport,
	ReplayInfo,
	SourceStatus,
	StreamUpdate,
	WireFrame
} from '#lib/receiver-types.ts';
import { FrameBuffers } from './frame-buffers';
import { FrameCounts } from './frame-counts';
import { RadioHistory } from './radio-history';
import { TrackHistory } from './track-history';

/** The hub's batches go out this often (the server's timer; the demo's player). */
export const BATCH_MS = 250;
/** The demodulator's report goes out this often (only /receiver reads it). */
const DEMOD_MS = 1000;
const HISTORY = 1000;
/** Frames kept per downlink format, type code and verdict (see FrameBuffers). */
const PER_KIND = 200;

/** A message as a source gives it: the receiver's clock, signal byte, the bytes. */
export interface HubFrame {
	/** Receiver clock, 12 MHz ticks. */
	timestamp: number;
	/** Signal byte, 0–255. */
	signal: number;
	data: Uint8Array;
}

/** What the source is doing right now, read with every batch (ReceiverHub.link). */
export interface HubLink {
	status: SourceStatus;
	/** The demodulator's report; null: the messages come demodulated (Beast). */
	demod: DemodReport | null;
	/** What --replay plays; undefined: a live source. */
	replay: ReplayInfo | undefined;
	/** The samples' recording (--record); null: none. */
	recording: RecordingReport | null;
}

/**
 * `eventId`: what the update brings the subscriber up to, for the SSE `id:` line (see
 * subscribe). The same for every subscriber.
 */
type Subscriber = { send: (update: StreamUpdate, eventId: string) => void; close: () => void };

/**
 * Where every message goes once a source has it, and what the browser tabs get of it: each
 * frame gets an address verdict (AddressFilter) and goes to the counts (FrameCounts), the
 * per-kind buffers (FrameBuffers), the trail history (TrackHistory) and the next batch.
 * Batches (flush, every BATCH_MS) fan out to any number of subscribers: one update with ~12
 * frames instead of ~12 separate events.
 *
 * Pure: no source, no timer, no clock of its own (`now` comes with every call), so the same
 * code runs on the server (server/receiver.ts: the RTL-SDR, a Beast feed, --replay) and in
 * the browser for the static demo (demo/player.ts: a recording played by the wall clock).
 */
export class ReceiverHub {
	readonly source: string;
	readonly since: number;
	/** The latest frames of every kind, for filtering (/api/frames). */
	readonly buffers = new FrameBuffers(PER_KIND);
	/** Thinned position frames of the last 10 minutes, for the tracker's trails. */
	readonly tracks = new TrackHistory();
	/** The last hour in 10-second points, and the link's events: for /receiver. */
	readonly radio: RadioHistory;

	#link: () => HubLink;
	#counts = new FrameCounts();
	#addresses = new AddressFilter();
	#nextId = 1;
	/** Recent frames, so a new tab doesn't start with an empty feed. */
	#history: WireFrame[] = [];
	#pending: WireFrame[] = [];
	#subscribers = new Set<Subscriber>();
	/** The replay's description as last sent (a new object when it changes). */
	#replaySent: ReplayInfo | undefined;
	/** When the demodulator's report last went out with a batch. */
	#demodSentAt = -Infinity;

	/** `source`: its name ("RTL-SDR 0"); `link`: its state now; `since`: when counting starts. */
	constructor(source: string, link: () => HubLink, since = Date.now()) {
		this.source = source;
		this.since = since;
		this.radio = new RadioHistory(since);
		this.#link = link;
	}

	/** Every frame since the start (FrameCounts). */
	get counts(): ReceiverCounts {
		return this.#counts.counts;
	}

	/**
	 * End every tab's stream; the browsers reconnect by themselves (EventSource). After a new
	 * receiver position: the first update of the new stream carries it, and the tabs reload.
	 */
	disconnectAll(): void {
		for (const s of this.#subscribers) s.close();
		this.#subscribers.clear();
	}

	/** The radio part of a new stream's first update; also /receiver's page data. */
	radioSnapshot(): RadioUpdate {
		return this.radio.full(this.#link().demod);
	}

	/** Where the messages come from, as a new stream's first update says; also /receiver's. */
	linkSnapshot(): {
		source: string;
		replay: ReplayInfo | null;
		recording: RecordingReport | null;
	} {
		const link = this.#link();
		return { source: this.source, replay: link.replay ?? null, recording: link.recording };
	}

	/**
	 * Get an update right away, then one with every batch. The first holds the recent
	 * history, and the position history (TrackHistory) in its own field: the browser merges
	 * that in for the tracker alone (StreamUpdate.tracks).
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
		const link = this.#link();
		const radio = this.radio.full(link.demod);
		const after = this.#resumeAfter(lastEventId);
		const frames = after === null ? this.#history : this.#history.filter((f) => f.id > after);
		const update: StreamUpdate = { ...this.#update(frames, radio, link), source: this.source };
		if (link.replay) update.replay = link.replay;
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

	/** A message, received at `now` (ms since epoch). */
	add(f: HubFrame, now: number): void {
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

	/** The batch: everything added since the last one, to every subscriber. */
	flush(now: number): void {
		this.#addresses.prune(now);
		this.tracks.prune(now);
		const frames = this.#pending;
		this.#pending = [];
		this.#history = [...this.#history, ...frames].slice(-HISTORY);
		const link = this.#link();
		this.radio.read(now, this.counts.total, link.demod);
		const sendDemod = now - this.#demodSentAt >= DEMOD_MS;
		if (sendDemod) this.#demodSentAt = now;
		const update = this.#update(frames, this.radio.take(sendDemod ? link.demod : undefined), link);
		if (link.replay !== this.#replaySent) {
			if (link.replay) update.replay = link.replay;
			this.#replaySent = link.replay;
		}
		const eventId = this.#eventId();
		for (const s of this.#subscribers) s.send(update, eventId);
	}

	#update(frames: WireFrame[], radio: RadioUpdate, link: HubLink): StreamUpdate {
		return {
			status: link.status,
			...(link.recording && { recording: link.recording }),
			since: this.since,
			counts: this.counts,
			radio,
			frames
		};
	}
}
