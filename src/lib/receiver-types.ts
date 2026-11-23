import type { DemodulatorStats } from '#lib/demod/demodulator.ts';
import type { Checked, Verdict } from '#lib/modes/address-filter.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** Shape of the messages on the /api/stream Server-Sent Events stream. Shared by server and page. */

/**
 * The server's link to the receiver (a FrameSource: the RTL-SDR, rtl_tcp, a Beast feed), for
 * the status in the navigation bar. `ended`: a replay (--replay) has played to its end, or
 * couldn't go on (`reason`).
 */
export type SourceStatus =
	| { state: 'connecting' }
	| { state: 'connected' }
	/** `retryInMs`: the backoff; `retryAt`: when the next try starts (server's Date.now()). */
	| { state: 'waiting'; retryInMs: number; retryAt: number; reason: string }
	| { state: 'ended'; reason?: string }
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
	/**
	 * Gain in dB: rtl_sdr's confirmation, else what lab1090 asked for; for a replay, what its
	 * metadata says. null: not known (a bare .u8).
	 */
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
	/** Why it's waiting, or why a replay ended early. */
	reason?: string;
	/** The same reason again and again (backoff retries) is one event, counted. */
	count: number;
}

export interface RadioUpdate {
	/**
	 * null: a Beast feed (demodulated elsewhere). Absent: as before. Only /receiver reads it,
	 * so it comes once a second (and in a full update), not with every batch.
	 */
	demod?: DemodReport | null;
	/** `full`: the whole history (first update), else the points and events since the last. */
	full: boolean;
	points: RadioPoint[];
	/** Events: in a full update all of them; else the new ones and any whose count grew. */
	events: SourceEvent[];
}

/** What's being played (--replay), for the navigation bar and /receiver. */
export interface ReplayInfo {
	/** The file, as given. */
	file: string;
	/** Samples (demodulated here as they play) or Beast messages (demodulated when recorded). */
	kind: 'samples' | 'beast';
	loop: boolean;
	/** From a SigMF recording's metadata; null: not said (a bare .u8, a Beast file). */
	label: string | null;
	/** The program that recorded it, "lab1090 0.1.0". */
	recorder: string | null;
	/** When it was recorded, ms since epoch. */
	recordedAt: number | null;
}

/** A recording of the samples (--record), for the navigation bar and /receiver. */
export interface RecordingReport {
	/** The file's name, in the directory lab1090 was started in. */
	file: string;
	/**
	 * `waiting`: for the first samples; `finishing`: the last ones are being written;
	 * `failed`: nothing recorded, or the file couldn't be finished (`stopped` says why).
	 */
	state: 'waiting' | 'recording' | 'finishing' | 'saved' | 'failed';
	/** Samples taken so far and planned, as time (ms). */
	ms: number;
	plannedMs: number;
	/** The file's size so far. */
	bytes: number;
	/** Why it ended early; null: it didn't (yet). */
	stopped: string | null;
}

export interface StreamUpdate {
	status: SourceStatus;
	/** The samples' recording, if lab1090 runs with --record. */
	recording?: RecordingReport;
	/**
	 * What --replay plays: in the first update, and again whenever it changes (the metadata
	 * is read once the file is opened). Absent: as before; never there for a live source.
	 */
	replay?: ReplayInfo;
	/**
	 * First update only (it never changes while the server runs): where the messages come
	 * from, e.g. "RTL-SDR 0" or "pi:30005" (settings.ts describeSource).
	 */
	source?: string;
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
