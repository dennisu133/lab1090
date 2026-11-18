/**
 * From RTL-SDR samples to Mode S messages: find the preambles, read the bits, keep what the
 * parity accepts (filter.ts). Written from the signal's definition (modulate.ts draws it).
 *
 * Timing. At 2.4 million samples a second, a µs is 2.4 samples and a half-µs pulse 1.2, so
 * pulses don't line up with samples: a message can start anywhere between two samples. We
 * try five starting points per sample, 0.2 samples apart. 0.2 samples is 1/12 µs, exactly
 * one tick of the 12 MHz clock that Beast timestamps count in, so all times here are in
 * those ticks: a sample is 5, a µs 12, a pulse 6. Whole numbers: the arithmetic is exact, and
 * a bit whose two halves are nearly equal comes out the same wherever it lies in the buffer.
 *
 * Energy in a window. Instead of looking at single samples, we add up the magnitude over a
 * stretch of time with fractional ends: a sample half inside the window counts half. (That's
 * the matched filter for a rectangular pulse.) A running sum of the magnitudes makes each
 * window two lookups, whatever its length.
 *
 * Per sample n:
 *
 * 1. A quick test with whole samples: four samples that lie inside the four preamble pulses
 *    whatever the start's fraction, against nine that lie in the quiet gaps between them,
 *    and against the noise level. readsb's test (readsb.ts) is a second way past: it lets
 *    in weak messages ours stops. Most samples stop here.
 * 2. The five starts n + 0, 0.2 … 0.8: energy in the pulses vs the gaps. Starts whose
 *    pulses are clearly stronger are read, the best first, until one passes the parity.
 *    (With a box-shaped pulse, neighbouring starts can score alike, so the best score is
 *    not always the right start.)
 * 3. Read the bits, three ways. First as a sequence (sequence.ts): the bit string whose
 *    pulses, drawn as the dongle draws them (pulse.ts), best fit the samples. If that fails
 *    the parity, bit by bit with readsb's slicer (readsb.ts), then bit by bit with the
 *    energy in each bit's first half vs its second. Each gets different messages wrong, so
 *    trying all finds more than any one. What only readsb's test let in is read with the
 *    slicer alone: it's mostly noise, and eight times as much. The first 5 bits are the
 *    format (DF), which says whether 56 or 112 bits follow; unknown formats stop here.
 * 4. The parity (filter.ts). A message that passes is passed on, and the search goes on
 *    after its end; otherwise at the next sample.
 *
 * Tuned against readsb on the same recordings (tools/demod-compare.ts): on 12 minutes of
 * afternoon traffic (18 Nov 2026) this finds 17–22 % more messages than readsb, and misses
 * 0.3–0.4 % of those readsb finds (not counting DF11 replies to a radar, whose last 7 bits
 * nobody can check: filter.ts).
 *
 * Samples come in chunks of any size; a message can straddle two of them, so the end of one
 * chunk is kept for the next.
 */
import { KNOWN_FORMATS, MessageFilter, messageBits, type Rejection } from './filter';
import { ADC_LIMIT, FULL_SCALE, magnitudes, SAMPLE_RATE } from './samples';
import { readsbPreamble, sliceBit } from './readsb';
import { SequenceReader } from './sequence';

/** A message as the server takes it (the same shape as a Beast frame). */
export interface DemodulatedFrame {
	kind: 'short' | 'long';
	/**
	 * When the preamble started, in ticks of a 12 MHz clock: from the first sample, plus the
	 * `startTick` the demodulator was given.
	 */
	timestamp: number;
	/** Pulse amplitude, 255 = full scale (Beast's signal byte). */
	signal: number;
	data: Uint8Array;
}

/**
 * What the demodulator did, counted from its start. Every candidate ends in exactly one of
 * the outcomes: candidates = noPreamble + unknownFormat + parity + unheard + accepted +
 * repaired.
 */
export interface DemodulatorStats {
	samples: number;
	/**
	 * Samples that passed the quick test, ours or readsb's (1). Not preambles: the samples
	 * next to a real one often pass too, and so does the middle of a message.
	 */
	candidates: number;
	/** Candidates where none of the five starts scored as a preamble (2). */
	noPreamble: number;
	/** Candidates where every start read gave a format that doesn't exist (3). */
	unknownFormat: number;
	/**
	 * Candidates the parity turned down (4), by the reason for the best-scored start that got
	 * that far (filter.ts Rejection).
	 */
	parity: number;
	unheard: number;
	/**
	 * Bit strings read and checked (3, 4): one candidate can be read at several starts, and
	 * up to three ways at each.
	 */
	decoded: number;
	accepted: number;
	repaired: number;
	/** Messages passed on (accepted or repaired) with a sample at the ADC's limit. */
	clipped: number;
	/** Mean magnitude of the latest 27 ms, 1 = full scale: mostly the noise. */
	level: number;
	/**
	 * Blocks of LEVEL_BLOCK samples measured, and the sum of their mean magnitudes: the mean
	 * level over any stretch of time is the difference of two readings.
	 */
	blocks: number;
	levelSum: number;
}

/** 12 MHz ticks per sample (5), per µs (12) and per pulse or half bit (6). */
const SAMPLE = 12e6 / SAMPLE_RATE;
const US = 12;
const HALF = US / 2;
/** The preamble's pulses start at 0, 1, 3.5 and 4.5 µs; the gaps fill the rest of 8 µs. */
const PULSES = [0, 1, 3.5, 4.5].map((t) => t * US);
const GAPS: [number, number][] = [
	[0.5, 1],
	[1.5, 3.5],
	[4, 4.5],
	[5, 8]
].map(([a, b]) => [a * US, b * US]);
const PULSE_LENGTH = 4 * HALF;
const GAP_LENGTH = GAPS.reduce((sum, [a, b]) => sum + b - a, 0);
/** Data starts 8 µs after the preamble. */
const DATA = 8 * US;
/**
 * Samples from a preamble's start to the end of a long message, and a few more: the last
 * pulse's ringing (pulse.ts).
 */
const SPAN = Math.ceil((DATA + 112 * US) / SAMPLE) + 6;
/** Samples kept before the search position: the sequence reader and readsb's test look back. */
const BEFORE = 1;

/**
 * The signal level: how strong a pulse is. A pulse of amplitude A that starts on a sample
 * boundary fills that sample (A) and a fifth of the next (A/5), so the energy in its window
 * is A·1 + (A/5)·0.2 = 1.04·A; one starting 0.4 into a sample covers two samples by 0.6 each:
 * 0.72·A. Dividing by that sum of squared overlaps, per position within a sample (every
 * window starts at a multiple of 0.2), gives A back.
 */
const SELF_OVERLAP = Array.from({ length: SAMPLE }, (_, start) => {
	let sum = 0;
	for (let k = 0; k < 3; k++) {
		const overlap = Math.max(
			0,
			Math.min(start + HALF, (k + 1) * SAMPLE) - Math.max(start, k * SAMPLE)
		);
		sum += (overlap / SAMPLE) ** 2;
	}
	return sum;
});

/**
 * Step 1: the pulses' weakest sample must beat the gaps' mean by this much (amplitude). Low
 * on purpose: it only saves work, the parity decides. 1.5 is 3.5 dB.
 */
export const QUICK_RATIO = 1.5;
/**
 * …and be this far above the overall level: the mean magnitude of the previous block of
 * LEVEL_BLOCK samples (27 ms), which is mostly noise. Without it, noise passes the ratio
 * often enough to double the work. Blocks of a fixed size, not per chunk: what's found must
 * not depend on how the samples arrive.
 */
export const QUICK_ABOVE_LEVEL = 1.5;
export const LEVEL_BLOCK = 65536;
/**
 * Step 2: mean energy in the pulses vs in the gaps. 1.8 is 5.1 dB. Lower finds more weak
 * messages, and costs: 2 found 3 % fewer, 1.6 another 0.4 % more for twice the work.
 */
export const PREAMBLE_RATIO = 1.8;

export class Demodulator {
	readonly stats: DemodulatorStats = {
		samples: 0,
		candidates: 0,
		noPreamble: 0,
		unknownFormat: 0,
		parity: 0,
		unheard: 0,
		decoded: 0,
		accepted: 0,
		repaired: 0,
		clipped: 0,
		level: 0,
		blocks: 0,
		levelSum: 0
	};
	readonly filter = new MessageFilter();
	/** The first sample's time, 12 MHz ticks. */
	readonly #startTick: number;

	constructor({ startTick = 0 }: { startTick?: number } = {}) {
		this.#startTick = startTick;
	}

	/** Magnitudes: what's left of the previous chunk, then the new one. */
	#mag = new Uint16Array(0);
	/** Running sum: #sum[k] = #mag[0] + … + #mag[k − 1]. */
	#sum = new Float64Array(0);
	/** Samples held in #mag. */
	#length = 0;
	/** Absolute number of #mag[0], counted from the first sample ever pushed. */
	#offset = 0;
	/** Where the search goes on, relative to #mag[0]: can be past the end after a message. */
	#next = 0;
	/** A chunk with an odd number of bytes leaves half a sample (its I) for the next one. */
	#odd = -1;
	/** The mean magnitude of each block of LEVEL_BLOCK samples, from block #levelsFrom on. */
	#levels: number[] = [];
	#levelsFrom = 0;
	#blockSum = 0;
	#blockFill = 0;
	#bits = new Uint8Array(112);
	/** The readings already checked at the current start, to skip one that reads the same. */
	#tried = [new Uint8Array(112), new Uint8Array(112)];
	#triedCount = 0;
	#sequence = new SequenceReader();
	#starts: number[] = [];
	#scores: number[] = [];

	/** Take UC8 samples (I, Q, I, Q, …); returns the messages found in them. */
	push(iq: Uint8Array): DemodulatedFrame[] {
		let bytes = iq;
		if (this.#odd >= 0) {
			bytes = new Uint8Array(iq.length + 1);
			bytes[0] = this.#odd;
			bytes.set(iq, 1);
		}
		const count = bytes.length >> 1;
		this.#odd = bytes.length & 1 ? bytes[bytes.length - 1] : -1;

		this.#grow(this.#length + count);
		magnitudes(bytes, 0, count, this.#mag, this.#length);
		const mag = this.#mag;
		const sum = this.#sum;
		for (let k = this.#length; k < this.#length + count; k++) {
			sum[k + 1] = sum[k] + mag[k];
			this.#blockSum += mag[k];
			if (++this.#blockFill === LEVEL_BLOCK) {
				this.#levels.push(this.#blockSum / LEVEL_BLOCK);
				this.stats.level = this.#blockSum / LEVEL_BLOCK / FULL_SCALE;
				this.stats.blocks++;
				this.stats.levelSum += this.stats.level;
				this.#blockSum = 0;
				this.#blockFill = 0;
			}
		}
		this.#length += count;
		this.stats.samples += count;

		const frames = this.#scan();
		this.#keepTail();
		return frames;
	}

	#scan(): DemodulatedFrame[] {
		const frames: DemodulatedFrame[] = [];
		const mag = this.#mag;
		const end = this.#length - SPAN;
		let floor = 0;
		/** Where the next block of LEVEL_BLOCK samples starts, relative to #mag[0]. */
		let boundary = -1;
		let n = this.#next;
		for (; n < end; n++) {
			if (n >= boundary) {
				// The level of the block before this one: it's complete, whatever the chunks.
				const block = Math.floor((this.#offset + n) / LEVEL_BLOCK);
				const level = this.#levels[block - 1 - this.#levelsFrom] ?? 0;
				floor = level * QUICK_ABOVE_LEVEL;
				boundary = (block + 1) * LEVEL_BLOCK - this.#offset;
			}
			// 1. Whatever the fraction, these samples overlap a pulse by at least 0.6 of a sample
			//    (the first and last pulse: one of the two does)…
			const high = Math.min(
				Math.max(mag[n], mag[n + 1]),
				mag[n + 3],
				mag[n + 9],
				Math.max(mag[n + 11], mag[n + 12])
			);
			// …and these lie in a gap (5–7: between the 2nd and 3rd pulse; 13–18: after the 4th).
			// Failing that, readsb's test: then only its slicer reads (`weak`).
			let weak = high <= floor;
			if (!weak) {
				const gap =
					mag[n + 5] +
					mag[n + 6] +
					mag[n + 7] +
					mag[n + 13] +
					mag[n + 14] +
					mag[n + 15] +
					mag[n + 16] +
					mag[n + 17] +
					mag[n + 18];
				weak = high * 9 <= gap * QUICK_RATIO;
			}
			if (weak && !readsbPreamble(mag, n)) continue;
			this.stats.candidates++;
			const frame = this.#tryAt(n, weak);
			if (frame) {
				frames.push(frame.frame);
				// Go on after this message; one starting inside it would be garbled anyway.
				n = Math.floor(frame.end / SAMPLE) - 1;
			}
		}
		this.#next = n;
		return frames;
	}

	/**
	 * Steps 2–4 for the starts n, n + 0.2, … n + 0.8 (in ticks: 5n … 5n + 4). `weak`: let in
	 * by readsb's test only, so read with the slicer alone.
	 */
	#tryAt(n: number, weak: boolean): { frame: DemodulatedFrame; end: number } | null {
		const starts = this.#starts;
		const scores = this.#scores;
		starts.length = 0;
		scores.length = 0;
		for (let s = n * SAMPLE; s < (n + 1) * SAMPLE; s++) {
			let pulses = 0;
			for (const t of PULSES) pulses += this.#energy(s + t, s + t + HALF);
			let gaps = 0;
			for (const [a, b] of GAPS) gaps += this.#energy(s + a, s + b);
			const pulseMean = pulses / PULSE_LENGTH;
			const gapMean = gaps / GAP_LENGTH;
			if (pulseMean <= gapMean * PREAMBLE_RATIO) continue;
			starts.push(s);
			scores.push(pulseMean - gapMean);
		}
		if (starts.length === 0) {
			this.stats.noPreamble++;
			return null;
		}
		/** Why the best start that reached the parity check was turned down. */
		let rejection: Rejection | null = null;
		while (starts.length > 0) {
			let best = 0;
			for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k;
			const s = starts[best];
			starts.splice(best, 1);
			scores.splice(best, 1);
			const found = this.#read(s, weak);
			if (typeof found === 'object') return found;
			if (found !== 'format') rejection ??= found;
		}
		if (rejection) this.stats[rejection]++;
		else this.stats.unknownFormat++;
		return null;
	}

	/**
	 * Steps 3 and 4: the bits of a message starting at tick s (relative to #mag[0]); if it's
	 * not a message, where it stopped: an unknown format, or why the parity turned it down.
	 */
	#read(s: number, weak: boolean): { frame: DemodulatedFrame; end: number } | 'format' | Rejection {
		this.#triedCount = 0;
		if (weak) return this.#readAs(s, 'slicer');
		const asSequence = this.#readAs(s, 'sequence');
		if (typeof asSequence === 'object') return asSequence;
		const asSlicer = this.#readAs(s, 'slicer');
		if (typeof asSlicer === 'object') return asSlicer;
		const asBox = this.#readAs(s, 'box');
		if (typeof asBox === 'object') return asBox;
		// The first that got further: a parity verdict over an unknown format.
		return asSequence !== 'format' ? asSequence : asSlicer !== 'format' ? asSlicer : asBox;
	}

	#readAs(
		s: number,
		how: 'sequence' | 'slicer' | 'box'
	): { frame: DemodulatedFrame; end: number } | 'format' | Rejection {
		const bits = this.#bits;
		const data0 = s + DATA;
		let length: 0 | 56 | 112;
		if (how === 'sequence') {
			length = this.#sequence.read(this.#mag, s, bits);
		} else {
			let df = 0;
			for (let i = 0; i < 5; i++) {
				bits[i] = this.#bitAt(data0 + i * US, how);
				df = (df << 1) | bits[i];
			}
			length = KNOWN_FORMATS.has(Math.min(df, 24)) ? messageBits(df) : 0;
			for (let i = 5; i < length; i++) bits[i] = this.#bitAt(data0 + i * US, how);
		}
		if (length === 0) return 'format';
		// Already checked (and turned down) as an earlier reading.
		for (let r = 0; r < this.#triedCount; r++) {
			const tried = this.#tried[r];
			let i = 0;
			while (i < length && bits[i] === tried[i]) i++;
			if (i === length) return 'parity';
		}
		if (this.#triedCount < this.#tried.length) this.#tried[this.#triedCount++].set(bits);
		let pulses = 0;
		const data = new Uint8Array(length / 8);
		for (let i = 0; i < length; i++) {
			const t = data0 + i * US;
			if (bits[i]) {
				data[i >> 3] |= 0x80 >> (i & 7);
				pulses += this.#energy(t, t + HALF) / SELF_OVERLAP[t % SAMPLE];
			} else {
				pulses += this.#energy(t + HALF, t + US) / SELF_OVERLAP[(t + HALF) % SAMPLE];
			}
		}
		this.stats.decoded++;
		const timestamp = this.#startTick + this.#offset * SAMPLE + s;
		const accepted = this.filter.check(data, timestamp / 12e6);
		this.stats.accepted = this.filter.stats.accepted;
		this.stats.repaired = this.filter.stats.repaired;
		if (!accepted) return this.filter.rejection ?? 'parity';
		const end = data0 + length * US;
		if (this.#reachesLimit(s, end)) this.stats.clipped++;
		// #energy counts in ticks: a sample fully inside a window adds its magnitude 5 times.
		const amplitude = pulses / SAMPLE / length / FULL_SCALE;
		return {
			frame: {
				kind: length === 112 ? 'long' : 'short',
				timestamp,
				signal: Math.max(1, Math.min(255, Math.round(amplitude * 255))),
				data: accepted
			},
			end
		};
	}

	/** Whether any sample between ticks a and b got to the ADC's limit. */
	#reachesLimit(a: number, b: number): boolean {
		for (let k = Math.floor(a / SAMPLE); k <= Math.ceil(b / SAMPLE); k++) {
			if (this.#mag[k] >= ADC_LIMIT) return true;
		}
		return false;
	}

	/**
	 * The bit at t: readsb's slicer, or 1 if it has more energy in its first half than in its
	 * second.
	 */
	#bitAt(t: number, how: 'slicer' | 'box'): number {
		if (how === 'slicer') return sliceBit(this.#mag, t);
		return this.#energy(t, t + HALF) > this.#energy(t + HALF, t + US) ? 1 : 0;
	}

	/**
	 * Magnitude summed over the ticks [a, b) (each tick counts a fifth of its sample: sample k
	 * stands for ticks 5k to 5k + 4), times 5: whole samples from the running sum, plus the
	 * ticks at both ends. Whole numbers all the way.
	 */
	#energy(a: number, b: number): number {
		const ia = (a / SAMPLE) | 0;
		const ib = (b / SAMPLE) | 0;
		return (
			SAMPLE * (this.#sum[ib] - this.#sum[ia]) +
			(b - ib * SAMPLE) * this.#mag[ib] -
			(a - ia * SAMPLE) * this.#mag[ia]
		);
	}

	/** Keep the samples from the search position on (and BEFORE): they may start a message. */
	#keepTail(): void {
		const from = Math.max(0, Math.min(this.#next, this.#length) - BEFORE);
		const keep = this.#length - from;
		this.#mag.copyWithin(0, from, this.#length);
		this.#sum[0] = 0;
		for (let k = 0; k < keep; k++) this.#sum[k + 1] = this.#sum[k] + this.#mag[k];
		this.#length = keep;
		this.#offset += from;
		this.#next -= from;
		// Only the block before the oldest kept sample's is still needed.
		const drop = Math.floor(this.#offset / LEVEL_BLOCK) - 1 - this.#levelsFrom;
		if (drop > 0) {
			this.#levels.splice(0, drop);
			this.#levelsFrom += drop;
		}
	}

	#grow(size: number): void {
		if (this.#mag.length >= size + 1) return;
		const mag = new Uint16Array(Math.max(size + 1, this.#mag.length * 2));
		mag.set(this.#mag.subarray(0, this.#length));
		const sum = new Float64Array(mag.length + 1);
		sum.set(this.#sum.subarray(0, this.#length + 1));
		this.#mag = mag;
		this.#sum = sum;
	}
}
