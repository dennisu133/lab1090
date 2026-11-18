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
 * What a sample should be: b + A·Σ pulse(5k − P) over the pulses P that reach it, with the
 * message's amplitude A and the noise floor b fitted to the preamble, whose pulses are known.
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
/** States: the last MEMORY bits. */
const STATES = 1 << MEMORY;
/** Words: a state and the new bit, the bits that decide what bit j's samples look like. */
const WORDS = STATES << 1;
/** At most this many samples per bit: the last bit's run to the end of its ringing. */
const MOST = Math.ceil((US - HALF + PULSE_TO - PULSE_FROM) / SAMPLE) + 1;

/**
 * The expected magnitude (for A = 1, b = 0) of the i-th sample of a bit, by how many earlier
 * bits there are (min(j, MEMORY): bits before the first aren't drawn), the bit start's
 * phase (the first sample lies at d = PULSE_FROM + phase) and the word: bit j − m is
 * (word >> m) & 1. Whole ticks: a few hundred numbers instead of adding up pulse shapes
 * for every sample, state and bit of every message tried.
 */
const EXPECTED = (() => {
	const table = new Float64Array((MEMORY + 1) * SAMPLE * MOST * WORDS);
	for (let earlier = 0; earlier <= MEMORY; earlier++)
		for (let phase = 0; phase < SAMPLE; phase++)
			for (let i = 0; i < MOST; i++)
				for (let word = 0; word < WORDS; word++) {
					const d = PULSE_FROM + phase + SAMPLE * i;
					let x = 0;
					for (let m = 0; m <= earlier; m++)
						x += pulseShape(d + US * m - ((word >> m) & 1 ? 0 : HALF));
					table[((earlier * SAMPLE + phase) * MOST + i) * WORDS + word] = x;
				}
	return table;
})();

export class SequenceReader {
	#cost = new Float64Array(STATES);
	#next = new Float64Array(STATES);
	/** The best previous state, per bit and state. */
	#back = new Uint8Array(112 * STATES);

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
		for (let k = Math.floor(s / SAMPLE) - 1; k < Math.ceil((s + 90) / SAMPLE); k++) {
			let x = 0;
			for (const p of PREAMBLE) x += pulseShape(SAMPLE * k - s - p);
			const y = mag[k] ?? 0;
			n++;
			sx += x;
			sy += y;
			sxx += x * x;
			sxy += x * y;
		}
		const A = (n * sxy - sx * sy) / (n * sxx - sx * sx);
		if (!(A > 0)) return 0;
		const b = (sy - A * sx) / n;

		const data0 = s + DATA;
		let cost = this.#cost;
		let next = this.#next;
		const back = this.#back;
		cost.fill(Infinity);
		// Before the first bit: "no pulse", state 0. (Bits before 0 aren't drawn below.)
		cost[0] = 0;
		let length = 112;
		for (let j = 0; j < length; j++) {
			// The samples bit j is the latest to reach (for the last bit: all that are left).
			const t = data0 + US * j;
			const kFrom = Math.ceil((t + PULSE_FROM) / SAMPLE);
			const kTo =
				j === length - 1
					? Math.ceil((t + US - HALF + PULSE_TO) / SAMPLE)
					: Math.ceil((t + US + PULSE_FROM) / SAMPLE);
			const phase = SAMPLE * kFrom - t - PULSE_FROM;
			const row = (Math.min(j, MEMORY) * SAMPLE + phase) * MOST * WORDS;
			next.fill(Infinity);
			for (let state = 0; state < STATES; state++) {
				const before = cost[state];
				if (before === Infinity) continue;
				for (let bit = 0; bit < 2; bit++) {
					const word = (state << 1) | bit;
					let total = before;
					for (let k = kFrom, at = row + word; k < kTo; k++, at += WORDS) {
						const r = mag[k] - b - A * EXPECTED[at];
						total += r * r;
					}
					const to = word & (STATES - 1);
					if (total < next[to]) {
						next[to] = total;
						back[j * STATES + to] = state;
					}
				}
			}
			[cost, next] = [next, cost];
			if (j === 8) {
				// The format, from the best path so far (the first bits are settled by now): it
				// says how many bits there are.
				this.#trace(cost, 8, bits);
				let df = 0;
				for (let i = 0; i < 5; i++) df = (df << 1) | bits[i];
				if (!KNOWN_FORMATS.has(Math.min(df, 24))) return 0;
				length = messageBits(df);
			}
		}
		this.#trace(cost, length - 1, bits);
		this.#cost = cost;
		this.#next = next;
		return length as 56 | 112;
	}

	/** Bits 0…last along the path into the cheapest state. */
	#trace(cost: Float64Array, last: number, bits: Uint8Array): void {
		let state = 0;
		for (let k = 1; k < STATES; k++) if (cost[k] < cost[state]) state = k;
		for (let i = last; i >= 0; i--) {
			bits[i] = state & 1;
			state = this.#back[i * STATES + state];
		}
	}
}
