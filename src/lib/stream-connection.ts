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

/**
 * The browser's one connection to the server's event stream (/api/stream), feeding every
 * page's view of it (the LiveFeeds) and the receiver's counts with the same updates.
 *
 * One connection for the whole app, not one per page: the root layout opens it, so it stays
 * open while you move between pages, and every view keeps collecting in the background. The
 * weather profile needs half an hour of data, the tracker's turn rates and callsigns a few
 * minutes; with a connection per page all of that started over on every page switch. A
 * reload or a new tab still starts over: the server only keeps a little history (Receiver).
 *
 * EventSource reconnects by itself after a network error, but gives up for good when the
 * server answers with an HTTP error (a reverse proxy's 502 while lab1090 restarts): then a new
 * one is opened after RETRY_MS. Either way the server then sends its recent history again, part
 * of which this tab already has. Frame ids only grow within a server run, so frames up to the
 * newest one seen are dropped: every view gets every frame once. If the server restarted
 * (dev reload), the ids start over and `since` changes: every listener resets (`reset`).
 *
 * Also reports both links (browser ↔ server, server ↔ receiver) to `receiverLink`, for the status
 * in the navigation bar.
 */
/** How long to wait before opening a new EventSource after one gave up. */
const RETRY_MS = 5_000;

export class StreamConnection {
	#url: string;
	#listeners: UpdateListener[];
	/** The server run (`since`) and the newest frame id from it seen so far. */
	#since: number | null = null;
	#newest = 0;

	/** `url`: the server's event stream, '/api/stream'. */
	constructor(url: string, listeners: UpdateListener[]) {
		this.#url = url;
		this.#listeners = listeners;
	}

	/** Open the stream; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		let source: EventSource;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const open = () => {
			source = new EventSource(this.#url);
			source.onopen = () => (receiverLink.online = true);
			source.onerror = () => {
				receiverLink.online = false;
				// CONNECTING: it retries by itself. CLOSED: it gave up (an HTTP error).
				if (source.readyState === EventSource.CLOSED) retry = setTimeout(open, RETRY_MS);
			};
			source.onmessage = (e) => this.#receive(JSON.parse(e.data));
		};
		open();
		return () => {
			clearTimeout(retry);
			source.close();
		};
	}

	#receive(update: StreamUpdate): void {
		receiverLink.status = update.status;
		receiverLink.source = update.source;
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
