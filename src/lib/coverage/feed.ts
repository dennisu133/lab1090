/**
 * From the tracker to the coverage: every confirmed airborne trail point not fed before.
 *
 * The trails, not the latest positions: the stream's first update brings the server's last
 * 10 minutes as trails (TrackHistory), so the coverage starts with those. Only for the
 * aircraft still in view, though: the tracker drops the ones gone for a minute, trails and
 * all, before the coverage sees them. A trail segment's
 * points count once it has two (the second agreed with the first: tracker/positions.ts).
 * Trails keep a point every 4 s, and their head moves along with the aircraft in between, so
 * fed after every update this sees every position at the update rate.
 */
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import type { Coverage } from './coverage';

export class CoverageFeed {
	/** The newest trail point fed, per aircraft. */
	#fed = new Map<string, number>();

	/** Feed what's new in the tracker's aircraft. Returns whether an extreme changed. */
	add(coverage: Coverage, aircraft: readonly TrackedAircraft[]): boolean {
		let changed = false;
		const present = new Set<string>();
		for (const a of aircraft) {
			present.add(a.icao);
			const fed = this.#fed.get(a.icao) ?? -Infinity;
			let newest = fed;
			for (const segment of a.trail) {
				if (segment.length < 2 || segment.at(-1)!.t <= fed) continue;
				for (const p of segment) {
					if (p.t <= fed) continue;
					newest = Math.max(newest, p.t);
					if (p.ground || p.altitude === null) continue;
					if (coverage.add(a.icao, p.t, p, p.altitude)) changed = true;
				}
			}
			if (newest > fed) this.#fed.set(a.icao, newest);
		}
		// Aircraft the tracker dropped: a new trail starts from nothing if it comes back.
		for (const icao of this.#fed.keys()) if (!present.has(icao)) this.#fed.delete(icao);
		return changed;
	}
}
