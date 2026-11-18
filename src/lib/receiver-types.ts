import type { DemodulatorStats } from '#lib/demod/demodulator.ts';
import type { Checked, Verdict } from '#lib/modes/address-filter.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** Shape of the messages on the /api/stream Server-Sent Events stream. Shared by server and page. */

/**
 * The server's link to the receiver (a FrameSource: the RTL-SDR, rtl_tcp, a Beast feed), for
 * the status in the navigation bar. `ended`: a recording (--samples) has played to its end.
 */
export type SourceStatus =
	| { state: 'connecting' }
	| { state: 'connected' }
	/** `retryInMs`: the backoff; `retryAt`: when the next try starts (server's Date.now()). */
	| { state: 'waiting'; retryInMs: number; retryAt: number; reason: string }
	| { state: 'ended' }
	| { state: 'closed' };

export interface WireFrame {
	/** Sequence number, unique per server run (a stable key for lists). */
	id: number;
	/** Wall-clock time the server received the frame (ms since epoch). */
	rx: number;
	/** Receiver timestamp, 12 MHz ticks. */
	ts: number;
	/** Raw Beast signal byte. */
	sig: number;
	/** The Mode S message as hex. */
	hex: string;
	/**
	 * Sender and parity verdict, from the server (it remembers which aircraft were heard
	 * recently; a single browser tab can't know that). null for formats without an address.
	 */
	addr: Checked | null;
}

export interface ReceiverCounts {
	total: number;
	byDf: Record<number, number>;
	/** DF17 type codes. */
	byTc: Record<number, number>;
	/** Signal levels in 3 dB buckets, keyed by the lower edge in dBFS (see signalBucket). */
	bySignal: Record<number, number>;
	/** Parity check results. */
	byVerdict: Partial<Record<Verdict, number>>;
}

/** The dongle's sample clock against the server's (server/sdr/sample-clock.ts). */
export interface ClockReport {
	/** How long this run has been measured, s. */
	seconds: number;
	/** The crystal's error, parts per million (+: fast); null until there are 3 windows. */
	ppm: number | null;
	/** Its standard error, ppm. */
	ppmError: number | null;
	/** Samples lost in this run, as time (ms; × 2,400 for samples). */
	lostMs: number;
	/** How many times samples were lost. */
	gaps: number;
}

/** The dongle, as far as its programs tell (rtl_sdr's messages, rtl_tcp's header). */
export interface DeviceInfo {
	/** The tuner chip, e.g. "Rafael Micro R820T"; null: not known (yet). */
	tuner: string | null;
	/** The USB device's name and serial number (rtl_sdr only). */
	name: string | null;
	serial: string | null;
	/** Gain in dB: rtl_sdr's confirmation, else what lab1090 asked for; null: a recording. */
	gain: number | null;
}

/** The demodulator's side of things: only for sources that deliver samples. */
export interface DemodReport {
	/** Totals since the server started, over every run (`level`: the latest). */
	totals: DemodulatorStats;
	/** Time spent demodulating, ms: against totals.samples / 2.4 million s of samples. */
	busyMs: number;
	/** The sample clock of the current run; null for a recording (we pace it ourselves). */
	clock: ClockReport | null;
	/** Samples lost over all runs. */
	lostMs: number;
	gaps: number;
	/** Runs of the sample stream: rtl_sdr starts, rtl_tcp connections. */
	runs: number;
	device: DeviceInfo;
}

/**
 * One 10-second point of the receiver's history (Receiver keeps an hour). Counts, not rates,
 * so points add up over any stretch. Demodulator fields are null for a Beast feed.
 */
export interface RadioPoint {
	/** End of the 10 s, ms since epoch. */
	t: number;
	/** Length of the stretch, ms (the first one after a start can be shorter). */
	ms: number;
	/** Messages that reached the server (all formats, after the address check). */
	messages: number;
	/** Mean noise level over the stretch, dBFS (mean magnitude); null: none measured. */
	noise: number | null;
	/** Demodulator counts over the stretch (differences of DemodulatorStats). */
	candidates: number | null;
	/** Messages the demodulator passed on, and of those, how many reached the ADC's limit. */
	demodulated: number | null;
	clipped: number | null;
	/** Time spent demodulating, ms. */
	busyMs: number | null;
	/** Samples received, for the CPU share and to see gaps (2.4 million a second). */
	samples: number | null;
}

/** A change in the link to the receiver, for the run history. */
export interface SourceEvent {
	/** Unique per server run. */
	id: number;
	/** When it happened (the first time, if repeated), ms since epoch. */
	t: number;
	/** The last time, for a repeated one. */
	last: number;
	state: 'connected' | 'waiting' | 'ended';
	/** Why it's waiting. */
	reason?: string;
	/** The same reason again and again (backoff retries) is one event, counted. */
	count: number;
}

export interface RadioUpdate {
	/** null: a Beast feed (demodulated elsewhere). */
	demod: DemodReport | null;
	/** `full`: the whole history (first update), else the points and events since the last. */
	full: boolean;
	points: RadioPoint[];
	/** Events: in a full update all of them; else the new ones and any whose count grew. */
	events: SourceEvent[];
}

export interface StreamUpdate {
	status: SourceStatus;
	/** Where the messages come from, e.g. "RTL-SDR 0" or "pi:30005" (settings.ts describeSource). */
	source: string;
	/** When the counting started (server start), ms since epoch. */
	since: number;
	counts: ReceiverCounts;
	/** The receiver's own numbers, for /receiver. */
	radio: RadioUpdate;
	/** New frames since the previous update (the first update holds recent history). */
	frames: WireFrame[];
	/**
	 * First update only: the thinned positions of the last 10 minutes (TrackHistory), oldest
	 * first, for the tracker's trails. Only the tracker uses them: the other views would
	 * count 10 minutes of old positions as new frames. Partly the same frames as
	 * `frames` (same ids): mergeFrames joins the two.
	 */
	tracks?: WireFrame[];
	/**
	 * First update only: the receiver's position as the server has it now. A tab that was
	 * loaded with another one reloads (streams.ts): /setup changed it, and everything decoded
	 * with the old one (coverage, ground positions, distances) would be wrong.
	 */
	reference?: LatLon | null;
}

/** Answer of /api/frames: stored frames matching a filter, oldest first. */
export interface FramesResponse {
	/** Server start, like StreamUpdate.since: frame ids only compare within one run. */
	since: number;
	frames: WireFrame[];
}
