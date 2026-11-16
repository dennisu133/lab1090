import { LiveFeed } from '#lib/live-feed.svelte.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { fromHex } from '#lib/modes/frame.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import type { Observation } from '#lib/weather/observation.ts';
import { applyHeadingChecks, headingChecks, type HeadingCheck } from '#lib/weather/headings.ts';
import { WeatherPipeline } from '#lib/weather/pipeline.ts';
import type { WindSample } from '#lib/weather/profile.ts';
import type { SkySamples } from '#lib/weather/sky.ts';
import type { WeatherAircraft } from '#lib/weather/tracker.ts';

export interface ObservationRow {
	/** The id of the frame that completed the pair: unique, a stable key. */
	id: number;
	callsign: string | null;
	observation: Observation;
}

const MAX_ROWS = 2000;
/** Beast timestamps count at 12 MHz. */
const TICKS_PER_MS = 12_000;

/**
 * /weather's view of the live stream: every 5,0/6,0 pair as an observation (the feed), per
 * aircraft the latest wind and temperature (lib/weather/tracker.ts), and for the "Now" tab
 * the samples of the last half hour (lib/weather/sky.ts). It collects as long as the app is
 * open, whichever page is shown (routes/streams.ts); a reload starts it empty.
 */
export class WeatherStream extends LiveFeed<ObservationRow> {
	aircraft = $state.raw<WeatherAircraft[]>([]);
	/** The latest frame's time (server clock): "now" for ages. */
	now = $state(0);
	/** Samples for the "Now" tab; a new object whenever one is added or dropped. */
	sky = $state.raw<SkySamples>({
		temperatures: [],
		winds: [],
		columns: [],
		settings: [],
		turns: []
	});
	/**
	 * Each aircraft's wind against the others' (lib/weather/headings.ts), and the winds with
	 * the clearly-off headings corrected: what the tracker map draws, and what /weather
	 * uses unless switched to "as sent". Computed only while a page reads them.
	 */
	checks: Map<string, HeadingCheck> = $derived(headingChecks(this.sky.winds));
	correctedWinds: WindSample[] = $derived(applyHeadingChecks(this.sky.winds, this.checks));
	/** When the first frame arrived (server clock): how long we've been collecting. */
	since = $state<number | null>(null);

	#reference: () => LatLon;
	#pipeline: WeatherPipeline;

	constructor(reference: () => LatLon) {
		super(MAX_ROWS);
		this.#reference = reference;
		this.#pipeline = new WeatherPipeline(reference);
	}

	/** The receiver's position, for maps around it. */
	get reference(): LatLon {
		return this.#reference();
	}

	protected reset(): void {
		this.#pipeline = new WeatherPipeline(this.#reference);
		this.aircraft = [];
		this.now = 0;
		this.sky = this.#pipeline.sky.samples;
		this.since = null;
	}

	protected process(frames: WireFrame[]): ObservationRow[] {
		if (frames.length === 0) return [];
		const rows: ObservationRow[] = [];
		for (const f of frames) {
			const o = this.#pipeline.add(fromHex(f.hex), f.addr, f.rx, f.ts / TICKS_PER_MS);
			if (o) rows.push({ id: f.id, callsign: null, observation: o });
		}
		const now = frames.at(-1)!.rx;
		this.#pipeline.prune(now);
		this.aircraft = this.#pipeline.tracker.list();
		const callsigns = Object.fromEntries(this.aircraft.map((a) => [a.icao, a.callsign]));
		for (const r of rows) r.callsign = callsigns[r.observation.icao] ?? null;
		this.now = now;
		this.since ??= frames[0].rx;
		if (this.#pipeline.sky.samples !== this.sky) this.sky = this.#pipeline.sky.samples;
		return rows;
	}
}
