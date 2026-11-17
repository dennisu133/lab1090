import type { SourceStatus } from '#lib/receiver-types.ts';
import { BeastClient } from './beast/client';
import type { BeastFrame } from './beast/parser';
import { Recording } from './sdr/recording';
import { RtlSdr } from './sdr/rtl-sdr';
import { RtlTcp } from './sdr/rtl-tcp';
import type { Source } from './settings';

/**
 * Where the Receiver's messages come from (settings.ts Source). Each keeps itself going
 * (reconnects, restarts) until closed, and reports how it's doing for the status bar.
 *
 * Messages from an RTL-SDR (directly, through rtl_tcp or recorded) are demodulated here
 * (lib/demod); a Beast feed brings them demodulated by readsb or dump1090.
 */
export interface FrameSource {
	readonly status: SourceStatus;
	start(): this;
	close(): void;
}

export type FrameHandler = (frame: BeastFrame) => void;

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
			return new BeastClient({ ...source.endpoint, onFrame, onStatus });
		case 'samples':
			return new Recording({ file: source.file, onFrame, onStatus });
	}
}
