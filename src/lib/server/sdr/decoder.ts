import { Demodulator, type DemodulatorStats } from '#lib/demod/demodulator.ts';
import type { FrameHandler } from '../frame-source';

/**
 * Samples → messages, for the sources that deliver samples (rtl_sdr, rtl_tcp, a recording).
 *
 * Each run of samples (a start of rtl_sdr, a connection) gets a new Demodulator: the samples
 * before and after a gap don't belong together. Its clock starts at the server's, so
 * timestamps keep growing across restarts instead of starting over at 0, like readsb's.
 */
export class SampleDecoder {
	#demodulator = new Demodulator();
	#onFrame: FrameHandler;

	constructor(onFrame: FrameHandler) {
		this.#onFrame = onFrame;
	}

	/** A new run of samples begins. */
	restart(): void {
		this.#demodulator = new Demodulator({ startTick: Math.round(performance.now() * 12_000) });
	}

	push(iq: Uint8Array): void {
		for (const frame of this.#demodulator.push(iq)) {
			try {
				this.#onFrame(frame);
			} catch (error) {
				// A bug in the consumer must not stop the samples.
				console.error('SampleDecoder: onFrame threw', error);
			}
		}
	}

	get stats(): DemodulatorStats {
		return this.#demodulator.stats;
	}
}
