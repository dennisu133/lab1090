import { receiverLink } from '#lib/receiver-link.svelte.ts';
import type { StreamUpdate, WireFrame } from '#lib/receiver-types.ts';

/** Anything fed with the stream's updates: the pages' views (LiveFeed), ReceiverStats. */
export interface UpdateListener {
	/** An update: every frame once, in arrival order. */
	receive(update: StreamUpdate): void;
	/**
	 * The server restarted (a new run, e.g. a dev reload): forget whatever came from the old
	 * one. Its frame ids, counts and clocks start over, so mixing them up would be wrong.
	 * Called on every listener, in order, before the new run's first update.
	 */
	reset?(): void;
}

/** Where the updates come from: the server's event stream, or the demo's player. */
export interface UpdateSource {
	/**
	 * Start; `update` gets every update, `online` whether the link to the source is up.
	 * Returns a cleanup function.
	 */
	open(handlers: { update(update: StreamUpdate): void; online(up: boolean): void }): () => void;
}

/** How long to wait before opening a new EventSource after one gave up. */
const RETRY_MS = 5_000;

/** The server's event stream, '/api/stream' (see StreamConnection for what it does). */
export function eventStream(url: string): UpdateSource {
	return {
		open({ update, online }) {
			let source: EventSource;
			let retry: ReturnType<typeof setTimeout> | undefined;
			const open = () => {
				source = new EventSource(url);
				source.onopen = () => online(true);
				source.onerror = () => {
					online(false);
					// CONNECTING: it retries by itself. CLOSED: it gave up (an HTTP error).
					if (source.readyState === EventSource.CLOSED) retry = setTimeout(open, RETRY_MS);
				};
				source.onmessage = (e) => update(JSON.parse(e.data));
			};
			open();
			return () => {
				clearTimeout(retry);
				source.close();
			};
		}
	};
}

/**
 * The browser's one connection to the server's event stream (/api/stream), feeding every
 * page's view of it (the LiveFeeds) and the receiver's counts with the same updates.
 *
 * One connection for the whole app, not one per page: the root layout opens it, so it stays
 * open while you move between pages, and every view keeps collecting in the background. The
 * weather profile needs half an hour of data, the tracker's turn rates and callsigns a few
 * minutes; with a connection per page all of that started over on every page switch. A
 * reload or a new tab still starts over: the server only keeps a little history (ReceiverHub).
 *
 * EventSource reconnects by itself after a network error, saying which update it got last
 * (Last-Event-ID), and the server goes on from there (ReceiverHub.subscribe). It gives up for
 * good when the server answers with an HTTP error (a reverse proxy's 502 while lab1090
 * restarts): then a new one is opened after RETRY_MS, which starts afresh, and the server
 * sends its recent history again, part of which this tab already has. So does a reconnect
 * after the history has moved on. Frame ids only grow within a server run, so frames up to
 * the newest one seen are dropped: every view gets every frame once. If the server restarted
 * (dev reload), the ids start over and `since` changes: every listener resets (`reset`).
 *
 * Also reports both links (browser ↔ server, server ↔ receiver) to `receiverLink`, for the status
 * in the navigation bar.
 *
 * The static demo has no server: its player (demo/player.ts) runs the server's hub in the
 * page and hands over the same updates (an UpdateSource like eventStream).
 */
export class StreamConnection {
	#source: UpdateSource;
	#listeners: UpdateListener[];
	/** The server run (`since`) and the newest frame id from it seen so far. */
	#since: number | null = null;
	#newest = 0;

	/** `source`: eventStream('/api/stream'), or the demo's player. */
	constructor(source: UpdateSource, listeners: UpdateListener[]) {
		this.#source = source;
		this.#listeners = listeners;
	}

	/** Open the stream; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		return this.#source.open({
			update: (update) => this.#receive(update),
			online: (up) => (receiverLink.online = up)
		});
	}

	#receive(update: StreamUpdate): void {
		receiverLink.status = update.status;
		receiverLink.recording = update.recording ?? null;
		if (update.source !== undefined) {
			// First update only: a new run may play something else, or nothing.
			receiverLink.source = update.source;
			receiverLink.replay = update.replay ?? null;
		} else if (update.replay) receiverLink.replay = update.replay;
		if (update.since !== this.#since) {
			// The first update of all needs no reset: nothing came before it.
			if (this.#since !== null) for (const listener of this.#listeners) listener.reset?.();
			this.#since = update.since;
			this.#newest = 0;
		}
		const unseen = (frames: WireFrame[]) => frames.filter((f) => f.id > this.#newest);
		const fresh: StreamUpdate = { ...update, frames: unseen(update.frames) };
		if (update.tracks) fresh.tracks = unseen(update.tracks); // never newer than `frames`
		this.#newest = fresh.frames.at(-1)?.id ?? this.#newest;
		for (const listener of this.#listeners) listener.receive(fresh);
	}
}
