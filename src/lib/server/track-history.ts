import { bits } from '#lib/modes/frame.ts';
import type { WireFrame } from '#lib/receiver-types.ts';

/** How far back trails go: the tracker's TRAIL_MS (lib/tracker/trail.ts). */
export const TRACK_HISTORY_MS = 10 * 60_000;
/** Keep a position frame per aircraft this often, alternating the CPR grids (see below). */
export const KEEP_MS = 4_000;
/** Global decoding pairs frames at most this far apart (cpr.ts). */
const PAIR_MS = 10_000;

/**
 * The last 10 minutes of ADS-B position frames, thinned, so the tracker can draw every
 * aircraft's trail the moment a page opens instead of starting from nothing.
 *
 * The frames stay raw: the browser decodes them like live ones (the server only does
 * CRC/address verdicts). The server just looks at three things it can read without decoding:
 * the format (DF17 with a valid CRC), the type code (a position: TC 5–8 on the surface,
 * 9–18 and 20–22 airborne) and the CPR format bit (even or odd grid).
 *
 * Aircraft send a position twice a second; the trail only keeps a point every 4 s
 * (trail.ts). So this keeps one frame per aircraft every KEEP_MS, from the other grid than
 * the one before: then each kept frame pairs with the previous one, 4 s apart, well within
 * the 10 s that global decoding allows (cpr.ts). If no frame from the other grid comes, it
 * takes the same grid after 2 × KEEP_MS (decoded relative to the last position then).
 *
 * An aircraft's first position needs a pair, though, and one heard only briefly may send
 * just a few. So at the start (and after PAIR_MS without a kept frame) the first frame from
 * the other grid is kept right away, whatever its age.
 *
 * At ~20–40 aircraft that's ~3,000–6,000 frames, a few hundred KB of JSON.
 */
export class TrackHistory {
	#frames: WireFrame[] = [];
	/** Per aircraft: when its last frame was kept, from which grid, and if it has a pair yet. */
	#last = new Map<string, { rx: number; odd: boolean; paired: boolean }>();

	/** Every frame, in arrival order; keeps the ones it needs. */
	add(frame: WireFrame, data: Uint8Array, df: number, tc: number | null): void {
		if (df !== 17 || frame.addr?.verdict !== 'valid' || tc === null) return;
		if (!((tc >= 5 && tc <= 18) || (tc >= 20 && tc <= 22))) return;
		const odd = bits(data, 54, 1) === 1; // F: ME bit 22, the same place in both layouts
		const last = this.#last.get(frame.addr.icao);
		const age = last ? frame.rx - last.rx : Infinity;
		let paired = false;
		if (last && age <= PAIR_MS) {
			const completes = !last.paired && odd !== last.odd;
			if (!completes && (age < KEEP_MS || (odd === last.odd && age < 2 * KEEP_MS))) return;
			paired = last.paired || odd !== last.odd;
		}
		this.#last.set(frame.addr.icao, { rx: frame.rx, odd, paired });
		this.#frames.push(frame);
	}

	/** The kept frames, oldest first: the last TRACK_HISTORY_MS as of the latest prune(). */
	get frames(): WireFrame[] {
		return this.#frames;
	}

	/**
	 * Forget frames (and aircraft) older than TRACK_HISTORY_MS. The receiver calls this with
	 * every batch: the history must stay 10 minutes long whether or not a page ever asks for it.
	 */
	prune(now: number): void {
		const from = now - TRACK_HISTORY_MS;
		const keep = this.#frames.findIndex((f) => f.rx >= from);
		if (keep !== 0) this.#frames = keep === -1 ? [] : this.#frames.slice(keep);
		for (const [icao, last] of this.#last) if (last.rx < from) this.#last.delete(icao);
	}
}
