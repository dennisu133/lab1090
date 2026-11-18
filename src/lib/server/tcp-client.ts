import type { Socket } from 'bun';
import { SourceBase, type SourceOptions } from './source-base';

/**
 * A long-lived TCP client that never gives up: for a receiver's feed, whether Beast messages
 * from readsb (beast/client.ts) or raw samples from rtl_tcp (sdr/rtl-tcp.ts).
 *
 * - Each connection gets a fresh reader from `open` (the subclass's): a new connection is a
 *   new byte stream.
 * - Reconnects with backoff (SourceBase: 1 s, 2 s, 4 s … up to 30 s) when the connection fails
 *   or drops, e.g. when the Pi reboots or Wi-Fi hiccups.
 * - Watchdog: if no bytes arrive for `idleTimeoutMs`, the connection is treated as dead and
 *   replaced. TCP alone can't tell a quiet sky from a dead link: if the Pi loses power, no FIN
 *   is ever sent and the socket would just sit there.
 */

export interface TcpClientOptions extends SourceOptions {
	host: string;
	port: number;
	idleTimeoutMs?: number;
}

export abstract class TcpClient extends SourceBase {
	readonly stats = { connections: 0 };

	#host: string;
	#port: number;
	#idleTimeoutMs: number;
	/** The live socket. Events from any other (old) socket are ignored. */
	#socket: Socket | null = null;
	#read: (data: Uint8Array) => void = () => {};
	#lastDataAt = 0;
	#watchdog: ReturnType<typeof setInterval> | undefined;

	constructor({ host, port, idleTimeoutMs = 90_000, ...options }: TcpClientOptions) {
		super(options);
		this.#host = host;
		this.#port = port;
		this.#idleTimeoutMs = idleTimeoutMs;
	}

	/**
	 * A new connection: send what's needed first, and return what reads its bytes. `fail`
	 * drops the connection (and tries again later), e.g. when the other end speaks another
	 * protocol.
	 */
	protected abstract open(
		send: (bytes: Uint8Array) => void,
		fail: (reason: string) => void
	): (data: Uint8Array) => void;

	start(): this {
		this.#connect();
		return this;
	}

	/** Stop for good: close the connection, cancel any pending retry. */
	override close(): void {
		super.close();
		this.#stopWatchdog();
		const socket = this.#socket;
		this.#socket = null;
		socket?.end();
	}

	async #connect(): Promise<void> {
		if (this.closed) return;
		this.setStatus({ state: 'connecting' });
		try {
			await Bun.connect({
				hostname: this.#host,
				port: this.#port,
				socket: {
					open: (socket) => this.#onOpen(socket),
					data: (socket, data) => this.#onData(socket, data),
					close: (socket, error) =>
						this.#onDisconnect(socket, error?.message ?? 'connection closed'),
					error: (socket, error) => this.#onDisconnect(socket, error.message),
					// Handled by the catch below; defining it avoids an "unhandled rejection" report.
					connectError: () => {}
				}
			});
		} catch (error) {
			this.retry(`connect failed: ${(error as Error).message}`, () => this.#connect());
		}
	}

	#onOpen(socket: Socket): void {
		if (this.closed) {
			socket.end();
			return;
		}
		this.#socket = socket;
		this.#read = this.open(
			(bytes) => socket.write(bytes),
			(reason) => {
				this.#onDisconnect(socket, reason);
				socket.terminate();
			}
		);
		this.stats.connections++;
		this.#startWatchdog();
		this.connected();
	}

	#onData(socket: Socket, data: Uint8Array): void {
		if (socket !== this.#socket) return;
		this.#lastDataAt = performance.now(); // any bytes count, including keepalives
		try {
			this.#read(data);
		} catch (error) {
			// A bug in the consumer must not tear down the connection (and cause a reconnect loop
			// that hides the bug), so report it and carry on.
			console.error('TcpClient: reading threw', error);
		}
	}

	#onDisconnect(socket: Socket, reason: string): void {
		if (socket !== this.#socket) return; // stale socket, or already handled (error + close both fire)
		this.#socket = null;
		this.#stopWatchdog();
		this.retry(reason, () => this.#connect());
	}

	#startWatchdog(): void {
		const idleTimeoutMs = this.#idleTimeoutMs;
		this.#lastDataAt = performance.now();
		this.#watchdog = setInterval(
			() => {
				const socket = this.#socket;
				if (!socket || performance.now() - this.#lastDataAt < idleTimeoutMs) return;
				this.#onDisconnect(socket, `no data for ${idleTimeoutMs / 1000} s`);
				socket.terminate(); // the link is presumably dead, don't wait for a graceful close
			},
			Math.min(1_000, idleTimeoutMs / 4)
		);
	}

	#stopWatchdog(): void {
		clearInterval(this.#watchdog);
		this.#watchdog = undefined;
	}
}
