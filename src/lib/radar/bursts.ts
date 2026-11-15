/**
 * Bursts: the replies an aircraft gives one radar while its beam sweeps past, joined into
 * one sighting with the aircraft's position at that moment.
 *
 * DF11, the all-call reply, carries who asked: its parity field is the CRC XOR the
 * interrogator code (II 0–15 or SI 1–63, crc.ts), so every reply names the radar it
 * answers. A rotating radar's beam is about 2.4° wide: at 12 rpm (72°/s) it covers an
 * aircraft for ~33 ms, at 6 rpm for ~67 ms, and asks a few times meanwhile ("hits per
 * scan"). The replies of one sweep are milliseconds apart, those of the next a whole turn
 * later (capture, SI 44: 0.01–0.04 s, then ~5 s), so a gap of BURST_GAP_MS tells them
 * apart. The burst's time is the mean of its replies': the middle of the beam.
 *
 * II 0 is left out: aircraft send DF11 with II 0 on their own about once a second
 * ("acquisition squitter"), so those aren't answers to anyone's beam.
 *
 * The position comes from ADS-B (the tracker's believed positions), interpolated to the
 * burst's time between the positions before and after it: at 250 m/s, an aircraft moves
 * 1 km between positions 4 s apart, a tenth of a degree seen from 500 km. So a burst waits
 * for its aircraft's next position; aircraft without ADS-B positions give none.
 */

/** Replies further apart than this are separate sweeps of the beam, ms. */
export const BURST_GAP_MS = 150;
/** Interpolate only between positions at most this far apart, ms. */
const MAX_POSITION_GAP_MS = 10_000;
/** A burst waits this long for the next position before it's given up, ms. */
const MAX_WAIT_MS = 15_000;
/** Positions are kept this long, ms: enough to bracket the bursts still waiting. */
const KEEP_POSITIONS_MS = 30_000;

/** A burst of replies to one radar code, with where the aircraft was. */
export interface Burst {
	/** "SI 44" */
	code: string;
	icao: string;
	/** The middle of the burst: receiver clock (Beast timestamps), ms. */
	t: number;
	/** The same moment on the server's clock (ms since epoch). */
	rx: number;
	/** How many replies it holds. */
	replies: number;
	lat: number;
	lon: number;
}

interface Open {
	code: string;
	icao: string;
	sumT: number;
	sumRx: number;
	replies: number;
	/** The last reply's receiver time, ms. */
	last: number;
}

type Waiting = Omit<Burst, 'lat' | 'lon'>;

interface Fix {
	rx: number;
	lat: number;
	lon: number;
}

/**
 * Collects replies and positions, in arrival order, and hands out finished bursts with
 * their positions (`take`).
 */
export class BurstCollector {
	// Plain Maps: bookkeeping inside a class that isn't rendered.
	#open = new Map<string, Open>();
	#waiting: Waiting[] = [];
	#positions = new Map<string, Fix[]>();
	#done: Burst[] = [];
	/** The newest reply's receiver time, ms. */
	#latest = -Infinity;

	/** A DF11 reply to `code` from `icao`; t: receiver clock, rx: server clock, ms. */
	reply(code: string, icao: string, t: number, rx: number): void {
		this.#latest = Math.max(this.#latest, t);
		const key = `${code} ${icao}`;
		const open = this.#open.get(key);
		if (open && t - open.last <= BURST_GAP_MS) {
			open.sumT += t;
			open.sumRx += rx;
			open.replies++;
			open.last = t;
			return;
		}
		if (open) this.#close(open);
		this.#open.set(key, { code, icao, sumT: t, sumRx: rx, replies: 1, last: t });
	}

	/** A position the tracker believed. */
	position(icao: string, rx: number, lat: number, lon: number): void {
		const list = this.#positions.get(icao) ?? [];
		if (list.length && rx < list[list.length - 1].rx) return; // never out of order
		list.push({ rx, lat, lon });
		this.#positions.set(icao, list);
	}

	/**
	 * The bursts that are complete and have their position, oldest first. `rx`: the server's
	 * clock now, for what to give up on.
	 */
	take(rx: number): Burst[] {
		for (const [key, open] of this.#open)
			if (this.#latest - open.last > BURST_GAP_MS) {
				this.#close(open);
				this.#open.delete(key);
			}
		const still: Waiting[] = [];
		for (const w of this.#waiting) {
			const at = this.#at(w.icao, w.rx);
			if (at) this.#done.push({ ...w, ...at });
			else if (at === undefined && rx - w.rx <= MAX_WAIT_MS) still.push(w);
		}
		this.#waiting = still;
		for (const [icao, list] of this.#positions) {
			const keep = list.filter((p) => rx - p.rx <= KEEP_POSITIONS_MS);
			if (keep.length) this.#positions.set(icao, keep);
			else this.#positions.delete(icao);
		}
		const done = this.#done.sort((a, b) => a.t - b.t);
		this.#done = [];
		return done;
	}

	#close(open: Open): void {
		this.#waiting.push({
			code: open.code,
			icao: open.icao,
			t: open.sumT / open.replies,
			rx: open.sumRx / open.replies,
			replies: open.replies
		});
	}

	/**
	 * The aircraft's position at `rx`: interpolated; undefined: not yet (no later position);
	 * null: never (no earlier one, or too far apart).
	 */
	#at(icao: string, rx: number): { lat: number; lon: number } | null | undefined {
		const list = this.#positions.get(icao);
		if (!list?.length || list[0].rx > rx) return list?.length ? null : undefined;
		const after = list.findIndex((p) => p.rx >= rx);
		if (after === -1) return undefined;
		const b = list[after];
		if (b.rx === rx) return { lat: b.lat, lon: b.lon };
		const a = list[after - 1];
		if (b.rx - a.rx > MAX_POSITION_GAP_MS) return null;
		const f = (rx - a.rx) / (b.rx - a.rx);
		return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
	}
}
