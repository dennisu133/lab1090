import type { SourceStatus } from '#lib/receiver-types.ts';
import { TcpClient, type TcpClientOptions } from '../tcp-client';
import { BeastParser, type BeastFrame } from './parser';

/**
 * A Beast feed (readsb or dump1090, TCP port 30005): messages demodulated elsewhere. The
 * connection never gives up (TcpClient: backoff, watchdog); each connection gets a fresh
 * BeastParser. readsb sends a keepalive every 60 s (`--net-heartbeat 60`), so 90 s of silence
 * means the link is dead.
 */

export interface BeastClientOptions extends Omit<TcpClientOptions, 'open'> {
	onFrame: (frame: BeastFrame) => void;
}

export class BeastClient {
	readonly stats = { connections: 0, frames: 0 };
	#tcp: TcpClient;

	constructor({ onFrame, ...options }: BeastClientOptions) {
		this.#tcp = new TcpClient({
			...options,
			open: () => {
				this.stats.connections++;
				const parser = new BeastParser();
				return (data) => {
					for (const frame of parser.push(data)) {
						this.stats.frames++;
						try {
							onFrame(frame);
						} catch (error) {
							console.error('BeastClient: onFrame threw', error);
						}
					}
				};
			}
		});
	}

	get status(): SourceStatus {
		return this.#tcp.status;
	}

	start(): this {
		this.#tcp.start();
		return this;
	}

	close(): void {
		this.#tcp.close();
	}
}
