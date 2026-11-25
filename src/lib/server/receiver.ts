import { openSource, type FrameSource, type ModeSFrame } from './frame-source';
import { BeastServer } from './beast/server';
import { BATCH_MS, ReceiverHub } from '#lib/receiver/hub.ts';
import type { SampleRecorder } from './record/recorder';
import { describeSource, type Source } from './settings';
import type { SourceEvent } from '#lib/receiver-types.ts';

/**
 * The app's single source of messages (frame-source.ts: the RTL-SDR, rtl_tcp, a Beast feed,
 * a recording), fanned out to the browser tabs by the hub (lib/receiver/hub.ts: verdicts,
 * counts, buffers, trails, batches), every 250 ms by the wall clock.
 * With `beastOut`, every frame also goes out at once as Beast on that port (BeastServer).
 * With a `recorder` (--record), the source's samples also go into a file, and every update
 * says how far it got.
 */
export class Receiver extends ReceiverHub {
	#client: FrameSource;
	#beast: BeastServer | null;
	#recorder: SampleRecorder | null;
	#timer: ReturnType<typeof setInterval> | undefined;
	/** Say on the console which source this is and how its link is doing (#log). */
	#logging: boolean;

	constructor(
		source: Source,
		{
			log = true,
			beastOut = null,
			recorder = null
		}: { log?: boolean; beastOut?: number | null; recorder?: SampleRecorder | null } = {}
	) {
		super(describeSource(source), () => ({
			status: this.#client.status,
			demod: this.#client.decoder?.report() ?? null,
			replay: this.#client.replay,
			recording: this.#recorder?.report() ?? null
		}));
		this.#logging = log;
		this.#beast = beastOut === null ? null : new BeastServer({ port: beastOut });
		this.#client = openSource(
			source,
			(f) => this.#onFrame(f),
			(status) => {
				const event = this.radio.status(status, Date.now());
				if (this.#logging && event) this.#log(event);
			}
		);
		this.#recorder = recorder;
		if (recorder) {
			if (!this.#client.decoder) throw new Error('only a source of samples can be recorded');
			recorder.attach(this.#client.decoder);
		}
	}

	/**
	 * Say on the console when the link to the receiver comes up or goes down, and why: on a
	 * Pi without a screen that's the first place to look. Only new events (RadioHistory): a
	 * retry for the same reason is said once, not every 30 s.
	 */
	#log(event: SourceEvent): void {
		if (event.state === 'waiting') console.warn(`${this.source}: ${event.reason}, trying again`);
		else if (event.state === 'connected') console.log(`${this.source}: receiving`);
		else
			console.log(`${this.source}: the replay has ended${event.reason ? `: ${event.reason}` : ''}`);
	}

	/**
	 * The source is named before the first attempt, so that its outcome (`…: receiving`, or
	 * why not) reads as the next line. In dev, a hot reload starts a new Receiver: named again.
	 */
	start(): this {
		if (this.#logging) console.log(`Source: ${this.source}`);
		try {
			this.#beast?.start();
		} catch (error) {
			// The page still works without it; say so where a Pi's owner looks.
			console.error(`Beast output on port ${this.#beast?.port}: ${(error as Error).message}`);
		}
		this.#client.start();
		this.#timer = setInterval(() => this.flush(Date.now()), BATCH_MS);
		return this;
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#client.close();
		this.#beast?.stop();
		this.disconnectAll();
	}

	#onFrame(f: ModeSFrame): void {
		this.#beast?.add(f);
		this.add(f, Date.now());
	}
}
