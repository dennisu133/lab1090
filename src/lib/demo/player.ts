import { BeastParser } from '#lib/beast/parser.ts';
import type { FrameQuery } from '#lib/frame-query.ts';
import { BATCH_MS, ReceiverHub, type HubFrame, type HubLink } from '#lib/receiver/hub.ts';
import type { FramesResponse, ReplayInfo } from '#lib/receiver-types.ts';
import type { UpdateSource } from '#lib/stream-connection.ts';
import { DEMO_PATH, MANIFEST_FILE, type DemoManifest } from './manifest';

/**
 * The static demo's receiver: a recording (tools/demo.ts, a seamless loop: fold.ts) played
 * in the page, through the same hub as the server's (lib/receiver/hub.ts), so every view
 * gets the updates it would get from /api/stream, and /frames' lookups find what
 * /api/frames would (`query`).
 *
 * The loop runs on the wall clock, not from the moment the page opened: loop number k
 * plays from k × loopMs after 1970. So everyone sees the same sky at the same time, and a
 * reload goes on where it was instead of starting over. Like a server that has been running
 * for a while, the page starts with the last PREROLL_MS already received (read at once, in
 * the hub's 250 ms batches): the trails, the recent frames, the message rate.
 *
 * Its files are fetched as the loop gets to them (a minute ahead), ~0.5 MB each, gzipped
 * (Beast compresses to half). A tab in the background gets its timers slowed down (to once
 * a minute in Chrome): it catches up when they fire, but by at most PREROLL_MS: further
 * back is skipped, as a server would have moved on without the tab.
 */

/** Read at once when the page opens: the tracker's trails (TrackHistory) go back that far. */
const PREROLL_MS = 10 * 60_000;
/** Files are fetched this long before they're due. */
const AHEAD_MS = 60_000;
/** After a failed fetch, the next try. */
const RETRY_MS = 5_000;
const TICKS_PER_MS = 12_000;

/** One file's turn in one loop: chunk `index` of loop number `loop`. */
interface Segment {
	loop: number;
	index: number;
	/** When it starts playing, wall clock (ms since epoch). */
	from: number;
}

interface Due {
	at: number;
	frame: HubFrame;
}

export class DemoPlayer implements UpdateSource {
	#hub: ReceiverHub | null = null;
	#manifest: DemoManifest | null = null;
	/** Messages loaded and not yet played, in order. */
	#queue: Due[] = [];
	#next = 0;
	/** Loaded (or loading) up to this segment's end: the next one to fetch. */
	#segment: Segment | null = null;
	#loading = false;
	/** Played up to here (wall clock). */
	#played = 0;
	/** Receiver clock (Beast timestamps) zero: a little before the first message played. */
	#origin = 0;
	/** What the navigation bar says it plays (the same object every time: hub.flush). */
	#replay: ReplayInfo | undefined;

	/** /frames' lookups: what /api/frames answers on the server. */
	query(query: FrameQuery): FramesResponse {
		return { since: this.#hub?.since ?? 0, frames: this.#hub?.buffers.query(query) ?? [] };
	}

	open(handlers: Parameters<UpdateSource['open']>[0]): () => void {
		let closed = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let unsubscribe = () => {};

		const start = async () => {
			try {
				const response = await fetch(`${DEMO_PATH}/${MANIFEST_FILE}`);
				if (!response.ok) throw new Error(`${response.status}`);
				this.#manifest = await response.json();
				this.#replay = {
					file: 'demo',
					kind: 'beast',
					loop: true,
					label: null,
					recorder: null,
					recordedAt: this.#manifest!.recordedAt
				};
				const now = Date.now();
				this.#queue = [];
				this.#next = 0;
				this.#played = now - PREROLL_MS;
				this.#origin = this.#played - 1000;
				this.#segment = this.#segmentAt(this.#played);
				await this.#loadUntil(now + AHEAD_MS);
			} catch {
				if (closed) return;
				handlers.online(false);
				timer = setTimeout(start, RETRY_MS);
				return;
			}
			if (closed) return;
			const hub = new ReceiverHub('Recording', () => this.#link(), this.#played);
			this.#hub = hub;
			// What the server would have done meanwhile, batch by batch.
			const now = Date.now();
			for (let t = this.#played + BATCH_MS; t <= now; t += BATCH_MS) this.#play(t);
			handlers.online(true);
			// A copy, as the server's JSON would be: the hub goes on changing its counts.
			unsubscribe = hub.subscribe(
				(update) => handlers.update(structuredClone(update)),
				() => {}
			);
			timer = setInterval(() => this.#tick(handlers.online), BATCH_MS);
		};
		void start();

		return () => {
			closed = true;
			clearTimeout(timer);
			clearInterval(timer);
			unsubscribe();
		};
	}

	#link(): HubLink {
		return { status: { state: 'connected' }, demod: null, replay: this.#replay, recording: null };
	}

	#tick(online: (up: boolean) => void): void {
		const now = Date.now();
		// Back from the background: skip what's older than a fresh page would read.
		if (now - this.#played > PREROLL_MS) this.#skipTo(now - PREROLL_MS);
		this.#play(now);
		if (!this.#loading && this.#segment!.from < now + AHEAD_MS) {
			this.#loadUntil(now + AHEAD_MS).then(
				() => online(true),
				() => online(false) // tried again on the next tick
			);
		}
	}

	/** Hand the hub everything due by `t` (as far as it's loaded), and batch. */
	#play(t: number): void {
		const until = Math.min(t, this.#segment!.from);
		while (this.#next < this.#queue.length && this.#queue[this.#next].at <= until) {
			const { at, frame } = this.#queue[this.#next++];
			this.#hub!.add(frame, at);
		}
		this.#played = Math.max(this.#played, until);
		this.#hub!.flush(t);
		// Drop what's played, now and then (not with every batch: that's a copy each time).
		if (this.#next > 10_000) {
			this.#queue = this.#queue.slice(this.#next);
			this.#next = 0;
		}
	}

	#skipTo(t: number): void {
		while (this.#next < this.#queue.length && this.#queue[this.#next].at < t) this.#next++;
		this.#played = t;
		// Not even loaded that far: start loading from there.
		if (this.#segment!.from < t && !this.#loading) {
			this.#queue = [];
			this.#next = 0;
			this.#segment = this.#segmentAt(t);
		}
	}

	/** Fetch the files up to `t`, in order. */
	async #loadUntil(t: number): Promise<void> {
		this.#loading = true;
		try {
			while (this.#segment!.from < t) {
				const segment = this.#segment!;
				const frames = await this.#fetchChunk(segment.index);
				const start = segment.loop * this.#manifest!.loopMs;
				for (const f of frames) {
					const at = start + f.timestamp / TICKS_PER_MS;
					if (at < this.#played) continue; // the first one, opened halfway
					const timestamp = Math.round((at - this.#origin) * TICKS_PER_MS);
					this.#queue.push({ at, frame: { timestamp, signal: f.signal, data: f.data } });
				}
				this.#segment = this.#after(segment);
			}
		} finally {
			this.#loading = false;
		}
	}

	async #fetchChunk(index: number) {
		const response = await fetch(`${DEMO_PATH}/${this.#manifest!.chunks[index]}`);
		if (!response.ok) throw new Error(`${response.status}`);
		let bytes = new Uint8Array(await response.arrayBuffer());
		// Gzipped, unless the host said so (Content-Encoding) and the browser unpacked it.
		if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
			const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
			bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		}
		return new BeastParser().push(bytes);
	}

	#segmentAt(t: number): Segment {
		const { loopMs, chunkMs } = this.#manifest!;
		const loop = Math.floor(t / loopMs);
		return this.#segmentOf(loop, Math.floor((t - loop * loopMs) / chunkMs));
	}

	#after(s: Segment): Segment {
		return s.index + 1 < this.#manifest!.chunks.length
			? this.#segmentOf(s.loop, s.index + 1)
			: this.#segmentOf(s.loop + 1, 0);
	}

	#segmentOf(loop: number, index: number): Segment {
		const { loopMs, chunkMs } = this.#manifest!;
		return { loop, index, from: loop * loopMs + index * chunkMs };
	}
}
