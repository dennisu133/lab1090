import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { FrameHandler, FrameSource } from '../frame-source';
import { SourceBase, type SourceOptions } from '../source-base';
import { SampleDecoder } from './decoder';

/**
 * Samples recorded with rtl_sdr, played at the pace they were recorded (2.4 million a second,
 * by the clock), once: for a busy sky on a quiet day, or a recording that shows something.
 *
 *   rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 72000000 sky.u8     (30 s, 144 MB)
 *   lab1090 --samples sky.u8
 */

export interface RecordingOptions extends Pick<SourceOptions, 'onStatus'> {
	file: string;
	onFrame: FrameHandler;
}

/** How often the samples due by then are read and demodulated. */
const TICK_MS = 50;

/** Played once: when it ends, it says so (`ended`) and isn't started again. */
export class Recording extends SourceBase implements FrameSource {
	readonly decoder: SampleDecoder;
	#file: string;

	constructor({ file, onFrame, onStatus }: RecordingOptions) {
		super({ onStatus });
		this.#file = file;
		this.decoder = new SampleDecoder(onFrame, { live: false });
	}

	start(): this {
		void this.#play();
		return this;
	}

	async #play(): Promise<void> {
		const file = Bun.file(this.#file);
		const size = file.size;
		this.decoder.restart();
		this.setStatus({ state: 'connected' });
		const start = performance.now();
		let at = 0;
		while (!this.closed && at < size) {
			const due = Math.min(
				size,
				2 * Math.floor(((performance.now() - start) / 1000) * SAMPLE_RATE)
			);
			if (due > at) {
				this.decoder.push(new Uint8Array(await file.slice(at, due).arrayBuffer()));
				at = due;
			}
			await Bun.sleep(TICK_MS);
		}
		if (!this.closed) this.setStatus({ state: 'ended' });
	}
}
