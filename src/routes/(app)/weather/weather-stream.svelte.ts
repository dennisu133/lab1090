import { trackerContrail, type TrackerContrail } from '#lib/describe/contrail.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { fromHex } from '#lib/modes/frame.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import type { Observation } from '#lib/weather/observation.ts';
import { applyHeadingChecks, headingChecks, type HeadingCheck } from '#lib/weather/headings.ts';
import { WeatherPipeline } from '#lib/weather/pipeline.ts';
import { layerAt, layers, type Layer, type WindSample } from '#lib/weather/profile.ts';
import type { SkySamples } from '#lib/weather/sky.ts';
import type { WeatherAircraft } from '#lib/weather/tracker.ts';

export interface ObservationRow {
	/** The id of the frame that completed the pair: unique, a stable key. */
	id: number;
	callsign: string | null;
	observation: Observation;
}

/** What the tracker panel shows of one aircraft's weather (weatherFor). */
export interface AircraftWeather {
	aircraft: WeatherAircraft;
	check: HeadingCheck | null;
	/** The temperature layer at its level, for the contrail line; null: none. */
	layer: Layer | null;
}

const MAX_ROWS = 2000;
/** Beast timestamps count at 12 MHz. */
const TICKS_PER_MS = 12_000;

/**
 * /weather's view of the live stream: every 5,0/6,0 pair as an observation (the feed), per
 * aircraft the latest wind and temperature (lib/weather/tracker.ts), and for the Profile tab
 * the samples of the last half hour (lib/weather/sky.ts). It collects as long as the app is
 * open, whichever page is shown (routes/streams.ts); a reload starts it empty.
 */
export class WeatherStream extends LiveFeed<ObservationRow> {
	aircraft = $state.raw<WeatherAircraft[]>([]);
	/** The latest frame's time (server clock): "now" for ages. */
	now = $state(0);
	/** Samples for the Profile tab; a new object whenever one is added or dropped. */
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
	/**
	 * The temperature profile alone (/weather's layers without winds and columns): the
	 * contrail answer for one aircraft uses its layer's mean temperature.
	 */
	temperatureLayers: Layer[] = $derived(layers(this.sky.temperatures, [], []));
	/** When the first frame arrived (server clock): how long we've been collecting. */
	since = $state<number | null>(null);

	#reference: () => LatLon;
	#pipeline: WeatherPipeline;

	constructor(reference: () => LatLon) {
		super(MAX_ROWS);
		this.#reference = reference;
		this.#pipeline = new WeatherPipeline(reference);
	}

	/** One aircraft's wind, temperature, heading check and layer (the tracker panel). */
	weatherFor(icao: string | null | undefined): AircraftWeather | null {
		const aircraft = this.#find(icao);
		if (!aircraft) return null;
		return {
			aircraft,
			check: this.checks.get(aircraft.icao) ?? null,
			layer: this.#layerOf(aircraft)
		};
	}

	/**
	 * The tracker panel's contrail answer for one aircraft (/weather/aircraft's worked
	 * example). Unlike weatherFor it doesn't read the heading checks, so they aren't
	 * computed for it.
	 */
	contrailFor(icao: string | null | undefined): TrackerContrail | null {
		const aircraft = this.#find(icao);
		return aircraft ? trackerContrail(aircraft, this.#layerOf(aircraft)) : null;
	}

	#find(icao: string | null | undefined): WeatherAircraft | undefined {
		return icao ? this.aircraft.find((a) => a.icao === icao) : undefined;
	}

	/** The temperature layer at its latest temperature's altitude. */
	#layerOf(a: WeatherAircraft): Layer | null {
		const feet = a.lastTemperature?.inputs.altitude?.feet;
		return feet === undefined ? null : layerAt(this.temperatureLayers, feet);
	}

	/** The receiver's position, for maps around it. */
	get reference(): LatLon {
		return this.#reference();
	}

	override reset(): void {
		super.reset();
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
