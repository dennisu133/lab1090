/**
 * A Mode S pulse as the RTL-SDR delivers it.
 *
 * On air a pulse is a box: the carrier switched on for 0.5 µs. The dongle's filters (the
 * tuner's, and the RTL2832's on the way down to 2.4 million samples a second) round it off
 * and make it ring: the magnitude rises over about 0.4 µs, falls as slowly, then dips below
 * the noise around 0.7 µs after the pulse's start, and comes back up a little after that. At
 * one bit per µs, that ringing lands in the neighbouring half bits: a 0 followed by a 1
 * (pulse late, then pulse early) looks different from what two separate pulses would.
 *
 * The table is the magnitude of sample k for a pulse of amplitude 1 starting at tick P (12 MHz
 * ticks, as in demodulator.ts: a sample is 5, a pulse 6), by d = 5k − P: how far the sample's
 * start lies after the pulse's. Measured, not derived: a least-squares fit over 3,000 messages
 * that readsb decoded intact from a recording on 18 Nov 2026 (R820T dongle, 49.6 dB), with
 * tools/pulse-shape.ts. The same fit on other minutes of traffic gives the same shape: it's
 * the dongle's, not the aircraft's.
 *
 *   d    −10 … −6   −5 … 0         1 … 6          7 … 12          13 … 19
 *        ≈ 0        rising to 1    falling to 0   dip to −0.10    bump to +0.10
 *
 * (The box model in modulate.ts's default would give the overlap of a 5-tick sample with
 * a 6-tick pulse: 1 for d = 0 and 1, sloping to 0 at −5 and 6, nothing outside.)
 */

/** The first d in PULSE. */
export const PULSE_FROM = -10;

export const PULSE = [
	-0.024, -0.035, -0.045, -0.033, 0.028, 0.12, 0.247, 0.431, 0.677, 0.884, 1, 0.965, 0.827, 0.619,
	0.403, 0.205, 0.058, -0.031, -0.087, -0.096, -0.077, -0.034, 0.006, 0.058, 0.104, 0.1, 0.058,
	0.02, -0.002, 0.007
];

/** One past the last d in PULSE. */
export const PULSE_TO = PULSE_FROM + PULSE.length;

/** The pulse's magnitude at d ticks (0 outside the table). */
export function pulseShape(d: number): number {
	return d >= PULSE_FROM && d < PULSE_TO ? PULSE[d - PULSE_FROM] : 0;
}
