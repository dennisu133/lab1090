/**
 * Reading a message's bits as a whole sequence instead of one bit at a time.
 *
 * The simple way to read a bit: is there more energy in its first half (a 1) or in its
 * second (a 0)? That treats each bit on its own. But the dongle smears every pulse into its
 * neighbours (pulse.ts): a bit's halves also hold the tail of the previous bit's pulse and the
 * start of the next one's. A weak message read bit by bit gets a bit wrong now and then just
 * from that.
 *
 * Instead we ask: which bit string, drawn the way the dongle draws pulses, comes closest to
 * the samples we got? "Closest" is least squares: the sum over the samples of (received −
 * expected)². Each sample depends only on the bits whose pulses reach it, at most the last
 * three, so the search doesn't have to try all 2¹¹² strings. The Viterbi algorithm walks
 * through the bits once, keeping for each value of the last two bits (4 "states") the best
 * string ending that way and its cost. Each new bit extends every state both ways and keeps
 * the cheaper path into each new state; at the end, the cheapest state's path is the answer.
 * (Viterbi 1967; the same algorithm decodes convolutional codes and reads hard disks.)
 *
 * What a sample should be: b + A·x, x = Σ pulse(5k − P) over the pulses P that reach it, with
 * the message's amplitude A and the noise floor b fitted to the preamble, whose pulses are
 * known. With y = sample − b, the cost of a string is Σ (y − A·x)² = Σ y² − 2A·Σ y·x + A²·Σ x².
 * Σ y² is the same whatever the string, and A the same for all its bits, so what's compared
 * is Σ x² − Σ (2y/A)·x: the same choices, for less arithmetic. Σ x² per bit comes from a
 * table, and Σ y·x splits into one dot product per bit that reaches the samples.
 */
import { KNOWN_FORMATS, messageBits } from './filter';
import { PULSE_FROM, PULSE_TO, pulseShape } from './pulse';

/** 12 MHz ticks per sample, µs and half µs (demodulator.ts). */
const SAMPLE = 5;
const US = 12;
const HALF = 6;
/** The preamble's pulses, and where the data starts (ticks after the first pulse). */
const PREAMBLE = [0, 12, 42, 54];
const DATA = 96;
/**
 * How many earlier bits reach a bit's samples. Bit j's samples are those that bit j + 1's
 * pulses don't reach yet: from PULSE_FROM ticks before bit j's start to PULSE_FROM ticks
 * before bit j + 1's, so their d from bit j's start is below US + PULSE_FROM. Bit j − m's
 * pulse, at best HALF later than 12m ticks earlier, still reaches them while d + 12m − HALF
 * is inside the table: 2 bits back, with the shape in pulse.ts.
 */
const MEMORY = Math.floor((PULSE_TO - US - PULSE_FROM + HALF) / US);
// The reading below is written out for two (four states, eight words): a pulse shape that
// rings longer needs it rewritten.
if (MEMORY !== 2)
	throw new Error(`sequence.ts is written for MEMORY = 2, the pulse needs ${MEMORY}`);
/** States: the last MEMORY bits. */
const STATES = 1 << MEMORY;
/** Words: a state and the new bit, the bits that decide what bit j's samples look like. */
const WORDS = STATES << 1;
/** At most this many samples per bit: the last bit's run to the end of its ringing. */
const MOST = Math.ceil((US - HALF + PULSE_TO - PULSE_FROM) / SAMPLE) + 1;

/** PART's entries per sample: bit j − m, m = 0 … MEMORY, as a 0 or a 1. */
const PARTS = 2 * (MEMORY + 1);

/**
 * Each bit's pulse (amplitude 1) at the i-th sample of bit j, by how many earlier bits there
 * are (min(j, MEMORY): bits before the first aren't drawn), the bit start's phase (the first
 * sample lies at d = PULSE_FROM + phase) and which bit it is: bit j − m with value v at
 * index 2m + v. A sample's x is the sum of the three. Whole ticks: a few
 * hundred numbers instead of adding up pulse shapes for every sample, state and bit of every
 * message tried.
 */
const PART = (() => {
	const table = new Float64Array((MEMORY + 1) * SAMPLE * MOST * PARTS);
	for (let earlier = 0; earlier <= MEMORY; earlier++)
		for (let phase = 0; phase < SAMPLE; phase++)
			for (let i = 0; i < MOST; i++)
				for (let m = 0; m <= earlier; m++)
					for (let v = 0; v < 2; v++) {
						const d = PULSE_FROM + phase + SAMPLE * i;
						table[((earlier * SAMPLE + phase) * MOST + i) * PARTS + 2 * m + v] = pulseShape(
							d + US * m - (v ? 0 : HALF)
						);
					}
	return table;
})();

/**
 * Σ x² over a bit's first `count` samples (x: the sum of PART for the word), by earlier bits,
 * phase, count and word: bit j − m is (word >> m) & 1.
 */
const SQUARES = (() => {
	const table = new Float64Array((MEMORY + 1) * SAMPLE * (MOST + 1) * WORDS);
	for (let earlier = 0; earlier <= MEMORY; earlier++)
		for (let phase = 0; phase < SAMPLE; phase++)
			for (let word = 0; word < WORDS; word++) {
				let sum = 0;
				for (let count = 0; count <= MOST; count++) {
					table[((earlier * SAMPLE + phase) * (MOST + 1) + count) * WORDS + word] = sum;
					if (count === MOST) break;
					let x = 0;
					const at = ((earlier * SAMPLE + phase) * MOST + count) * PARTS;
					for (let m = 0; m <= MEMORY; m++) x += PART[at + 2 * m + ((word >> m) & 1)];
					sum += x * x;
				}
			}
	return table;
})();

/**
 * The preamble drawn with amplitude 1 at each sample the fit looks at, by where it starts
 * within its sample (s mod 5): from the sample before it to the one its last pulse's ringing
 * ends in.
 */
const PREAMBLE_X = Array.from({ length: SAMPLE }, (_, phase) => {
	const x: number[] = [];
	for (let k = -1; k < Math.ceil((phase + 90) / SAMPLE); k++) {
		let sum = 0;
		for (const p of PREAMBLE) sum += pulseShape(SAMPLE * k - phase - p);
		x.push(sum);
	}
	return Float64Array.from(x);
});

export class SequenceReader {
	/**
	 * Per bit, which way the best path came into each state: bit `to` set if from the state
	 * whose oldest bit is 1.
	 */
	#back = new Uint8Array(112);

	/**
	 * Reads the bits of a message whose preamble starts at tick s (sample k = tick 5k of
	 * `mag`) into `bits`. Returns the message length, or 0 if the format (the first 5 bits)
	 * doesn't exist or the preamble doesn't fit a message at all. `mag` must hold the samples
	 * from a sample before s to the end of a long message.
	 */
	read(mag: Uint16Array, s: number, bits: Uint8Array): 0 | 56 | 112 {
		// Amplitude A and floor b: least squares over the preamble, mag[k] ≈ b + A·x.
		let n = 0;
		let sx = 0;
		let sy = 0;
		let sxx = 0;
		let sxy = 0;
		const first = Math.floor(s / SAMPLE) - 1;
		const preamble = PREAMBLE_X[s - (first + 1) * SAMPLE];
		for (let i = 0; i < preamble.length; i++) {
			const x = preamble[i];
			const y = mag[first + i] ?? 0;
			n++;
			sx += x;
			sy += y;
			sxx += x * x;
			sxy += x * y;
		}
		const A = (n * sxy - sx * sy) / (n * sxx - sx * sx);
		if (!(A > 0)) return 0;
		const b = (sy - A * sx) / n;
		/** y → 2y/A. */
		const scale = 2 / A;

		const data0 = s + DATA;
		const back = this.#back;
		// The cost of the best path into each state. Before the first bit: "no pulse", state 0.
		// (Bits before 0 aren't drawn below.)
		let c0 = 0;
		let c1 = Infinity;
		let c2 = Infinity;
		let c3 = Infinity;
		let length = 112;
		// The samples bit j is the latest to reach: from kFrom, where d = PULSE_FROM + phase, to
		// the next bit's kFrom (for the last bit: all that are left). A bit is 12 ticks, 2.4
		// samples: kFrom steps by 2 or 3, without dividing.
		let kFrom = Math.ceil((data0 + PULSE_FROM) / SAMPLE);
		let phase = SAMPLE * kFrom - data0 - PULSE_FROM;
		for (let j = 0; j < length; j++) {
			const step = phase >= US - 2 * SAMPLE ? 2 : 3;
			const kTo =
				j === length - 1
					? Math.ceil((data0 + US * j + US - HALF + PULSE_TO) / SAMPLE)
					: kFrom + step;
			const shape = Math.min(j, MEMORY) * SAMPLE + phase;
			const count = kTo - kFrom;
			// Σ (2y/A)·x for each bit's pulse: bit j as a 0 (d0) or a 1 (d1), j − 1 (d2, d3) and
			// j − 2 (d4, d5). Every bit has at least two samples.
			const p = shape * MOST * PARTS;
			const ya = (mag[kFrom] - b) * scale;
			const yb = (mag[kFrom + 1] - b) * scale;
			let d0 = ya * PART[p] + yb * PART[p + PARTS];
			let d1 = ya * PART[p + 1] + yb * PART[p + PARTS + 1];
			let d2 = ya * PART[p + 2] + yb * PART[p + PARTS + 2];
			let d3 = ya * PART[p + 3] + yb * PART[p + PARTS + 3];
			let d4 = ya * PART[p + 4] + yb * PART[p + PARTS + 4];
			let d5 = ya * PART[p + 5] + yb * PART[p + PARTS + 5];
			for (let i = 2, at = p + 2 * PARTS; i < count; i++, at += PARTS) {
				const y = (mag[kFrom + i] - b) * scale;
				d0 += y * PART[at];
				d1 += y * PART[at + 1];
				d2 += y * PART[at + 2];
				d3 += y * PART[at + 3];
				d4 += y * PART[at + 4];
				d5 += y * PART[at + 5];
			}
			// The cost of each word (bit j − m: (word >> m) & 1), then into each state (the newest
			// two bits) from the two that differ in the oldest: the bit that falls out. Ties go to
			// the lower state.
			const q = (shape * (MOST + 1) + count) * WORDS;
			const w0 = SQUARES[q] - (d0 + d2 + d4);
			const w1 = SQUARES[q + 1] - (d1 + d2 + d4);
			const w2 = SQUARES[q + 2] - (d0 + d3 + d4);
			const w3 = SQUARES[q + 3] - (d1 + d3 + d4);
			const w4 = SQUARES[q + 4] - (d0 + d2 + d5);
			const w5 = SQUARES[q + 5] - (d1 + d2 + d5);
			const w6 = SQUARES[q + 6] - (d0 + d3 + d5);
			const w7 = SQUARES[q + 7] - (d1 + d3 + d5);
			// State = the last two bits, newest lowest; word = state << 1 | the new bit. Into
			// state 0 from 0 (word 0) or 2 (word 4), and so on.
			const x0 = c0 + w0;
			const y0 = c2 + w4;
			const x1 = c0 + w1;
			const y1 = c2 + w5;
			const x2 = c1 + w2;
			const y2 = c3 + w6;
			const x3 = c1 + w3;
			const y3 = c3 + w7;
			back[j] = +(y0 < x0) | (+(y1 < x1) << 1) | (+(y2 < x2) << 2) | (+(y3 < x3) << 3);
			c0 = y0 < x0 ? y0 : x0;
			c1 = y1 < x1 ? y1 : x1;
			c2 = y2 < x2 ? y2 : x2;
			c3 = y3 < x3 ? y3 : x3;
			kFrom += step;
			phase += SAMPLE * step - US;
			if (j === 8) {
				// The format, from the best path so far (the first bits are settled by now): it
				// says how many bits there are.
				this.#trace(this.#cheapest(c0, c1, c2, c3), 8, bits);
				let df = 0;
				for (let i = 0; i < 5; i++) df = (df << 1) | bits[i];
				if (!KNOWN_FORMATS.has(Math.min(df, 24))) return 0;
				length = messageBits(df);
			}
		}
		this.#trace(this.#cheapest(c0, c1, c2, c3), length - 1, bits);
		return length as 56 | 112;
	}

	/** The state with the lowest cost (the lower one on a tie). */
	#cheapest(c0: number, c1: number, c2: number, c3: number): number {
		let state = 0;
		let best = c0;
		if (c1 < best) {
			state = 1;
			best = c1;
		}
		if (c2 < best) {
			state = 2;
			best = c2;
		}
		if (c3 < best) state = 3;
		return state;
	}

	/** Bits 0…last along the path into `state`. */
	#trace(state: number, last: number, bits: Uint8Array): void {
		for (let i = last; i >= 0; i--) {
			bits[i] = state & 1;
			state = (state >> 1) | (((this.#back[i] >> state) & 1) << (MEMORY - 1));
		}
	}
}
