import { createContext } from 'svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { LatLon } from '#lib/modes/cpr.ts';
import { ReceiverStats } from '#lib/receiver-stats.svelte.ts';
import { StreamConnection } from '#lib/stream-connection.ts';
import { AlertCenter } from './alerts.svelte';
import { CommBStream } from './comm-b/comm-b-stream.svelte';
import { CoverageStream } from './coverage-stream.svelte';
import { FrameStream } from './frames/frame-stream.svelte';
import { RadarStream } from './radar-stream.svelte';
import { TrackerStream } from './tracker-stream.svelte';
import { WeatherStream } from './weather/weather-stream.svelte';

/**
 * Every page's view of the live stream, created once by the root layout and fed by one
 * connection. So they all collect from the moment the app opens, whichever page is shown:
 * switching from the map to /weather and back loses nothing. Each view decodes every frame
 * itself (the server only checks CRCs), which costs little: the four together take ~2 s of
 * CPU for 10 minutes of the capture's traffic (~57 frames/s). The radar experiment costs
 * more than that on its own, so it only runs while its map layer is on.
 */
export class Streams {
	/** The server's message counts and the rates: for the navigation bar and /frames. */
	readonly stats = new ReceiverStats();
	readonly tracker: TrackerStream;
	readonly frames: FrameStream;
	readonly commB: CommBStream;
	readonly weather: WeatherStream;
	/** Emergencies and ACAS advisories, from the tracker's picture: banner, notifications. */
	readonly alerts: AlertCenter;
	/** The ground radars (experimental map layer): idle unless that layer is on. */
	readonly radars: RadarStream;
	/** The antenna's coverage (map layer, receiver panel): collects from the start, it's cheap. */
	readonly coverage: CoverageStream;
	#connection: StreamConnection;

	/** `reference`: the receiver's position (RECEIVER_POSITION), if set. */
	constructor(reference: () => LatLon | null) {
		this.tracker = new TrackerStream(reference);
		this.frames = new FrameStream(reference);
		this.commB = new CommBStream();
		this.weather = new WeatherStream(reference);
		this.alerts = new AlertCenter(this.tracker, (icao) => this.show(icao));
		this.radars = new RadarStream(this.tracker);
		this.coverage = new CoverageStream(this.tracker, reference);
		this.#connection = new StreamConnection('/api/stream', [
			this.stats,
			this.tracker,
			this.alerts, // after the tracker: reads what it made of the update
			this.radars, // the same
			this.coverage, // the same: reads the trails
			this.frames,
			this.commB,
			this.weather
		]);
	}

	/** Open the connection; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		this.alerts.notifications.start();
		return this.#connection.connect();
	}

	/** Select an aircraft on the tracker, from whatever page is open. */
	show(icao: string): void {
		this.tracker.select(icao);
		goto(resolve('/'));
	}
}

export const [getStreams, setStreams] = createContext<Streams>();
