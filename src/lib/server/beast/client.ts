import { TcpClient, type TcpClientOptions } from '../tcp-client';
import { BeastParser, type BeastFrame } from './parser';

/**
 * A Beast feed (another lab1090's --beast-out, readsb or dump1090, TCP port 30005): messages
 * demodulated elsewhere. The
 * connection never gives up (TcpClient: backoff, watchdog); each connection gets a fresh
 * BeastParser. readsb sends a keepalive every 60 s (`--net-heartbeat 60`), so 90 s of silence
 * means the link is dead.
 */

export interface BeastClientOptions extends TcpClientOptions {
	onFrame: (frame: BeastFrame) => void;
}

export class BeastClient extends TcpClient {
	override readonly stats = { connections: 0, frames: 0 };
	#onFrame: (frame: BeastFrame) => void;

	constructor({ onFrame, ...options }: BeastClientOptions) {
		super(options);
		this.#onFrame = onFrame;
	}

	protected open(): (data: Uint8Array) => void {
		const parser = new BeastParser();
		return (data) => {
			for (const frame of parser.push(data)) {
				this.stats.frames++;
				try {
					this.#onFrame(frame);
				} catch (error) {
					console.error('BeastClient: onFrame threw', error);
				}
			}
		};
	}
}
