import type { Checked, Verdict } from '#lib/modes/address-filter.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** Shape of the messages on the /api/stream Server-Sent Events stream. Shared by server and page. */

/**
 * The server's link to the receiver (a FrameSource: the RTL-SDR, rtl_tcp, a Beast feed), for
 * the status in the navigation bar. `ended`: a recording (--samples) has played to its end.
 */
export type SourceStatus =
	| { state: 'connecting'; attempt: number }
	| { state: 'connected' }
	| { state: 'waiting'; retryInMs: number; reason: string }
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

export interface StreamUpdate {
	status: SourceStatus;
	/** Where the messages come from, e.g. "RTL-SDR 0" or "pi:30005" (settings.ts describeSource). */
	source: string;
	/** When the counting started (server start), ms since epoch. */
	since: number;
	counts: ReceiverCounts;
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
