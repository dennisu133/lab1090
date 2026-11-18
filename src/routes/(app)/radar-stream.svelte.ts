import { downlinkFormat, fromHex } from '#lib/modes/frame.ts';
import { codeName, RadarFinder, type CodeSummary, type Radar } from '#lib/radar/finder.ts';
import type { StreamUpdate } from '#lib/receiver-types.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';
import type { TrackerStream } from './tracker-stream.svelte';

/** Beast timestamps count at 12 MHz. */
const TICKS_PER_MS = 12_000;
/** The list of codes heard is refreshed this often, ms. */
const CODES_MS = 5000;

/**
 * The ground radars' view of the live stream (the tracker's experimental Radars layer):
 * every DF11 reply and every position the tracker believes, into a RadarFinder
 * (lib/radar/finder.ts).
 *
 * A stream listener after the tracker (streams.ts), like the alerts: it reads the positions
 * the tracker made of the same update. ADS-B positions come twice a second and an update
 * every 250 ms, so the latest per aircraft is every one of them.
 *
 * It only runs while the layer is switched on (`start`, `stop`), unlike the other views: it
 * costs more CPU than all of them together (~2–4 s per 10 minutes of quiet traffic, ~44 s an
 * hour when busy) and it's an experiment. Once on it keeps going on every page, so the radars
 * found survive a look at /weather. Switched off, it forgets them. Radars appear after a few
 * minutes: the server's history holds only ~20 s of replies.
 */
export class RadarStream implements UpdateListener {
	/** The confirmed radars: shown on the map. */
	radars = $state.raw<Radar[]>([]);
	/** Found, not confirmed yet: listed, not drawn. */
	candidates = $state.raw<Radar[]>([]);
	/** Every interrogator code heard lately, located or not. */
	codes = $state.raw<CodeSummary[]>([]);
	/** When it started (server clock); null: off. */
	started = $state<number | null>(null);

	#tracker: TrackerStream;
	#finder = new RadarFinder();
	#codesAt = 0;
	/** The time of the last position handed on, per aircraft. */
	// Plain Map on purpose: bookkeeping, never rendered.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#fed = new Map<string, number>();

	constructor(tracker: TrackerStream) {
		this.#tracker = tracker;
	}

	/** Start collecting (the layer switch calls it; again is harmless). */
	start(): void {
		this.started ??= this.#tracker.now();
	}

	/** Stop collecting and forget what was found: off costs nothing. */
	stop(): void {
		if (this.started === null) return;
		this.started = null;
		this.reset();
	}

	/** The server's clock, as the tracker keeps it. */
	now(): number {
		return this.#tracker.now();
	}

	get(id: string | null): Radar | null {
		return id === null ? null : (this.radars.find((r) => r.id === id) ?? null);
	}

	reset(): void {
		this.#finder = new RadarFinder();
		this.#fed.clear();
		this.radars = [];
		this.candidates = [];
		this.codes = [];
		if (this.started !== null) this.started = this.#tracker.now();
	}

	receive({ frames }: StreamUpdate): void {
		if (this.started === null || frames.length === 0) return;
		for (const f of frames) {
			// DF11 names the radar it answers (crc.ts): the finder's input.
			if (f.addr?.verdict !== 'valid') continue;
			if (downlinkFormat(fromHex(f.hex)) !== 11) continue;
			const code = codeName(f.addr.interrogator);
			if (code) this.#finder.reply(code, f.addr.icao, f.ts / TICKS_PER_MS, f.rx);
		}
		for (const a of this.#tracker.aircraft) {
			const p = a.position;
			if (!p || p.t <= (this.#fed.get(a.icao) ?? -Infinity)) continue;
			this.#fed.set(a.icao, p.t);
			this.#finder.position(a.icao, p.t, p.lat, p.lon);
		}
		for (const icao of this.#fed.keys()) if (!this.#tracker.get(icao)) this.#fed.delete(icao);

		const rx = frames.at(-1)!.rx;
		const changed = this.#finder.update(rx);
		if (changed) this.radars = this.#finder.radars;
		if (changed || rx - this.#codesAt >= CODES_MS) {
			this.#codesAt = rx;
			this.candidates = this.#finder.candidates;
			this.codes = this.#finder.codes;
		}
	}
}
