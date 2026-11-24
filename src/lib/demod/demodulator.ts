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
 * the matched filter for a rectangular pulse.) A half µs is 6 ticks, so it always spans
 * exactly two samples: two lookups.
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
 * nobody can check: filter.ts). Before, with bits read one at a time (first half of each
 * bit against the second) and a preamble ratio of 2, it found 4–5 % fewer than readsb and
 * missed 6–8 % of them; reading bits as a sequence over the measured pulse (sequence.ts)
 * alone gave +14–19 %, missing 1.7–2.3 %; readsb's slicer, its quick test and its format
 * repair (readsb.ts, filter.ts) did the rest. On a Pi 5 that takes 4.5 % of a core at
 * 49.6 dB and 5.0 % at 40.2 dB. Live, side by side on the same samples for 10 minutes that
 * evening: +17 % messages, +10 % airborne positions, every aircraft readsb heard and two more,
 * for 7.8 % of a Pi 5 core (the whole lab1090 process) against readsb's 2.8 %.
 *
 * What was tried and dropped is noted where it would have gone, with what it gave. A change
 * made only for speed must leave the output identical on the three recordings
 * (tools/demod-bench.ts --save before, --check after), and speed that costs messages isn't
 * taken.
 *
 * Samples come in chunks of any size; a message can straddle two of them, so the end of one
 * chunk is kept for the next.
 */
import { KNOWN_FORMATS, MessageFilter, messageBits, type Rejection } from './filter';
import { ADC_LIMIT, FULL_SCALE, magnitudesSum, SAMPLE_RATE } from './samples';
import { EARLY, LATE, readsbCheck, readsbPhases, sliceBits } from './readsb';
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
	/**
	 * Mean magnitude of the latest 27 ms, 1 = full scale: mostly the noise.
	 *
	 * TODO: messages add to the mean too. On the recordings (21 Nov 2026) they cover 0.4–1 % of
	 * the samples and raise the mean by 0.1 dB (c, 44 messages/s) to 0.4 dB (a, 105/s); on
	 * synthetic traffic over the same noise by 0.34 dB at 85/s and 0.84 dB at 330/s
	 * (oracle/local/receiver-check/robust.ts). Nothing here gets busier than that, but a
	 * receiver near a hub (1,000/s and more) would read the noise 2–3 dB high: a median or a
	 * low percentile would measure it better (for QUICK_ABOVE_LEVEL and the gain advice,
	 * lib/radio/gain.ts). It changes what's found, so it needs the bench (demod-bench.ts).
	 */
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
/**
 * Samples per tick, to find a tick's sample with a multiplication instead of a division.
 * Exact: the double nearest 0.2 is a little more than 1/5, so 5k · PER_TICK never falls
 * below k.
 */
const PER_TICK = 1 / SAMPLE;
/**
 * The preamble's pulses start at 0, 1, 3.5 and 4.5 µs (0, 12, 42 and 54 ticks: #tryAt has
 * them written out); the gaps fill the rest of 8 µs. Data starts 8 µs after the preamble.
 */
const DATA = 8 * US;
const PULSE_LENGTH = 4 * HALF;
const GAP_LENGTH = DATA - PULSE_LENGTH;
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
 * on purpose: it only saves work, the parity decides. 1.5 is 3.5 dB. Looser (this or
 * QUICK_ABOVE_LEVEL lower) found 1 % more on real traffic for 5× the work; readsb's test as
 * a second way in found more for less.
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
 * messages, and costs: 2 found 3 % fewer, 1.6 another 0.4 % more for twice the work, 1.4
 * nothing more than 1.6.
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
	/** A reading packed into bytes, for the filter. */
	#long = new Uint8Array(14);
	#short = new Uint8Array(7);
	#sequence = new SequenceReader();
	/** Step 2's energy in the pulses for each of the five starts, and their scores. */
	#pulses = new Int32Array(SAMPLE);
	#scores = new Float64Array(SAMPLE);

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
		// Block by block, for the level: magnitudes and their sum in one pass.
		for (let done = 0; done < count;) {
			const part = Math.min(count - done, LEVEL_BLOCK - this.#blockFill);
			this.#blockSum += magnitudesSum(bytes, 2 * done, part, this.#mag, this.#length + done);
			this.#blockFill += part;
			done += part;
			if (this.#blockFill === LEVEL_BLOCK) {
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
		let n = this.#next;
		/** readsb's test at the sample before: a start in this one. */
		let early = n > 0 ? this.#readsbEarly(n - 1) : 0;
		while (n < end) {
			// Block by block: the floor is from the level of the block before this one, which is
			// complete, whatever the chunks.
			const block = Math.floor((this.#offset + n) / LEVEL_BLOCK);
			const level = this.#levels[block - 1 - this.#levelsFrom] ?? 0;
			// Magnitudes are whole numbers: above x means above ⌊x⌋, an integer comparison.
			const floor = Math.floor(level * QUICK_ABOVE_LEVEL);
			const stop = Math.min(end, (block + 1) * LEVEL_BLOCK - this.#offset);
			for (; n < stop; n++) {
				// 1. Whatever the fraction, these samples overlap a pulse by at least 0.6 of a sample
				//    (the first and last pulse: one of the two does), so they must be above the
				//    floor; readsb's test (readsb.ts) is the other way in. Its first check looks at
				//    sample n for starts in n and n + 1, so a start in n can also come from n − 1
				//    (`early`). Most samples fail all three, at random: worked out without branches
				//    (`+`, `&`), so the processor needn't guess, with one branch for all.
				const second = mag[n + 3];
				const third = mag[n + 9];
				const maybeOurs = +(second > floor) & +(third > floor);
				const checkHere = readsbCheck(mag, n);
				if ((maybeOurs | checkHere | early) === 0) continue;
				// readsb's test at n: a start in n (LATE) or in n + 1 (EARLY, for the next sample).
				const phases = checkHere ? readsbPhases(mag, n) : 0;
				const readsbHere = (phases & LATE) | early;
				early = phases & EARLY;
				let ours = false;
				if (maybeOurs) {
					const first = Math.max(mag[n], mag[n + 1]);
					const fourth = Math.max(mag[n + 11], mag[n + 12]);
					if (first > floor && fourth > floor) {
						// …and stronger than these, which lie in a gap (5–7: between the 2nd and 3rd
						// pulse; 13–18: after the 4th).
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
						ours = Math.min(first, second, third, fourth) * 9 > gap * QUICK_RATIO;
					}
				}
				// Failing that, readsb's: then only its slicer reads.
				if (!ours && readsbHere === 0) continue;
				this.stats.candidates++;
				const frame = this.#tryAt(n, !ours);
				if (frame) {
					frames.push(frame.frame);
					// Go on after this message; one starting inside it would be garbled anyway.
					// Resuming 30 µs before its end (about what readsb does) found 8 more per
					// 5 minutes for 24 % more CPU; at the next sample, only the same message again.
					n = Math.floor(frame.end / SAMPLE) - 1;
					early = n >= 0 ? this.#readsbEarly(n) : 0;
				}
			}
		}
		this.#next = n;
		return frames;
	}

	/** Whether readsb's test at sample p finds a start in p + 1. */
	#readsbEarly(p: number): number {
		return readsbCheck(this.#mag, p) ? readsbPhases(this.#mag, p) & EARLY : 0;
	}

	/**
	 * Steps 2–4 for the starts n, n + 0.2, … n + 0.8 (in ticks: 5n … 5n + 4). `weak`: let in
	 * by readsb's test only, so read with the slicer alone.
	 */
	#tryAt(n: number, weak: boolean): { frame: DemodulatedFrame; end: number } | null {
		const scores = this.#scores;
		let count = 0;
		const mag = this.#mag;
		// The pulses' windows (energy()) from tick 5n + f: pulse 1 at r = f into sample n, 2 at
		// f + 2 into n + 2, 3 at f + 2 into n + 8, 4 at f + 4 into n + 10. As weights on samples
		// n … n + 12 (mi = mag[n + i]):
		//
		//   f   pulse 1      pulse 2      pulse 3        pulse 4
		//   0   5·m0 + m1    3·m2 + 3·m3  3·m8 + 3·m9    m10 + 5·m11
		//   1   4·m0 + 2·m1  2·m2 + 4·m3  2·m8 + 4·m9    5·m11 + m12
		//   2   3·m0 + 3·m1  m2 + 5·m3    m8 + 5·m9      4·m11 + 2·m12
		//   3   2·m0 + 4·m1  5·m3 + m4    5·m9 + m10     3·m11 + 3·m12
		//   4   m0 + 5·m1    4·m3 + 2·m4  4·m9 + 2·m10   2·m11 + 4·m12
		const m0 = mag[n];
		const m1 = mag[n + 1];
		const m2 = mag[n + 2];
		const m3 = mag[n + 3];
		const m4 = mag[n + 4];
		const m8 = mag[n + 8];
		const m9 = mag[n + 9];
		const m10 = mag[n + 10];
		const m11 = mag[n + 11];
		const m12 = mag[n + 12];
		const pulses = this.#pulses;
		pulses[0] = 5 * m0 + m1 + 3 * m2 + 3 * m3 + 3 * m8 + 3 * m9 + m10 + 5 * m11;
		pulses[1] = 4 * m0 + 2 * m1 + 2 * m2 + 4 * m3 + 2 * m8 + 4 * m9 + 5 * m11 + m12;
		pulses[2] = 3 * m0 + 3 * m1 + m2 + 5 * m3 + m8 + 5 * m9 + 4 * m11 + 2 * m12;
		pulses[3] = 2 * m0 + 4 * m1 + 5 * m3 + m4 + 5 * m9 + m10 + 3 * m11 + 3 * m12;
		pulses[4] = m0 + 5 * m1 + 4 * m3 + 2 * m4 + 4 * m9 + 2 * m10 + 2 * m11 + 4 * m12;
		// The gaps are what the pulses leave of the preamble's 96 ticks. From tick 5n + f, those
		// are 5 − f ticks of sample n, samples n + 1 … n + 18 whole, and f + 1 ticks of n + 19.
		let middle = 0;
		for (let k = n + 1; k <= n + 18; k++) middle += mag[k];
		for (let f = 0; f < SAMPLE; f++) {
			const all = (SAMPLE - f) * m0 + SAMPLE * middle + (f + 1) * mag[n + 19];
			const gaps = all - pulses[f];
			const pulseMean = pulses[f] / PULSE_LENGTH;
			const gapMean = gaps / GAP_LENGTH;
			// Not a preamble: below any score.
			scores[f] = pulseMean > gapMean * PREAMBLE_RATIO ? pulseMean - gapMean : -Infinity;
			count += +(pulseMean > gapMean * PREAMBLE_RATIO);
		}
		if (count === 0) {
			this.stats.noPreamble++;
			return null;
		}
		// Every start that scores, best first, also when readsb's test let the sample in: reading
		// only the best-scored start lost 2.9 % of messages, scoring readsb's candidates only at
		// its own phases 3 to 11 per recording.
		/** Why the best start that reached the parity check was turned down. */
		let rejection: Rejection | null = null;
		for (; count > 0; count--) {
			let best = 0;
			for (let f = 1; f < SAMPLE; f++) if (scores[f] > scores[best]) best = f;
			scores[best] = -Infinity;
			const found = this.#read(n * SAMPLE + best, weak);
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
		// All three readings for these too: 0.9 % more messages for twice the CPU.
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
		} else if (how === 'slicer') {
			sliceBits(this.#mag, data0, bits, 0, 5);
			length = this.#length0(bits);
			sliceBits(this.#mag, data0, bits, 5, length);
		} else {
			boxBits(this.#mag, data0, bits, 0, 5);
			length = this.#length0(bits);
			boxBits(this.#mag, data0, bits, 5, length);
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
		const data = length === 112 ? this.#long : this.#short;
		for (let i = 0; i < data.length; i++) {
			let byte = 0;
			for (let j = 8 * i; j < 8 * i + 8; j++) byte = (byte << 1) | bits[j];
			data[i] = byte;
		}
		this.stats.decoded++;
		const timestamp = this.#startTick + this.#offset * SAMPLE + s;
		const passed = this.filter.check(data, timestamp / 12e6);
		this.stats.accepted = this.filter.stats.accepted;
		this.stats.repaired = this.filter.stats.repaired;
		if (!passed) return this.filter.rejection ?? 'parity';
		// The filter hands back our buffer, or a repaired copy.
		const accepted = passed === data ? data.slice() : passed;
		// The signal level, from the bits as read: each pulse's energy in its window.
		let pulses = 0;
		for (let i = 0; i < length; i++) {
			const t = data0 + i * US + (bits[i] ? 0 : HALF);
			pulses += energy(this.#mag, t) / SELF_OVERLAP[t % SAMPLE];
		}
		const end = data0 + length * US;
		if (this.#reachesLimit(s, end)) this.stats.clipped++;
		// energy() counts in ticks: a sample fully inside the window adds its magnitude 5 times.
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

	/** The message length the format in bits 0–4 gives: 0 for one that doesn't exist. */
	#length0(bits: Uint8Array): 0 | 56 | 112 {
		const df = (bits[0] << 4) | (bits[1] << 3) | (bits[2] << 2) | (bits[3] << 1) | bits[4];
		return KNOWN_FORMATS.has(Math.min(df, 24)) ? messageBits(df) : 0;
	}

	/** Keep the samples from the search position on (and BEFORE): they may start a message. */
	#keepTail(): void {
		const from = Math.max(0, Math.min(this.#next, this.#length) - BEFORE);
		const keep = this.#length - from;
		this.#mag.copyWithin(0, from, this.#length);
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
		this.#mag = mag;
	}
}

/**
 * Magnitude summed over the half µs (6 ticks) from tick a, each tick counting its sample's
 * magnitude (sample k stands for ticks 5k to 5k + 4): r = a mod 5 into sample k, that's
 * 5 − r ticks of k and 1 + r of k + 1. Whole numbers.
 */
function energy(mag: Uint16Array, a: number): number {
	const k = (a * PER_TICK) | 0;
	const r = a - k * SAMPLE;
	return (SAMPLE - r) * mag[k] + (1 + r) * mag[k + 1];
}

/**
 * Bits from … to − 1 of a message whose data starts at tick t, into `bits`: 1 if the bit has
 * more energy in its first half than in its second (energy()). Both halves are 6 ticks; with
 * the bit starting r ticks into sample k, first minus second is, by r:
 *
 *   r   first half        second half       difference
 *   0   5·m0 + 1·m1       4·m1 + 2·m2       5·m0 − 3·m1 − 2·m2
 *   1   4·m0 + 2·m1       3·m1 + 3·m2       4·m0 − 1·m1 − 3·m2
 *   2   3·m0 + 3·m1       2·m1 + 4·m2       3·m0 + 1·m1 − 4·m2
 *   3   2·m0 + 4·m1       1·m1 + 5·m2       2·m0 + 3·m1 − 5·m2
 *   4   1·m0 + 5·m1       5·m2 + 1·m3       1·m0 + 5·m1 − 5·m2 − 1·m3
 *
 * (mi = mag[k + i]). A bit is 12 ticks, 2 samples and 2 ticks: k and r step along without
 * dividing.
 */
function boxBits(mag: Uint16Array, t: number, bits: Uint8Array, from: number, to: number): void {
	const at = t + from * US;
	let k = (at * PER_TICK) | 0;
	let r = at - k * SAMPLE;
	for (let i = from; i < to; i++) {
		let v: number;
		switch (r) {
			case 0:
				v = 5 * mag[k] - 3 * mag[k + 1] - 2 * mag[k + 2];
				break;
			case 1:
				v = 4 * mag[k] - mag[k + 1] - 3 * mag[k + 2];
				break;
			case 2:
				v = 3 * mag[k] + mag[k + 1] - 4 * mag[k + 2];
				break;
			case 3:
				v = 2 * mag[k] + 3 * mag[k + 1] - 5 * mag[k + 2];
				break;
			default:
				v = mag[k] + 5 * mag[k + 1] - 5 * mag[k + 2] - mag[k + 3];
		}
		bits[i] = +(v > 0);
		r += US - 2 * SAMPLE;
		k += 2;
		if (r >= SAMPLE) {
			r -= SAMPLE;
			k++;
		}
	}
}
