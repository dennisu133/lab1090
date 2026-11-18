import type { Subprocess } from 'bun';
import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { DeviceInfo, SourceStatus } from '#lib/receiver-types.ts';
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
		this.decoder = new SampleDecoder(options.onFrame, { gain: options.gain });
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
		this.#setStatus({ state: 'connecting' });
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
		const listed = new Map<string, string>();
		const messages = readLines(process.stderr, (line) => learn(line, this.decoder.device, listed));
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
				try {
					this.decoder.push(chunk);
				} catch (e) {
					// A bug in the demodulator, not the dongle: say so, and stop this run
					// rather than go on with a decoder in an unknown state.
					console.error('lab1090: the demodulator failed:', e);
					stalled = 'the demodulator failed (the server log has the error)';
					process.kill();
					break;
				}
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
		this.#setStatus({ state: 'waiting', retryInMs, retryAt: Date.now() + retryInMs, reason });
		this.#retryTimer = setTimeout(() => void this.#run(), retryInMs);
	}

	#setStatus(status: SourceStatus): void {
		this.status = status;
		this.#opts.onStatus(status);
	}
}

/**
 * What rtl_sdr (and librtlsdr in it) says about the dongle as it starts, into `device`:
 *
 *   Found 1 device(s):
 *     0:  Realtek, RTL2838UHIDIR, SN: 00000001
 *   Using device 0: Generic RTL2832U OEM
 *   Found Rafael Micro R820T tuner
 *   Tuner gain set to 49.60 dB.
 *
 * `listed`: the device list so far (index → serial number), one per start.
 */
export function learn(line: string, device: DeviceInfo, listed: Map<string, string>): void {
	let m: RegExpMatchArray | null;
	if ((m = line.match(/^\s*(\d+):\s+.*,\s*SN:\s*(.*?)\s*$/))) listed.set(m[1], m[2]);
	else if ((m = line.match(/^Using device (\d+): (.+?)\s*$/))) {
		device.name = m[2];
		device.serial = listed.get(m[1]) || null;
	} else if ((m = line.match(/^Found (.+) tuner/)) && m[1] !== 'No supported') device.tuner = m[1];
	else if ((m = line.match(/^Tuner gain set to ([\d.]+) dB/))) device.gain = Number(m[1]);
}

/** A stream's text, handing each complete line to `onLine` as it comes; all of it at the end. */
async function readLines(
	stream: ReadableStream<Uint8Array>,
	onLine: (line: string) => void
): Promise<string> {
	const decoder = new TextDecoder();
	let text = '';
	let from = 0;
	for await (const chunk of stream) {
		text += decoder.decode(chunk, { stream: true });
		let end: number;
		while ((end = text.indexOf('\n', from)) >= 0) {
			onLine(text.slice(from, end));
			from = end + 1;
		}
	}
	return text;
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
