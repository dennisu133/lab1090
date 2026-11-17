/**
 * What the RTL-SDR delivers, and how we turn it into something we can look for pulses in.
 *
 * The dongle tunes to 1090 MHz and mixes the signal down to 0 Hz: what's left is the radio
 * wave's envelope (how strong) and its phase, as a stream of complex samples. Each sample is
 * two bytes, I and Q (in-phase and quadrature: the x and y of a point that circles round the
 * origin as the phase turns), unsigned 8-bit with 127.5 as zero ("UC8", what `rtl_sdr`
 * writes). 2.4 million samples per second: one every 0.417 µs.
 *
 * Mode S is pulse position modulation of the transmitter's power: a pulse is the carrier
 * switched on for 0.5 µs. Its phase carries nothing (and wanders, since the aircraft's
 * transmitter and the dongle aren't on exactly the same frequency), so all we keep of each
 * sample is its length, the magnitude √(I² + Q²): how much signal there is at that moment.
 * 65,536 combinations of two bytes: a lookup table does it.
 */

export const SAMPLE_RATE = 2_400_000;
/** Samples per microsecond (2.4): Mode S's timing is in µs. */
export const SAMPLES_PER_US = SAMPLE_RATE / 1e6;

/** The magnitude that stands for full scale (I or Q at its limit): 1.0 = 65535. */
export const FULL_SCALE = 65535;

/**
 * The ADC's limit as a magnitude: I or Q at its last code (0 or 255) is 127.5/128 of full
 * scale. A sample this strong (or stronger, I and Q both large) means the wave reached the
 * edge of what the 8 bits can hold: at some phase of the carrier it was cut off ("clipped").
 */
export const ADC_LIMIT = Math.floor((127.5 / 128) * FULL_SCALE);

/** Magnitude of every (I, Q) byte pair, index (I << 8) | Q. Clipped at full scale. */
const MAGNITUDE = Uint16Array.from({ length: 65536 }, (_, index) => {
	const i = ((index >> 8) - 127.5) / 128;
	const q = ((index & 0xff) - 127.5) / 128;
	return Math.min(FULL_SCALE, Math.round(Math.hypot(i, q) * FULL_SCALE));
});

/** Magnitudes of `count` IQ pairs from `iq` (starting at byte `from`) into `out` at `at`. */
export function magnitudes(
	iq: Uint8Array,
	from: number,
	count: number,
	out: Uint16Array,
	at: number
): void {
	for (let k = 0; k < count; k++) {
		const b = from + 2 * k;
		out[at + k] = MAGNITUDE[(iq[b] << 8) | iq[b + 1]];
	}
}

/** A magnitude as dB below full scale (amplitude: 20·log₁₀). */
export function magnitudeDbfs(magnitude: number): number {
	return 20 * Math.log10(magnitude / FULL_SCALE);
}
