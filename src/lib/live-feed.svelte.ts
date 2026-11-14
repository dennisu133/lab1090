import type { StreamUpdate, WireFrame } from '#lib/receiver-types.ts';

/**
 * Browser side of the /api/stream event stream, shared by the pages that show live frames: opens the
 * EventSource, keeps the latest update and a list of recent items (newest first), and can
 * pause the list without losing what arrives meanwhile.
 *
 * Two things pause it: the Pause button, and scrolling down into the list (see
 * PauseButton.svelte). New items go on top, so while you read further down they would push
 * the rows you're reading away. The list resumes when you scroll back up, unless the
 * button paused it too.
 *
 * What an item is depends on the page: subclasses turn each batch of frames into items.
 */
export abstract class LiveFeed<T> {
	/** Is the browser <-> server stream open? (The server <-> Pi link is in `update.status`.) */
	online = $state(false);
	update = $state.raw<StreamUpdate | null>(null);
	/** Newest first. */
	items = $state.raw<T[]>([]);

	/** Paused with the button. */
	pausedByUser = $state(false);
	/** Paused because the list's top is scrolled out of view. */
	scrolledAway = $state(false);
	/** Items that arrived while paused. */
	held = $state(0);

	#heldItems: T[] = [];
	#maxItems: number;

	constructor(maxItems: number) {
		this.#maxItems = maxItems;
	}

	/**
	 * Turn new frames (in arrival order) into items (also in arrival order). Called for every
	 * update, even one without frames.
	 */
	protected abstract process(frames: WireFrame[], update: StreamUpdate): T[];

	/** The server restarted (e.g. dev reload): forget whatever depends on its counters. */
	protected reset(): void {}

	/** Open the stream; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		const source = new EventSource('/api/stream');
		source.onopen = () => (this.online = true);
		source.onerror = () => (this.online = false); // EventSource retries by itself
		source.onmessage = (e) => this.#receive(JSON.parse(e.data));
		return () => source.close();
	}

	get paused(): boolean {
		return this.pausedByUser || this.scrolledAway;
	}

	togglePause(): void {
		this.pausedByUser = !this.pausedByUser;
		this.#releaseIfLive();
	}

	/** Called on every scroll event: only acts on a change. */
	setScrolledAway(away: boolean): void {
		if (away === this.scrolledAway) return;
		this.scrolledAway = away;
		this.#releaseIfLive();
	}

	/** No longer paused: show what arrived in the meantime. */
	#releaseIfLive(): void {
		if (this.paused) return;
		this.items = [...this.#heldItems, ...this.items].slice(0, this.#maxItems);
		this.#heldItems = [];
		this.held = 0;
	}

	#receive(update: StreamUpdate): void {
		if (this.update && update.since !== this.update.since) {
			this.reset();
			this.items = [];
			this.#heldItems = [];
			this.held = 0;
		}
		this.update = update;
		const fresh = this.process(update.frames, update).reverse();
		if (fresh.length === 0) return;
		if (this.paused) {
			this.#heldItems = [...fresh, ...this.#heldItems].slice(0, this.#maxItems);
			this.held = this.#heldItems.length;
		} else {
			this.items = [...fresh, ...this.items].slice(0, this.#maxItems);
		}
	}
}
