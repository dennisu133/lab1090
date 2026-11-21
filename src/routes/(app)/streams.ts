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
import { GnssStream } from './gnss-stream.svelte';
import { RadarStream } from './radar-stream.svelte';
import { RadioStream } from './receiver/radio-stream.svelte';
import { SignalStream } from './receiver/signal-stream.svelte';
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
	/** The server's message counts and the rates: for the navigation bar, /frames and /receiver. */
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
	/** Satellite navigation (experimental map layer): collects from the start, it's cheap. */
	readonly gnss: GnssStream;
	/**
	 * The server's hour of receiver history (/receiver, the navigation bar's message rate) and
	 * the demodulator's numbers.
	 */
	readonly radio = new RadioStream();
	/** /receiver: signal against distance, from the tracker's positions. */
	readonly signal: SignalStream;
	#connection: StreamConnection;

	/** `reference`: the receiver's position (the page data, from the server's settings). */
	constructor(reference: () => LatLon) {
		this.tracker = new TrackerStream(reference);
		this.frames = new FrameStream(reference);
		this.commB = new CommBStream();
		this.weather = new WeatherStream(reference);
		this.alerts = new AlertCenter(this.tracker, (icao) => this.show(icao));
		this.radars = new RadarStream(this.tracker);
		this.coverage = new CoverageStream(this.tracker, reference);
		this.gnss = new GnssStream(this.tracker, reference);
		this.signal = new SignalStream(this.tracker, reference);
		this.#connection = new StreamConnection('/api/stream', [
			// First: /setup changed the position while this tab was open. Everything decoded
			// with the old one is wrong (coverage, ground positions, distances, declination):
			// start over with a reload rather than reset each view.
			{
				receive: ({ reference: now }) => {
					const then = reference();
					if (now && (now.lat !== then.lat || now.lon !== then.lon)) location.reload();
				}
			},
			this.stats,
			this.tracker,
			this.alerts, // after the tracker: reads what it made of the update
			this.radars, // the same
			this.coverage, // the same: reads the trails
			this.signal, // the same: reads the positions
			this.gnss, // the same
			this.radio,
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
		goto(resolve('/(app)'));
	}
}

export const [getStreams, setStreams] = createContext<Streams>();
