import type { Subprocess } from 'bun';
import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { SourceStatus } from '#lib/receiver-types.ts';
import type { FrameHandler, FrameSource } from '../frame-source';
import { SampleDecoder } from './decoder';

/**
 * The RTL-SDR on this machine, read through the `rtl_sdr` program (Debian/Ubuntu/Raspberry Pi
 * OS: `apt install rtl-sdr`). It tunes the dongle to 1090 MHz at 2.4 million samples a second
 * and writes the samples to its output, which we demodulate.
 *
 * Why a program and not the library (librtlsdr) itself: librtlsdr is GPL, and a separate
 * program keeps it out of lab1090. The cost: the gain is set once per start.
 *
 * If it stops (dongle unplugged, in use by another program, not there at all), it's started
 * again with backoff (1 s, 2 s … 30 s), and the status says why, in words: rtl_sdr's own
 * messages are made for people who know librtlsdr.
 */

export interface RtlSdrOptions {
	/** Index (0 = the first) or serial number. */
	device: string;
	gain: number;
	onFrame: FrameHandler;
	onStatus?: (status: SourceStatus) => void;
	/** The program to run: tests use a stand-in. */
	command?: string;
	minBackoffMs?: number;
	maxBackoffMs?: number;
	/** rtl_sdr sends 4.8 MB a second: this much silence means it hangs. */
	idleTimeoutMs?: number;
}

export const FREQUENCY_HZ = 1_090_000_000;

export class RtlSdr implements FrameSource {
	status: SourceStatus = { state: 'closed' };
	readonly decoder: SampleDecoder;

	#opts: Required<RtlSdrOptions>;
	#process: Subprocess<'ignore', 'pipe', 'pipe'> | null = null;
	#closed = false;
	#failures = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: RtlSdrOptions) {
		this.#opts = {
			onStatus: () => {},
			command: 'rtl_sdr',
			minBackoffMs: 1_000,
			maxBackoffMs: 30_000,
			idleTimeoutMs: 10_000,
			...options
		};
		this.decoder = new SampleDecoder(options.onFrame);
	}

	start(): this {
		void this.#run();
		return this;
	}

	close(): void {
		this.#closed = true;
		clearTimeout(this.#retryTimer);
		this.#process?.kill();
		this.#process = null;
		this.#setStatus({ state: 'closed' });
	}

	async #run(): Promise<void> {
		if (this.#closed) return;
		const { command, device, gain, idleTimeoutMs } = this.#opts;
		this.#setStatus({ state: 'connecting', attempt: this.#failures + 1 });
		// -f frequency, -s sample rate, -g gain in dB, -d device; "-": samples to the output.
		const args = [
			'-d',
			device,
			'-f',
			`${FREQUENCY_HZ}`,
			'-s',
			`${SAMPLE_RATE}`,
			'-g',
			`${gain}`,
			'-'
		];
		let process: Subprocess<'ignore', 'pipe', 'pipe'>;
		try {
			process = Bun.spawn([command, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
		} catch (error) {
			const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
			this.#retry(
				missing
					? `${command} isn't installed (apt install rtl-sdr)`
					: `${command} didn't start: ${(error as Error).message}`
			);
			return;
		}
		this.#process = process;
		const messages = new Response(process.stderr).text();
		this.decoder.restart();

		let lastData = performance.now();
		let stalled: string | null = null;
		const watchdog = setInterval(
			() => {
				if (performance.now() - lastData < idleTimeoutMs) return;
				stalled = `no samples from the RTL-SDR for ${idleTimeoutMs / 1000} s`;
				process.kill();
			},
			Math.min(1_000, idleTimeoutMs / 4)
		);
		try {
			for await (const chunk of process.stdout) {
				lastData = performance.now();
				if (this.status.state !== 'connected' && !this.#closed) {
					this.#failures = 0;
					this.#setStatus({ state: 'connected' });
				}
				this.decoder.push(chunk);
			}
		} catch {
			// The output broke off: the exit code and messages say why.
		}
		const code = await process.exited;
		clearInterval(watchdog);
		if (this.#process === process) this.#process = null;
		if (this.#closed) return;
		this.#retry(stalled ?? explain(await messages, code, device));
	}

	#retry(reason: string): void {
		const { minBackoffMs, maxBackoffMs } = this.#opts;
		const retryInMs = Math.min(maxBackoffMs, minBackoffMs * 2 ** this.#failures);
		this.#failures++;
		this.#setStatus({ state: 'waiting', retryInMs, reason });
		this.#retryTimer = setTimeout(() => void this.#run(), retryInMs);
	}

	#setStatus(status: SourceStatus): void {
		this.status = status;
		this.#opts.onStatus(status);
	}
}

/** Why rtl_sdr stopped, from what it printed (librtlsdr's messages) and its exit code. */
export function explain(messages: string, code: number | null, device: string): string {
	if (/No supported devices found/i.test(messages)) return 'no RTL-SDR found: is it plugged in?';
	if (/No matching devices found/i.test(messages)) return `no RTL-SDR "${device}" found`;
	if (/usb_claim_interface error -6|resource busy/i.test(messages)) {
		return 'the RTL-SDR is in use by another program (readsb, dump1090, rtl_tcp?)';
	}
	if (/usb_open error -3|permission/i.test(messages)) {
		return 'no permission to use the RTL-SDR (the rtl-sdr package allows it: unplug it and plug it in again after installing)';
	}
	if (/Library error|cb transfer status|lost/i.test(messages)) {
		return 'the RTL-SDR stopped sending: was it unplugged?';
	}
	const last = messages.trim().split('\n').at(-1)?.trim();
	return last ? `rtl_sdr stopped: ${last}` : `rtl_sdr stopped (exit code ${code})`;
}
