import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { FrameHandler, FrameSource } from '../frame-source';
import { TcpClient, type TcpClientOptions } from '../tcp-client';
import { SampleDecoder } from './decoder';
import { FREQUENCY_HZ } from './rtl-sdr';

/**
 * An RTL-SDR on another machine, through `rtl_tcp` (from the same rtl-sdr package): it
 * serves the dongle's raw samples over TCP, 4.8 MB a second (38 Mbit/s: fine over Ethernet,
 * too much for weak Wi-Fi). On the other machine:
 *
 *   rtl_tcp -a 0.0.0.0
 *
 * The protocol (rtl_tcp.c, no other documentation):
 *   server → client: 12 bytes, "RTL0", the tuner type and its number of gain steps (both
 *                    32-bit big-endian), then samples, UC8, without end.
 *   client → server: 5-byte commands, a command byte and a 32-bit big-endian value:
 *                    1 frequency (Hz), 2 sample rate, 3 gain mode (1 = manual),
 *                    4 gain (tenths of a dB), 8 the RTL2832's own AGC (0 = off).
 *
 * The connection never gives up (TcpClient). There's no keepalive: samples flow all the time,
 * so 10 s without any means the link is dead.
 */

export interface RtlTcpOptions extends TcpClientOptions {
	gain: number;
	onFrame: FrameHandler;
}

const HEADER = 12;
const MAGIC = 'RTL0';

/**
 * The tuner named by the header's type number (librtlsdr's enum rtlsdr_tuner, in the order
 * of its "Found … tuner" messages). rtl_tcp doesn't tell R828D from R820T apart from this.
 */
export const TUNERS = [
	null,
	'Elonics E4000',
	'Fitipower FC0012',
	'Fitipower FC0013',
	'FCI 2580',
	'Rafael Micro R820T',
	'Rafael Micro R828D'
];

/** The tuner from rtl_tcp's 12-byte header (as a string of byte values). */
export function tunerName(header: string): string | null {
	const type =
		((header.charCodeAt(4) << 24) |
			(header.charCodeAt(5) << 16) |
			(header.charCodeAt(6) << 8) |
			header.charCodeAt(7)) >>>
		0;
	return TUNERS[type] ?? null;
}

/** The commands that set up the dongle for Mode S. */
export function setupCommands(gain: number): Uint8Array {
	const commands: [number, number][] = [
		[2, SAMPLE_RATE],
		[1, FREQUENCY_HZ],
		[3, 1],
		[4, Math.round(gain * 10)],
		[8, 0]
	];
	const bytes = new Uint8Array(commands.length * 5);
	const view = new DataView(bytes.buffer);
	commands.forEach(([command, value], i) => {
		view.setUint8(i * 5, command);
		view.setUint32(i * 5 + 1, value);
	});
	return bytes;
}

export class RtlTcp extends TcpClient implements FrameSource {
	readonly decoder: SampleDecoder;
	#gain: number;

	constructor({ gain, onFrame, ...options }: RtlTcpOptions) {
		super({ idleTimeoutMs: 10_000, ...options });
		this.#gain = gain;
		this.decoder = new SampleDecoder(onFrame, { gain });
	}

	protected open(
		send: (bytes: Uint8Array) => void,
		fail: (reason: string) => void
	): (data: Uint8Array) => void {
		send(setupCommands(this.#gain));
		this.decoder.restart();
		let header = '';
		return (data) => {
			let at = 0;
			while (header.length < HEADER && at < data.length) {
				header += String.fromCharCode(data[at++]);
				if (header.length === MAGIC.length && header !== MAGIC) {
					fail(`not an rtl_tcp server (it doesn't start with "${MAGIC}")`);
					return;
				}
				if (header.length === HEADER) this.decoder.device.tuner = tunerName(header);
			}
			if (at < data.length) this.decoder.push(data.subarray(at));
		};
	}
}
