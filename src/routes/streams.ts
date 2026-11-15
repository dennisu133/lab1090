import { createContext } from 'svelte';
import type { LatLon } from '#lib/modes/cpr.ts';
import { StreamConnection } from '#lib/stream-connection.ts';
import { CommBStream } from './comm-b/comm-b-stream.svelte';
import { FrameStream } from './frames/frame-stream.svelte';
import { TrackerStream } from './tracker-stream.svelte';
import { WeatherStream } from './weather/weather-stream.svelte';

/**
 * Every page's view of the live stream, created once by the root layout and fed by one
 * connection. So they all collect from the moment the app opens, whichever page is shown:
 * switching from the map to /weather and back loses nothing. Each view decodes every frame
 * itself (the server only checks CRCs), which costs little: the four together take ~2 s of
 * CPU for 10 minutes of the capture's traffic (~57 frames/s).
 */
export class Streams {
	readonly tracker: TrackerStream;
	readonly frames: FrameStream;
	readonly commB: CommBStream;
	readonly weather: WeatherStream;
	#connection: StreamConnection;

	/** `reference`: the receiver's position (RECEIVER_POSITION), if set. */
	constructor(reference: () => LatLon | null) {
		this.tracker = new TrackerStream(reference);
		this.frames = new FrameStream(reference);
		this.commB = new CommBStream();
		this.weather = new WeatherStream(reference);
		this.#connection = new StreamConnection('/api/stream', [
			this.tracker,
			this.frames,
			this.commB,
			this.weather
		]);
	}

	/** Open the connection; returns a cleanup function (use from an $effect). */
	connect(): () => void {
		return this.#connection.connect();
	}
}

export const [getStreams, setStreams] = createContext<Streams>();
