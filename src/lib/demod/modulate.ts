/**
 * The other direction: Mode S messages turned into RTL-SDR samples, for testing the
 * demodulator while the sky is quiet, and with answers known beforehand.
 *
 * A message on air (Annex 10 Vol IV §3.1.2.1, Doc 9871 Fig. A-1):
 *
 *   preamble: pulses of 0.5 µs at 0, 1.0, 3.5 and 4.5 µs
 *   data:     from 8 µs, one bit per µs, 56 or 112 of them. Pulse position modulation:
 *             a 1 is a pulse in the first half of its µs, a 0 one in the second half.
 *
 *    _   _    _   _      _  _   _    _
 *   | |_| |__| |_| |____| || |_| |__| |_ …
 *   0   1    3.5 4.5    8  9  10 11 12 µs
 *   └──── preamble ────┘ 1  0  1  0 …   (bit 2 and 3: a 0 then a 1 make one 1 µs pulse)
 *
 * Each sample stands for the 1/2.4 µs before the next one, and gets the part of a pulse that
 * falls inside it (a sample half covered gets half the amplitude). That's the shape the
 * demodulator assumes; the dongle's filters round the edges a little more. Every message gets
 * its own carrier phase (two messages overlapping add up as waves, not as magnitudes).
 *
 * Noise: Gaussian on I and Q, or a recording of real noise from the dongle added
 * underneath (`background`, UC8 bytes, looped).
 */
import { SAMPLES_PER_US } from './samples';

export interface Transmission {
	data: Uint8Array;
	/** Where the preamble's first pulse starts, in samples (fractions allowed). */
	at: number;
	/** Pulse amplitude, 1 = full scale. */
	amplitude: number;
	/** Carrier phase, radians; random if left out. */
	phase?: number;
}

export interface ModulateOptions {
	/** Standard deviation of Gaussian noise on I and on Q, 1 = full scale. */
	noise?: number;
	/** Real noise (UC8, as rtl_sdr records it), added underneath and looped. */
	background?: Uint8Array;
	/** For the random phases and the noise: the same seed gives the same samples. */
	seed?: number;
}

/** Pulse starts and ends of a message, in µs from the first preamble pulse. */
export function pulses(data: Uint8Array): [number, number][] {
	const out: [number, number][] = [0, 1, 3.5, 4.5].map((t) => [t, t + 0.5]);
	for (let i = 0; i < data.length * 8; i++) {
		const one = (data[i >> 3] >> (7 - (i & 7))) & 1;
		const start = 8 + i + (one ? 0 : 0.5);
		out.push([start, start + 0.5]);
	}
	return out;
}

/** `samples` IQ pairs (UC8) holding the transmissions. */
export function modulate(
	transmissions: Transmission[],
	samples: number,
	{ noise = 0, background, seed = 1 }: ModulateOptions = {}
): Uint8Array {
	const random = mulberry32(seed);
	const i = new Float32Array(samples);
	const q = new Float32Array(samples);
	for (const t of transmissions) {
		const phase = t.phase ?? random() * 2 * Math.PI;
		const ci = t.amplitude * Math.cos(phase);
		const cq = t.amplitude * Math.sin(phase);
		for (const [startUs, endUs] of pulses(t.data)) {
			const a = t.at + startUs * SAMPLES_PER_US;
			const b = t.at + endUs * SAMPLES_PER_US;
			for (let k = Math.max(0, Math.floor(a)); k < Math.min(samples, Math.ceil(b)); k++) {
				const overlap = Math.min(b, k + 1) - Math.max(a, k);
				i[k] += ci * overlap;
				q[k] += cq * overlap;
			}
		}
	}
	const out = new Uint8Array(samples * 2);
	for (let k = 0; k < samples; k++) {
		let x = i[k];
		let y = q[k];
		if (noise > 0) {
			// Box–Muller: two uniform numbers → two independent standard normal ones.
			const r = Math.sqrt(-2 * Math.log(1 - random())) * noise;
			const angle = 2 * Math.PI * random();
			x += r * Math.cos(angle);
			y += r * Math.sin(angle);
		}
		if (background) {
			const b = (2 * k) % (background.length & ~1);
			x += (background[b] - 127.5) / 128;
			y += (background[b + 1] - 127.5) / 128;
		}
		out[2 * k] = quantize(x);
		out[2 * k + 1] = quantize(y);
	}
	return out;
}

function quantize(x: number): number {
	return Math.max(0, Math.min(255, Math.round(127.5 + 128 * x)));
}

/** A small seeded random number generator (0 ≤ x < 1): tests must be repeatable. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
