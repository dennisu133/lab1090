import { aircraftElevation } from '#lib/coverage/geometry.ts';
import { distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import type { SignalPoint } from '#lib/radio/path-loss.ts';
import type { StreamUpdate } from '#lib/receiver-types.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';
import { FT } from '#lib/units.ts';
import type { TrackerStream } from '../tracker-stream.svelte';

/** One point per aircraft per this many ms… */
const THIN_MS = 10_000;
/** …kept this long. */
const KEEP_MS = 60 * 60_000;
/** The signal is the latest message's; the position must be at most this much older. */
const FRESH_MS = 3_000;
/** The plot is redrawn at most this often. */
const PUBLISH_MS = 5_000;

/**
 * Signal against distance, for /receiver: every 10 s per aircraft, its latest message's
 * signal level and how far away it was then (the tracker's confirmed airborne positions).
 * A stream listener after the tracker, collecting from the app's start like the coverage
 * (a few sums per update). Browser-only: a reload starts empty.
 */
export class SignalStream implements UpdateListener {
	points = $state.raw<SignalPoint[]>([]);

	#tracker: TrackerStream;
	#receiver: () => LatLon;
	#all: SignalPoint[] = [];
	/** When each aircraft's last point was taken. Plain Map: bookkeeping, never rendered. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#last = new Map<string, number>();
	#publishedAt = -Infinity;

	constructor(tracker: TrackerStream, receiver: () => LatLon) {
		this.#tracker = tracker;
		this.#receiver = receiver;
	}

	/** A new server run (StreamConnection): its frames start over, so do the points. */
	reset(): void {
		this.#all = [];
		this.#last.clear();
		this.points = [];
	}

	receive(update: StreamUpdate): void {
		if (update.frames.length === 0) return;
		const receiver = this.#receiver();
		for (const a of this.#tracker.aircraft) {
			const p = a.position;
			if (!p || !a.confirmed || p.surface || a.signal === null) continue;
			if (a.lastSeen - p.t > FRESH_MS) continue;
			if (a.lastSeen - (this.#last.get(a.icao) ?? -Infinity) < THIN_MS) continue;
			this.#last.set(a.icao, a.lastSeen);
			const ground = distanceKm(receiver, p);
			const altitude = a.altitude?.value ?? null;
			this.#all.push({
				t: a.lastSeen,
				icao: a.icao,
				// Along the line of sight: at 10 km, FL350 is 4.6 km (3 dB) farther than the map
				// distance. (A flat triangle is plenty: the Earth's curve matters only far out,
				// where the height adds next to nothing.)
				km: altitude === null ? ground : Math.hypot(ground, (altitude * FT) / 1000),
				dbfs: a.signal,
				elevation: altitude === null ? null : aircraftElevation(ground, altitude)
			});
		}
		const now = update.frames.at(-1)!.rx;
		if (now - this.#publishedAt < PUBLISH_MS) return;
		this.#publishedAt = now;
		const from = this.#all.findIndex((s) => s.t >= now - KEEP_MS);
		if (from > 0) this.#all = this.#all.slice(from);
		for (const [icao, t] of this.#last) if (t < now - KEEP_MS) this.#last.delete(icao);
		this.points = [...this.#all];
	}
}
