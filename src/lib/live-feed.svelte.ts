import type { StreamUpdate, WireFrame } from '#lib/receiver-types.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';

/**
 * One page's view of the live stream: keeps a list of recent items (newest first), and can
 * pause the list without losing what arrives meanwhile. The updates come from the app's one
 * StreamConnection, which feeds every page's view all the time, also while another page is
 * shown (see routes/streams.ts).
 *
 * Two things pause it: a click on the list's heading, and scrolling down into the list (see
 * LiveHeading.svelte). New items go on top, so while you read further down they would push
 * the rows you're reading away. The list resumes when you scroll back up, unless the
 * click paused it too.
 *
 * What an item is depends on the page: subclasses turn each batch of frames into items.
 * Views that aren't a list (the tracker, the radars, the coverage) are plain UpdateListeners.
 */
export abstract class LiveFeed<T> implements UpdateListener {
	/** Newest first. */
	items = $state.raw<T[]>([]);

	/** Paused with a click on the heading. */
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

	/**
	 * The server restarted (e.g. dev reload): the list starts over. Subclasses that keep
	 * more forget that too, and call this.
	 */
	reset(): void {
		this.items = [];
		this.#heldItems = [];
		this.held = 0;
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

	/** An update from the StreamConnection: every frame once, in arrival order. */
	receive(update: StreamUpdate): void {
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
