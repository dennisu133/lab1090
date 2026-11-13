import type { BeastClientStatus } from '#lib/server/beast/client.ts';

/** Shape of the messages on the /api/raw Server-Sent Events stream. Shared by server and page. */

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
}

export interface ReceiverCounts {
	total: number;
	byDf: Record<number, number>;
	/** DF17 type codes. */
	byTc: Record<number, number>;
}

export interface RawUpdate {
	status: BeastClientStatus;
	/** Where the receiver connects to, e.g. "pi:30005". */
	source: string;
	/** When the counting started (server start), ms since epoch. */
	since: number;
	counts: ReceiverCounts;
	/** New frames since the previous update (the first update holds recent history). */
	frames: WireFrame[];
}
