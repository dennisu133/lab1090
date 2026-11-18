/**
 * Two pieces of readsb's 2.4 MHz demodulator (demod_2400.c), ported to our 12 MHz ticks.
 * Both are cheap integer arithmetic on single samples, hand-tuned on real recordings:
 *
 * - A second way past the quick test (demodulator.ts step 1). Ours wants every pulse 1.5×
 *   above the noise level; readsb's compares the pulses with samples right next to them,
 *   so it lets in weak messages that ours stops. What only it lets in is read with the
 *   slicer alone: there's a lot of it (eight times what ours lets in), and the slicer is the
 *   cheapest reading.
 * - A bit slicer: each bit from three or four samples, weighted by where the bit starts
 *   within the first one. The weights are positive where a sample lies mostly in the bit's
 *   first half, negative in its second, and tuned by hand so that the dongle's ringing
 *   (pulse.ts) costs as little as it can for a reading this simple.
 *
 * Measured on our recordings (tools/demod-compare.ts, 18 Nov 2026): the slicer as a second
 * reading finds a third of the readsb messages we missed, the quick test most of the rest.
 *
 * From readsb (https://github.com/wiedehopf/readsb), demod_2400.c: the preamble pre-check and
 * correlation in demodulate2400(), and slice_phase0() … slice_phase4().
 *   Copyright (c) 2019 Michael Wolf <michael@mictronics.de>
 *   Copyright (c) 2014, 2015 Oliver Jowett <oliver@mutability.co.uk>
 *   Changes 2020 by Matthias Wirth (wiedehopf): the slicer's weights.
 * Licensed under the GPL, version 3 or (at your option) any later version, like lab1090.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 12 MHz ticks per sample and per µs (a bit). */
const SAMPLE = 5;
const US = 12;

/**
 * readsb's preamble threshold, in 32nds: its correlation must reach 58/32 = 1.8 times the sum
 * of five noise samples (readsb's default, PREAMBLE_THRESHOLD_DEFAULT).
 */
const THRESHOLD = 58;

/** readsbPhases: a start in sample p (readsb's phases 3 and 4)… */
export const LATE = 1;
/** …or in sample p + 1 (5, 6 and 7). */
export const EARLY = 2;

/**
 * readsb's first check at sample p: the 2nd pulse above a gap sample, the 4th above two. 1 or
 * 0, without branches (`+` and `&` instead of `&&`): it passes at random on noise, which a
 * branch would guess wrong too often, and it runs for every sample.
 */
export function readsbCheck(mag: Uint16Array, p: number): 0 | 1 {
	return (+(mag[p + 1] > mag[p + 7]) &
		+(mag[p + 12] > mag[p + 14]) &
		+(mag[p + 12] > mag[p + 15])) as 0 | 1;
}

/**
 * Then, at a sample p that passed readsbCheck, for each group of phases: a sum of the samples
 * the pulses fill minus the ones between pulses that the phase leaves empty, against five
 * noise samples. LATE and/or EARLY, or 0. Phases 3 and 4 have their peaks at samples 1, 3, 9
 * and 11–12; 5 and 6 at 1, 3–4, 9–10, 12; 7 at 1–2, 4, 10, 12.
 */
export function readsbPhases(mag: Uint16Array, p: number): number {
	const ref = (noise(mag, p) * THRESHOLD) >> 5;
	const common = mag[p + 1] + mag[p + 4] - (mag[p + 2] - mag[p + 3]) + mag[p + 9] + mag[p + 12];
	const d1011 = mag[p + 10] - mag[p + 11];
	const late = +(common - d1011 >= ref);
	const early =
		+(common + d1011 >= ref) |
		+(mag[p + 1] + mag[p + 4] + 2 * (mag[p + 2] - mag[p + 3]) + d1011 + mag[p + 12] >= ref);
	return late | (early << 1);
}

/** Five samples that lie between the pulses whatever the phase. */
function noise(mag: Uint16Array, p: number): number {
	return mag[p + 5] + mag[p + 8] + mag[p + 16] + mag[p + 17] + mag[p + 18];
}

/**
 * Bits from … to − 1 of a message whose data starts at tick t, into `bits`: 1 if the bit's
 * pulse is in its first half. Sample k = ⌊t/5⌋ is the first a bit reaches; its phase, t mod 5,
 * is how far into it the bit starts (in fifths of a sample). A bit is 12 ticks, 2 samples and
 * 2 ticks: k and the phase step along without dividing.
 */
export function sliceBits(
	mag: Uint16Array,
	t: number,
	bits: Uint8Array,
	from: number,
	to: number
): void {
	const at = t + from * US;
	let k = (at / SAMPLE) | 0;
	let phase = at - k * SAMPLE;
	for (let i = from; i < to; i++) {
		let v: number;
		switch (phase) {
			case 0:
				v = 18 * mag[k] - 15 * mag[k + 1] - 3 * mag[k + 2];
				break;
			case 1:
				v = 14 * mag[k] - 5 * mag[k + 1] - 9 * mag[k + 2];
				break;
			case 2:
				v = 16 * mag[k] + 5 * mag[k + 1] - 20 * mag[k + 2];
				break;
			case 3:
				v = 7 * mag[k] + 11 * mag[k + 1] - 18 * mag[k + 2];
				break;
			default:
				v = 4 * mag[k] + 15 * mag[k + 1] - 20 * mag[k + 2] + mag[k + 3];
		}
		bits[i] = +(v > 0);
		phase += US - 2 * SAMPLE;
		k += 2;
		if (phase >= SAMPLE) {
			phase -= SAMPLE;
			k++;
		}
	}
}
