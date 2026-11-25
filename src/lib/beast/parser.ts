/**
 * Incremental parser for the Beast binary protocol (readsb/dump1090, TCP port 30005).
 *
 * Wire format of one frame:
 *
 *   0x1A  <type>  <6 bytes timestamp>  <1 byte signal>  <2 / 7 / 14 bytes message>
 *
 *   type '1' (0x31) Mode A/C,  '2' (0x32) Mode S short,  '3' (0x33) Mode S long
 *
 * 0x1A marks the start of a frame, so a 0x1A byte *inside* a frame is sent twice (1A 1A).
 *
 * TCP delivers a byte stream, not messages: one chunk can hold several frames, and a frame
 * (even an escape pair) can be split across chunks. The parser is therefore a byte-by-byte
 * state machine that keeps its state between `push()` calls. It does no I/O, so the same
 * code reads a live socket and a recorded file.
 *
 * Synchronisation: when we join a stream we may land in the middle of a frame, possibly right
 * between the two bytes of an escape pair, where a data byte 0x1A looks like a frame start.
 * We therefore only trust the framing ("synced") once a parsed frame is directly followed
 * by the next frame's 0x1A. Until then the first frame is held back. If the framing ever
 * breaks (a frame isn't followed by 0x1A, or a lone 0x1A appears mid-frame), we drop back
 * to hunting. Framing is only a plausibility check: the CRC in the decoder is the real
 * integrity check.
 *
 * Use a new parser for every new connection.
 */

export type BeastFrameKind = 'modeac' | 'short' | 'long';

export interface BeastFrame {
	kind: BeastFrameKind;
	/** Receiver clock in 12 MHz ticks (48 bit, fits a JS number exactly). Not wall-clock time. */
	timestamp: number;
	/** Raw signal level 0–255 (scaled amplitude). */
	signal: number;
	/** The message itself: 2 bytes Mode A/C, 7 bytes Mode S short, 14 bytes Mode S long. */
	data: Uint8Array;
}

export interface BeastParserStats {
	/** Frames returned by push(). */
	frames: number;
	/** Keepalive frames (Mode A/C, all zeros) that were dropped. */
	heartbeats: number;
	/** How often the framing broke after we were synced. */
	resyncs: number;
	/** Bytes thrown away while hunting for a frame start (approximate). */
	skippedBytes: number;
}

const ESC = 0x1a;
/** 6 bytes timestamp + 1 byte signal. */
const META_LEN = 7;

const FRAME_TYPES = new Map<number, { kind: BeastFrameKind; dataLen: number }>([
	[0x31, { kind: 'modeac', dataLen: 2 }],
	[0x32, { kind: 'short', dataLen: 7 }],
	[0x33, { kind: 'long', dataLen: 14 }]
]);

/**
 * hunt:  looking for a 0x1A
 * type:  saw 0x1A, next byte is the frame type
 * body:  reading timestamp, signal and message (un-escaping on the way)
 * next:  frame complete, the next byte must be 0x1A
 */
type State = 'hunt' | 'type' | 'body' | 'next';

export class BeastParser {
	readonly stats: BeastParserStats = { frames: 0, heartbeats: 0, resyncs: 0, skippedBytes: 0 };

	#state: State = 'hunt';
	#synced = false;
	/** First frame after (re)joining, held back until the next 0x1A confirms the framing. */
	#candidate: BeastFrame | null = null;

	// frame being assembled
	#kind: BeastFrameKind = 'long';
	#buf = new Uint8Array(META_LEN + 14);
	#len = 0;
	#need = 0;
	/** The previous body byte was a 0x1A, waiting for its partner. */
	#escaped = false;

	/** Feed the next chunk from the stream, get back every frame it completed. */
	push(chunk: Uint8Array): BeastFrame[] {
		const out: BeastFrame[] = [];
		for (let i = 0; i < chunk.length; i++) this.#byte(chunk[i], out);
		return out;
	}

	#byte(b: number, out: BeastFrame[]): void {
		switch (this.#state) {
			case 'hunt':
				if (b === ESC) this.#state = 'type';
				else this.stats.skippedBytes++;
				return;

			case 'type':
				this.#startFrame(b);
				return;

			case 'body':
				if (this.#escaped) {
					this.#escaped = false;
					if (b !== ESC) {
						// A lone 0x1A inside a frame means the sender started a new frame and ours is
						// truncated. b is the new frame's type byte.
						this.#loseSync();
						this.#startFrame(b);
						return;
					}
					// 1A 1A -> one data byte 0x1A, fall through and store it
				} else if (b === ESC) {
					this.#escaped = true;
					return;
				}
				this.#buf[this.#len++] = b;
				if (this.#len === this.#need) this.#finishFrame(out);
				return;

			case 'next':
				if (b === ESC) {
					if (this.#candidate) {
						// The framing holds up: trust it from now on.
						this.#synced = true;
						this.#emit(this.#candidate, out);
						this.#candidate = null;
					}
					this.#state = 'type';
				} else {
					this.#loseSync();
					this.stats.skippedBytes++;
				}
				return;
		}
	}

	#startFrame(type: number): void {
		if (type === ESC) {
			// "1A 1A" where we expected a frame type. After joining mid-stream this is ambiguous:
			//   1A 1A | xx  -> an escaped data byte 0x1A, then data
			//   1A | 1A 33  -> the tail of an escape pair, then a real frame start
			// Never throw away a 0x1A that might start a frame: treat the second one as a possible
			// start. If it was just data, the sync check rejects the bogus frame later.
			this.#loseSync();
			this.#state = 'type';
			return;
		}
		const t = FRAME_TYPES.get(type);
		if (!t) {
			// A frame type we don't parse (e.g. status frames): look for the next frame.
			this.#loseSync();
			return;
		}
		this.#kind = t.kind;
		this.#need = META_LEN + t.dataLen;
		this.#len = 0;
		this.#escaped = false;
		this.#state = 'body';
	}

	#finishFrame(out: BeastFrame[]): void {
		const buf = this.#buf;
		const frame: BeastFrame = {
			kind: this.#kind,
			timestamp: readUint48(buf),
			signal: buf[6],
			data: buf.slice(META_LEN, this.#need) // copy: #buf gets reused for the next frame
		};
		this.#state = 'next';
		if (this.#synced) this.#emit(frame, out);
		else this.#candidate = frame;
	}

	#emit(frame: BeastFrame, out: BeastFrame[]): void {
		if (isHeartbeat(frame)) {
			this.stats.heartbeats++;
			return;
		}
		this.stats.frames++;
		out.push(frame);
	}

	#loseSync(): void {
		if (this.#synced) this.stats.resyncs++;
		this.#synced = false;
		this.#candidate = null;
		this.#state = 'hunt';
	}
}

/** readsb sends a Mode A/C frame of all zeros as keepalive. */
function isHeartbeat(f: BeastFrame): boolean {
	return f.kind === 'modeac' && f.timestamp === 0 && f.signal === 0 && f.data.every((b) => b === 0);
}

/** Big-endian 48-bit integer. Multiplication instead of bit shifts: JS shifts are 32-bit only. */
function readUint48(b: Uint8Array): number {
	let v = 0;
	for (let i = 0; i < 6; i++) v = v * 256 + b[i];
	return v;
}
