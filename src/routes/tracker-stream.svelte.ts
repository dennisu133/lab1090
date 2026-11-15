import type { Field } from '#lib/describe/field.ts';
import { describe } from '#lib/describe/frame.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import { mergeFrames } from '#lib/merge-frames.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import {
	DF_NAMES,
	downlinkFormat,
	fromHex,
	signalDbfs,
	typeCode,
	typeCodeName
} from '#lib/modes/frame.ts';
import type { StreamUpdate, WireFrame } from '#lib/receiver-types.ts';
import { Tracker, type TrackedAircraft } from '#lib/tracker/tracker.ts';

/** One message of the selected aircraft, decoded for the detail panel's feed. */
export interface Message {
	id: number;
	rx: number;
	/** "DF17 · TC 11", with the full names in `title`. */
	kind: string;
	title: string;
	dbfs: number;
	fields: Field[];
}

/** How many of each aircraft's latest messages are kept, for its feed in the panel. */
const MESSAGES = 40;

/**
 * The tracker page's view of the live stream: every frame goes into a Tracker
 * (lib/tracker), which keeps the picture of the sky the map draws.
 *
 * The stream's first update also holds the last 10 minutes of positions (see TrackHistory
 * on the server). Only this view merges them in, so the trails are there right away.
 */
export class TrackerStream extends LiveFeed<never> {
	/** Every aircraft heard in the last minute (Tracker snapshots). */
	aircraft = $state.raw<TrackedAircraft[]>([]);
	/** The aircraft whose details are open; null: none. */
	selected = $state<string | null>(null);
	/** The selected aircraft's latest messages, newest first. */
	messages = $state.raw<Message[]>([]);

	#receiver: () => LatLon | null;
	#tracker: Tracker;
	// Plain Map on purpose: bookkeeping, never rendered (`messages` holds what is).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#recent = new Map<string, WireFrame[]>();
	/** The server's clock at the newest frame, and when (performance.now()) that arrived. */
	#clock: { rx: number; at: number } | null = null;

	constructor(receiver: () => LatLon | null) {
		super(0);
		this.#receiver = receiver;
		this.#tracker = new Tracker(receiver);
	}

	/**
	 * The server's clock now, ms: frames are timed by it, and the map moves aircraft along
	 * from their last position by the time since (dead reckoning). The browser's own clock
	 * may differ from the server's, so this counts on from the newest frame instead. It runs
	 * up to one batch (250 ms) behind the server; that doesn't show.
	 */
	now(): number {
		if (!this.#clock) return Date.now();
		return this.#clock.rx + (performance.now() - this.#clock.at);
	}

	select(icao: string | null): void {
		this.selected = icao;
		this.#showMessages();
	}

	get(icao: string | null): TrackedAircraft | null {
		return icao === null ? null : (this.aircraft.find((a) => a.icao === icao) ?? null);
	}

	protected reset(): void {
		this.#tracker = new Tracker(this.#receiver);
		this.#recent.clear();
		this.#clock = null;
		this.aircraft = [];
		this.messages = [];
	}

	protected process(recent: WireFrame[], update: StreamUpdate): never[] {
		const frames = update.tracks ? mergeFrames(update.tracks, recent) : recent;
		if (frames.length === 0) return [];
		for (const f of frames) {
			const data = fromHex(f.hex);
			if (!this.#tracker.add(data, f.addr, f.rx, signalDbfs(f.sig))) continue;
			const icao = f.addr!.icao;
			const recent = this.#recent.get(icao) ?? [];
			recent.push(f);
			if (recent.length > MESSAGES) recent.shift();
			this.#recent.set(icao, recent);
		}
		const rx = frames.at(-1)!.rx;
		// Never backwards: aircraft would jump back along their track.
		const now = Math.max(rx, this.#clock ? this.now() : rx);
		this.#clock = { rx: now, at: performance.now() };
		this.#tracker.prune(rx);
		for (const icao of this.#recent.keys()) if (!this.#tracker.get(icao)) this.#recent.delete(icao);
		this.aircraft = this.#tracker.list();
		this.#showMessages();
		return [];
	}

	#showMessages(): void {
		const frames = this.selected ? (this.#recent.get(this.selected) ?? []) : [];
		this.messages = frames.toReversed().map((f) => {
			const data = fromHex(f.hex);
			const df = downlinkFormat(data);
			const tc = df === 17 ? typeCode(data) : null;
			return {
				id: f.id,
				rx: f.rx,
				kind: tc === null ? `DF${df}` : `DF${df} · TC ${tc}`,
				title: tc === null ? DF_NAMES[df] : `${DF_NAMES[df]}: ${typeCodeName(tc)}`,
				dbfs: signalDbfs(f.sig),
				fields: describe(data)
			};
		});
	}
}
