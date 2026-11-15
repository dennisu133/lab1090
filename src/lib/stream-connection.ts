import type { LiveFeed } from '#lib/live-feed.svelte.ts';
import { receiverLink } from '#lib/receiver-link.svelte.ts';
import type { StreamUpdate, WireFrame } from '#lib/receiver-types.ts';

/**
 * The browser's one connection to the server's event stream (/api/stream), feeding every
 * page's view of it (the LiveFeeds) with the same updates.
 *
 * One connection for the whole app, not one per page: the root layout opens it, so it stays
 * open while you move between pages, and every view keeps collecting in the background. The
 * weather profile needs half an hour of data, the tracker's turn rates and callsigns a few
 * minutes; with a connection per page all of that started over on every page switch. A
 * reload or a new tab still starts over: the server only keeps a little history (Receiver).
 *
 * EventSource reconnects by itself, and the server then sends its recent history again, part
 * of which this tab already has. Frame ids only grow within a server run, so frames up to the
 * newest one seen are dropped: every view gets every frame once. If the server restarted
 * (dev reload), the ids start over and `since` changes: the views reset (LiveFeed.receive).
 *
 * Also reports both links (browser ↔ server, server ↔ Pi) to `receiverLink`, for the status
 * in the navigation bar.
 */
export class StreamConnection {
	#url: string;
	#feeds: LiveFeed<unknown>[];
	/** The server run (`since`) and the newest frame id from it seen so far. */
	#since: number | null = null;
	#newest = 0;

	/** `url`: the stream, e.g. '/api/stream?tracks' for the tracker's position history. */
	constructor(url: string, feeds: LiveFeed<unknown>[]) {
		this.#url = url;
		this.#feeds = feeds;
	}

	/** Open the stream; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		const source = new EventSource(this.#url);
		source.onopen = () => (receiverLink.online = true);
		source.onerror = () => (receiverLink.online = false); // EventSource retries by itself
		source.onmessage = (e) => this.#receive(JSON.parse(e.data));
		return () => source.close();
	}

	#receive(update: StreamUpdate): void {
		receiverLink.status = update.status;
		receiverLink.source = update.source;
		if (update.since !== this.#since) {
			this.#since = update.since;
			this.#newest = 0;
		}
		const unseen = (frames: WireFrame[]) => frames.filter((f) => f.id > this.#newest);
		const fresh: StreamUpdate = { ...update, frames: unseen(update.frames) };
		if (update.tracks) fresh.tracks = unseen(update.tracks); // never newer than `frames`
		this.#newest = fresh.frames.at(-1)?.id ?? this.#newest;
		for (const feed of this.#feeds) feed.receive(fresh);
	}
}
