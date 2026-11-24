import { downlinkFormat, fromHex } from '#lib/modes/frame.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { observe } from '#lib/gnss/observe.ts';
import {
	GnssWatch,
	type Cell,
	type CellAircraft,
	type Change,
	type Stretch,
	type Watched
} from '#lib/gnss/watch.ts';
import type { StreamUpdate } from '#lib/receiver-types.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import type { TrackerStream } from './tracker-stream.svelte';

/** The changes, stretches and aircraft are handed to the page this often, ms. */
const PUBLISH_MS = 2000;
/** The cells, less often: they change slowly, and there are hundreds. */
const CELLS_MS = 10_000;

/**
 * The satellite navigation of every aircraft heard (the tracker's experimental GNSS layer
 * and its panel): every ADS-B airborne position, judged, into a GnssWatch (lib/gnss/watch.ts).
 *
 * A stream listener after the tracker (streams.ts), like the radars: it reads where the
 * tracker put each aircraft. It collects from the start, on every page, like the coverage:
 * a few comparisons per message (the hour of oracle/local/capture-1h.beast takes ~0.1 s),
 * and interference is rare, so the hours before the layer was switched on count too.
 */
export class GnssStream implements UpdateListener {
	changes = $state.raw<Change[]>([]);
	stretches = $state.raw<Stretch[]>([]);
	cells = $state.raw<Cell[]>([]);
	/** Every aircraft heard within the last minutes, as the watch judged it. */
	aircraft = $state.raw<Watched[]>([]);
	totals = $state.raw({ aircraft: 0, degraded: 0 });
	/** When the first position came in (server clock); null: none yet. */
	first = $state<number | null>(null);

	#tracker: TrackerStream;
	#receiver: () => LatLon;
	#watch: GnssWatch | null = null;
	#publishedAt = -Infinity;
	#cellsAt = -Infinity;
	/** The watch's versions last copied: unchanged, the page keeps the same arrays. */
	#changesVersion = -1;
	#stretchesVersion = -1;

	constructor(tracker: TrackerStream, receiver: () => LatLon) {
		this.#tracker = tracker;
		this.#receiver = receiver;
	}

	/** The aircraft heard in a cell, degraded ones first. */
	cellAircraft(key: string): CellAircraft[] {
		return this.#watch?.cellAircraft(key) ?? [];
	}

	reset(): void {
		this.#watch = null;
		this.#publishedAt = -Infinity;
		this.#cellsAt = -Infinity;
		this.#changesVersion = -1;
		this.#stretchesVersion = -1;
		this.changes = [];
		this.stretches = [];
		this.cells = [];
		this.aircraft = [];
		this.totals = { aircraft: 0, degraded: 0 };
		this.first = null;
	}

	receive({ frames }: StreamUpdate): void {
		if (frames.length === 0) return;
		const watch = (this.#watch ??= new GnssWatch(this.#receiver()));
		let byIcao: Map<string, TrackedAircraft> | null = null;
		for (const f of frames) {
			if (f.addr?.verdict !== 'valid') continue;
			const data = fromHex(f.hex);
			if (downlinkFormat(data) !== 17) continue;
			// The tracker's snapshot after this update: see lib/gnss/observe.ts.
			// Plain Map on purpose: a lookup for this update, never rendered.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			byIcao ??= new Map(this.#tracker.aircraft.map((a) => [a.icao, a]));
			const a = byIcao.get(f.addr.icao);
			const o = a && observe(a, data, f.rx);
			if (o) watch.add(o);
		}
		const now = frames.at(-1)!.rx;
		if (now - this.#publishedAt < PUBLISH_MS) return;
		this.#publishedAt = now;
		watch.prune(now);
		if (watch.changesVersion !== this.#changesVersion) {
			this.#changesVersion = watch.changesVersion;
			this.changes = watch.changes();
		}
		if (watch.stretchesVersion !== this.#stretchesVersion) {
			this.#stretchesVersion = watch.stretchesVersion;
			this.stretches = watch.stretches();
		}
		this.aircraft = watch.aircraft();
		this.first = watch.first;
		if (now - this.#cellsAt >= CELLS_MS) {
			this.#cellsAt = now;
			this.cells = watch.cells();
			this.totals = watch.totals();
		}
	}
}
