import type { Socket } from 'bun';
import type { SourceStatus } from '#lib/receiver-types.ts';

/**
 * A long-lived TCP client that never gives up: for a receiver's feed, whether Beast messages
 * from readsb (beast/client.ts) or raw samples from rtl_tcp (sdr/rtl-tcp.ts).
 *
 * - Each connection gets a fresh reader from `open`: a new connection is a new byte stream.
 * - Reconnects with exponential backoff (1 s, 2 s, 4 s … up to 30 s) when the connection fails
 *   or drops, e.g. when the Pi reboots or Wi-Fi hiccups.
 * - Watchdog: if no bytes arrive for `idleTimeoutMs`, the connection is treated as dead and
 *   replaced. TCP alone can't tell a quiet sky from a dead link: if the Pi loses power, no FIN
 *   is ever sent and the socket would just sit there.
 */

export interface TcpClientOptions {
	host: string;
	port: number;
	/**
	 * A new connection: send what's needed first, and return what reads its bytes. `fail`
	 * drops the connection (and tries again later), e.g. when the other end speaks another
	 * protocol.
	 */
	open: (
		send: (bytes: Uint8Array) => void,
		fail: (reason: string) => void
	) => (data: Uint8Array) => void;
	onStatus?: (status: SourceStatus) => void;
	minBackoffMs?: number;
	maxBackoffMs?: number;
	idleTimeoutMs?: number;
}

export class TcpClient {
	readonly stats = { connections: 0 };
	status: SourceStatus = { state: 'closed' };

	#opts: Required<TcpClientOptions>;
	/** The live socket. Events from any other (old) socket are ignored. */
	#socket: Socket | null = null;
	#read: (data: Uint8Array) => void = () => {};
	#closed = false;
	/** Consecutive failed attempts; drives the backoff. */
	#failures = 0;
	#lastDataAt = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#watchdog: ReturnType<typeof setInterval> | undefined;

	constructor(options: TcpClientOptions) {
		this.#opts = {
			onStatus: () => {},
			minBackoffMs: 1_000,
			maxBackoffMs: 30_000,
			idleTimeoutMs: 90_000,
			...options
		};
	}

	start(): this {
		this.#connect();
		return this;
	}

	/** Stop for good: close the connection, cancel any pending retry. */
	close(): void {
		this.#closed = true;
		clearTimeout(this.#retryTimer);
		this.#stopWatchdog();
		const socket = this.#socket;
		this.#socket = null;
		socket?.end();
		this.#setStatus({ state: 'closed' });
	}

	async #connect(): Promise<void> {
		if (this.#closed) return;
		this.#setStatus({ state: 'connecting', attempt: this.#failures + 1 });
		try {
			await Bun.connect({
				hostname: this.#opts.host,
				port: this.#opts.port,
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
			if (this.#closed) return;
			this.#scheduleRetry(`connect failed: ${(error as Error).message}`);
		}
	}

	#onOpen(socket: Socket): void {
		if (this.#closed) {
			socket.end();
			return;
		}
		this.#socket = socket;
		this.#read = this.#opts.open(
			(bytes) => socket.write(bytes),
			(reason) => {
				this.#onDisconnect(socket, reason);
				socket.terminate();
			}
		);
		this.#failures = 0;
		this.stats.connections++;
		this.#startWatchdog();
		this.#setStatus({ state: 'connected' });
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
		if (!this.#closed) this.#scheduleRetry(reason);
	}

	#scheduleRetry(reason: string): void {
		const { minBackoffMs, maxBackoffMs } = this.#opts;
		const retryInMs = Math.min(maxBackoffMs, minBackoffMs * 2 ** this.#failures);
		this.#failures++;
		this.#setStatus({ state: 'waiting', retryInMs, reason });
		this.#retryTimer = setTimeout(() => this.#connect(), retryInMs);
	}

	#startWatchdog(): void {
		const { idleTimeoutMs } = this.#opts;
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

	#setStatus(status: SourceStatus): void {
		this.status = status;
		this.#opts.onStatus(status);
	}
}
