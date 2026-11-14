import { LiveFeed } from '#lib/live-feed.svelte.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { fromHex } from '#lib/modes/frame.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import type { Observation } from '#lib/weather/observation.ts';
import { WeatherPipeline } from '#lib/weather/pipeline.ts';
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
 * /weather's view of the live stream: every 5,0/6,0 pair as an observation (the feed), and
 * per aircraft the latest wind and temperature (lib/weather/tracker.ts).
 */
export class WeatherStream extends LiveFeed<ObservationRow> {
	aircraft = $state.raw<WeatherAircraft[]>([]);
	/** The latest frame's time (server clock): "now" for ages. */
	now = $state(0);

	#reference: () => LatLon | null;
	#pipeline: WeatherPipeline;

	constructor(reference: () => LatLon | null) {
		super(MAX_ROWS);
		this.#reference = reference;
		this.#pipeline = new WeatherPipeline(reference);
	}

	protected reset(): void {
		this.#pipeline = new WeatherPipeline(this.#reference);
		this.aircraft = [];
		this.now = 0;
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
		return rows;
	}
}
