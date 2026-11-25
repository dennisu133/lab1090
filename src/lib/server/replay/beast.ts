import type { ReplayInfo } from '#lib/receiver-types.ts';
import { BeastParser, type BeastFrame } from '#lib/beast/parser.ts';
import type { FrameHandler, FrameSource } from '../frame-source';
import { SourceBase, type SourceOptions } from '../source-base';

/**
 * Beast messages from a file, played at the pace they were received, by their timestamps
 * (the receiver's 12 MHz clock): what readsb or lab1090 sent on port 30005, saved with
 *
 *   timeout 3600 bash -c 'cat < /dev/tcp/pi/30005' > sky.beast
 *   lab1090 --replay sky.beast --loop
 *
 * Small (an hour of busy traffic is ~7 MB) and cheap to play: nothing to demodulate. For a
 * demonstration, or to work on the page at night. tools/replay.ts does the same over TCP,
 * and can add synthetic alerts or a jammer.
 *
 * Timestamps are moved to the server's clock, as the demodulator's are (decoder.ts), so they
 * keep growing from one time round to the next instead of jumping back: the radar finder
 * times sweeps with them. The aircraft do jump back to where they were at the start.
 */

export interface BeastReplayOptions extends Pick<SourceOptions, 'onStatus'> {
	file: string;
	loop: boolean;
	onFrame: FrameHandler;
}

/** How often the frames due by then go out (readsb also sends in small batches). */
const TICK_MS = 50;
/** 12 MHz ticks per ms. */
const TICKS_PER_MS = 12_000;

export class BeastReplay extends SourceBase implements FrameSource {
	readonly replay: ReplayInfo;
	#options: BeastReplayOptions;

	constructor(options: BeastReplayOptions) {
		super({ onStatus: options.onStatus });
		this.#options = options;
		this.replay = {
			file: options.file,
			kind: 'beast',
			loop: options.loop,
			label: null,
			recorder: null,
			recordedAt: null
		};
	}

	start(): this {
		void this.#play().catch((e: Error) => {
			if (this.closed) return;
			console.error(`${this.#options.file}: ${e.message}`);
			this.setStatus({ state: 'ended', reason: e.message });
		});
		return this;
	}

	async #play(): Promise<void> {
		const bytes = await Bun.file(this.#options.file).bytes();
		// Mode S only: readsb --modeac adds Mode A/C replies, as on a live feed (frame-source.ts).
		const frames = new BeastParser().push(bytes).filter((f) => f.kind !== 'modeac');
		if (frames.length === 0) throw new Error('no Beast frames in it');
		this.setStatus({ state: 'connected' });
		do {
			if (!(await this.#once(frames))) return;
		} while (this.#options.loop);
		this.setStatus({ state: 'ended' });
	}

	/** One time through; false if closed meanwhile. */
	async #once(frames: BeastFrame[]): Promise<boolean> {
		const t0 = frames[0].timestamp;
		const start = performance.now();
		const base = Math.round(start * TICKS_PER_MS);
		let i = 0;
		while (i < frames.length) {
			if (this.closed) return false;
			const now = (performance.now() - start) * TICKS_PER_MS;
			// A timestamp before the first (the receiver restarted while recording) is due at once.
			while (i < frames.length && frames[i].timestamp - t0 <= now) {
				const { data, signal, timestamp } = frames[i++];
				try {
					this.#options.onFrame({ data, signal, timestamp: base + Math.max(0, timestamp - t0) });
				} catch (error) {
					console.error('BeastReplay: onFrame threw', error);
				}
			}
			await Bun.sleep(TICK_MS);
		}
		return true;
	}
}
