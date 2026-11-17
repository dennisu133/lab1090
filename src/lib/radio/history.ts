import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { RadioPoint } from '#lib/receiver-types.ts';

/** The diagnosis judges the last this many ms of the history. */
export const DIAGNOSIS_MS = 5 * 60_000;

/** A stretch of the receiver's history (RadioPoints) added up. */
export interface Summary {
	/** Time covered, s. */
	seconds: number;
	messages: number;
	/** Demodulator fields: null for a Beast feed (no point has them). */
	candidates: number | null;
	demodulated: number | null;
	clipped: number | null;
	/** Mean noise level, dBFS (each point weighted by its length). */
	noise: number | null;
	/** Time spent demodulating per second of samples (0.07 = 7 % of one core). */
	busyShare: number | null;
}

/** The points ending after `since` (ms since epoch), added up. */
export function summarize(points: readonly RadioPoint[], since: number): Summary {
	let ms = 0;
	let messages = 0;
	let demod = false;
	let candidates = 0;
	let demodulated = 0;
	let clipped = 0;
	let busyMs = 0;
	let samples = 0;
	let noiseSum = 0;
	let noiseMs = 0;
	for (const p of points) {
		if (p.t <= since) continue;
		ms += p.ms;
		messages += p.messages;
		if (p.candidates !== null) {
			demod = true;
			candidates += p.candidates;
			demodulated += p.demodulated ?? 0;
			clipped += p.clipped ?? 0;
			busyMs += p.busyMs ?? 0;
			samples += p.samples ?? 0;
		}
		if (p.noise !== null) {
			// Averaged as amplitudes, like the demodulator's own level, not as dB.
			noiseSum += 10 ** (p.noise / 20) * p.ms;
			noiseMs += p.ms;
		}
	}
	return {
		seconds: ms / 1000,
		messages,
		candidates: demod ? candidates : null,
		demodulated: demod ? demodulated : null,
		clipped: demod ? clipped : null,
		noise: noiseMs ? 20 * Math.log10(noiseSum / noiseMs) : null,
		busyShare: demod && samples ? busyMs / ((samples / SAMPLE_RATE) * 1000) : null
	};
}
