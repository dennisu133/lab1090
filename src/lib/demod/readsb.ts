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

/** 12 MHz ticks per sample. */
const SAMPLE = 5;

/**
 * readsb's preamble threshold, in 32nds: its correlation must reach 58/32 = 1.8 times the sum
 * of five noise samples (readsb's default, PREAMBLE_THRESHOLD_DEFAULT).
 */
const THRESHOLD = 58;

/**
 * Whether readsb would try a message starting between sample n and n + 1 (ticks 5n … 5n + 4).
 *
 * readsb looks at sample p for a preamble starting 0.6 to 1.4 samples after it: at tick
 * 5p + 3 … 5p + 7, its "phases" 3 to 7. So p = n covers our starts 5n + 3 and 5n + 4, and
 * p = n − 1 the others. For each p: three comparisons first (the 2nd pulse above a gap
 * sample, the 4th above two), then for each group of phases a sum of the samples the pulses
 * fill minus the ones between pulses that the phase leaves empty, against the noise samples.
 * `mag` must hold a sample before n.
 */
export function readsbPreamble(mag: Uint16Array, n: number): boolean {
	// p = n: phases 3 and 4 (peaks at samples 1, 3, 9 and 11–12).
	let p = n;
	if (mag[p + 1] > mag[p + 7] && mag[p + 12] > mag[p + 14] && mag[p + 12] > mag[p + 15]) {
		const ref = (noise(mag, p) * THRESHOLD) >> 5;
		if (common(mag, p) - (mag[p + 10] - mag[p + 11]) >= ref) return true;
	}
	if (n === 0) return false;
	// p = n − 1: phases 5 and 6 (peaks at 1, 3–4, 9–10, 12), and 7 (1–2, 4, 10, 12).
	p = n - 1;
	if (mag[p + 1] > mag[p + 7] && mag[p + 12] > mag[p + 14] && mag[p + 12] > mag[p + 15]) {
		const ref = (noise(mag, p) * THRESHOLD) >> 5;
		const d1011 = mag[p + 10] - mag[p + 11];
		if (common(mag, p) + d1011 >= ref) return true;
		if (mag[p + 1] + mag[p + 4] + 2 * (mag[p + 2] - mag[p + 3]) + d1011 + mag[p + 12] >= ref)
			return true;
	}
	return false;
}

/** Five samples that lie between the pulses whatever the phase. */
function noise(mag: Uint16Array, p: number): number {
	return mag[p + 5] + mag[p + 8] + mag[p + 16] + mag[p + 17] + mag[p + 18];
}

/** The part of the correlation phases 3 to 6 share. */
function common(mag: Uint16Array, p: number): number {
	return mag[p + 1] + mag[p + 4] - (mag[p + 2] - mag[p + 3]) + mag[p + 9] + mag[p + 12];
}

/**
 * The bit starting at tick t: 1 if its pulse is in the first half. Sample k = ⌊t/5⌋ is the
 * first the bit reaches; t mod 5 is how far into it the bit starts (in fifths of a sample).
 */
export function sliceBit(mag: Uint16Array, t: number): 0 | 1 {
	const k = (t / SAMPLE) | 0;
	let v: number;
	switch (t - k * SAMPLE) {
		case 0:
			v = 18 * mag[k] - 15 * mag[k + 1] - 3 * mag[k + 2];
			break;
		case 1:
			v = 14 * mag[k] - 5 * mag[k + 1] - 9 * mag[k + 2];
			break;
		case 2:
			// readsb: "slightly DC unbalanced but better results".
			v = 16 * mag[k] + 5 * mag[k + 1] - 20 * mag[k + 2];
			break;
		case 3:
			v = 7 * mag[k] + 11 * mag[k + 1] - 18 * mag[k + 2];
			break;
		default:
			v = 4 * mag[k] + 15 * mag[k + 1] - 20 * mag[k + 2] + mag[k + 3];
	}
	return v > 0 ? 1 : 0;
}
