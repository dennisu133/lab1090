import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { SourceStatus } from '#lib/receiver-types.ts';
import type { FrameHandler, FrameSource } from '../frame-source';
import { SampleDecoder } from './decoder';

/**
 * Samples recorded with rtl_sdr, played at the pace they were recorded (2.4 million a second,
 * by the clock), once: for a busy sky on a quiet day, or a recording that shows something.
 *
 *   rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 72000000 sky.u8     (30 s, 144 MB)
 *   lab1090 --samples sky.u8
 */

export interface RecordingOptions {
	file: string;
	onFrame: FrameHandler;
	onStatus?: (status: SourceStatus) => void;
}

/** How often the samples due by then are read and demodulated. */
const TICK_MS = 50;

export class Recording implements FrameSource {
	status: SourceStatus = { state: 'closed' };
	readonly decoder: SampleDecoder;
	#opts: Required<RecordingOptions>;
	#closed = false;

	constructor(options: RecordingOptions) {
		this.#opts = { onStatus: () => {}, ...options };
		this.decoder = new SampleDecoder(options.onFrame);
	}

	start(): this {
		void this.#play();
		return this;
	}

	close(): void {
		this.#closed = true;
		this.#setStatus({ state: 'closed' });
	}

	async #play(): Promise<void> {
		const file = Bun.file(this.#opts.file);
		const size = file.size;
		this.decoder.restart();
		this.#setStatus({ state: 'connected' });
		const start = performance.now();
		let at = 0;
		while (!this.#closed && at < size) {
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
		if (!this.#closed) this.#setStatus({ state: 'ended' });
	}

	#setStatus(status: SourceStatus): void {
		this.status = status;
		this.#opts.onStatus(status);
	}
}
