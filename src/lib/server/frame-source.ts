import type { SourceStatus } from '#lib/receiver-types.ts';
import { BeastClient } from './beast/client';
import type { SampleDecoder } from './sdr/decoder';
import { Recording } from './sdr/recording';
import { RtlSdr } from './sdr/rtl-sdr';
import { RtlTcp } from './sdr/rtl-tcp';
import type { Source } from './settings';

/**
 * Where the Receiver's messages come from (settings.ts Source). Each keeps itself going
 * (reconnects, restarts) until closed, and reports how it's doing for the status bar.
 *
 * Messages from an RTL-SDR (directly, through rtl_tcp or recorded) are demodulated here
 * (lib/demod); a Beast feed brings them demodulated by another lab1090, readsb or dump1090.
 */
export interface FrameSource {
	readonly status: SourceStatus;
	/** Sources that deliver samples demodulate them here (and report on it). */
	readonly decoder?: SampleDecoder;
	start(): this;
	close(): void;
}

/**
 * A Mode S message as the Receiver takes it, whoever demodulated it: our demodulator
 * (lib/demod, DemodulatedFrame) or readsb/dump1090 (a Beast frame). The same three things
 * Beast carries, so a Beast feed passes its frames on as they are.
 */
export interface ModeSFrame {
	/** The message: 7 bytes (56 bits, short) or 14 (112 bits, long). */
	data: Uint8Array;
	/**
	 * When it arrived, in ticks of a 12 MHz clock: the receiver's own, not wall-clock time.
	 * Only differences mean something (the radar finder times sweeps with them).
	 */
	timestamp: number;
	/**
	 * Signal level 0–255, 255 = full scale. Ours is the pulse amplitude; readsb's reads 3 dB
	 * lower (its power is averaged over pulses and gaps).
	 */
	signal: number;
}

export type FrameHandler = (frame: ModeSFrame) => void;

export function openSource(
	source: Source,
	onFrame: FrameHandler,
	onStatus: (status: SourceStatus) => void = () => {}
): FrameSource {
	switch (source.kind) {
		case 'rtlsdr':
			return new RtlSdr({ device: source.device, gain: source.gain, onFrame, onStatus });
		case 'rtl-tcp':
			return new RtlTcp({ ...source.endpoint, gain: source.gain, onFrame, onStatus });
		case 'beast':
			return new BeastClient({
				...source.endpoint,
				// Mode S only: a Beast feed may carry Mode A/C replies too (readsb --modeac).
				onFrame: (frame) => {
					if (frame.kind !== 'modeac') onFrame(frame);
				},
				onStatus
			});
		case 'samples':
			return new Recording({ file: source.file, onFrame, onStatus });
	}
}
