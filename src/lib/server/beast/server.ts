import type { Socket, TCPSocketListener } from 'bun';
import type { ModeSFrame } from '../frame-source';
import { encodeFrame } from '#lib/beast/encode.ts';

/**
 * lab1090's own Beast output (`--beast-out 30005`), what readsb serves with `--net-bo-port`:
 * every message this server receives, as Beast frames, to every client that connects. Another
 * lab1090 (`--connect pi:30005`), tar1090, readsb or a feeder client can then use this
 * receiver: e.g. the Pi feeds a development machine,
 * 20 KB/s instead of rtl_tcp's 38 Mbit/s of samples.
 *
 * What goes out is what the Receiver gets, unchanged and in arrival order: frames that passed
 * the demodulator's filter (lib/demod/filter.ts), repairs included, and the address check's
 * rejects too (the receiving end does its own, as readsb does with Beast input). The timestamp
 * is the demodulator's 12 MHz clock, Beast's own unit. The signal byte is our pulse amplitude,
 * about 4.5 dB above readsb's for the same message (ModeSFrame.signal): left as it is, so a
 * lab1090 reading this shows the same levels as the one sending it.
 *
 * The frames of one batch of samples go out in one write (a microtask after the first). A
 * quiet sky sends nothing, so a keepalive (an all-zero Mode A/C frame, as readsb sends) goes
 * out after HEARTBEAT_MS without frames: BeastClient's watchdog drops a link after 90 s of
 * silence. A client that can't keep up (more than MAX_QUEUED bytes waiting) is dropped.
 */

/** readsb's `--net-heartbeat` is 60 s; half that keeps well inside a 90 s watchdog. */
const HEARTBEAT_MS = 30_000;
/** About a minute of busy traffic; a client this far behind is gone. */
const MAX_QUEUED = 1 << 20;

const HEARTBEAT = encodeFrame({
	kind: 'modeac',
	timestamp: 0,
	signal: 0,
	data: new Uint8Array(2)
});

interface Client {
	/** Bytes the kernel didn't take yet, oldest first. */
	queue: Uint8Array[];
	queued: number;
	name: string;
}

export interface BeastServerOptions {
	port: number;
	/** Listen on this address only; default: all of them. */
	hostname?: string;
	heartbeatMs?: number;
	/** Clients connecting and leaving; console.log by default (a Pi has no screen). */
	log?: (message: string) => void;
}

export class BeastServer {
	#listener: TCPSocketListener<Client> | null = null;
	#clients = new Set<Socket<Client>>();
	#pending: Uint8Array[] = [];
	#sentAt = performance.now();
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#options: Required<BeastServerOptions>;

	constructor({
		port,
		hostname = '0.0.0.0',
		heartbeatMs = HEARTBEAT_MS,
		log = console.log
	}: BeastServerOptions) {
		this.#options = { port, hostname, heartbeatMs, log };
	}

	/** The port it listens on (the real one when asked for port 0). */
	get port(): number {
		return this.#listener?.port ?? this.#options.port;
	}

	get clients(): number {
		return this.#clients.size;
	}

	/** Throws if the port can't be had (in use, below 1024 without the right). */
	start(): this {
		const { port, hostname, heartbeatMs, log } = this.#options;
		this.#listener = Bun.listen<Client>({
			hostname,
			port,
			socket: {
				open: (socket) => {
					socket.data = { queue: [], queued: 0, name: socket.remoteAddress };
					this.#clients.add(socket);
					log(`Beast output: ${socket.data.name} connected`);
				},
				drain: (socket) => this.#flush(socket),
				close: (socket) => this.#drop(socket, 'left'),
				error: (socket, error) => this.#drop(socket, error.message),
				// Clients only listen; anything they send (readsb can send commands) is ignored.
				data: () => {}
			}
		});
		this.#heartbeat = setInterval(
			() => {
				if (performance.now() - this.#sentAt >= heartbeatMs) this.#send(HEARTBEAT);
			},
			Math.min(1_000, heartbeatMs / 4)
		);
		return this;
	}

	stop(): void {
		clearInterval(this.#heartbeat);
		this.#listener?.stop(true);
		this.#listener = null;
		this.#clients.clear();
	}

	add(frame: ModeSFrame): void {
		if (this.#clients.size === 0) return;
		if (this.#pending.length === 0) queueMicrotask(() => this.#sendPending());
		this.#pending.push(
			encodeFrame({
				kind: frame.data.length === 7 ? 'short' : 'long',
				timestamp: frame.timestamp,
				signal: frame.signal,
				data: frame.data
			})
		);
	}

	#sendPending(): void {
		const parts = this.#pending;
		this.#pending = [];
		if (parts.length > 0) this.#send(Buffer.concat(parts));
	}

	#send(bytes: Uint8Array): void {
		this.#sentAt = performance.now();
		for (const socket of this.#clients) {
			socket.data.queue.push(bytes);
			socket.data.queued += bytes.length;
			if (socket.data.queued > MAX_QUEUED) {
				this.#drop(socket, `more than ${MAX_QUEUED >> 10} KB behind`);
				socket.terminate();
			} else this.#flush(socket);
		}
	}

	/** Write what the kernel takes; the rest waits for `drain`. */
	#flush(socket: Socket<Client>): void {
		const client = socket.data;
		while (client.queue.length > 0) {
			const bytes = client.queue[0];
			const written = socket.write(bytes);
			if (written < 0) return; // closed; `close` drops it
			client.queued -= written;
			if (written < bytes.length) {
				client.queue[0] = bytes.subarray(written);
				return;
			}
			client.queue.shift();
		}
	}

	#drop(socket: Socket<Client>, reason: string): void {
		if (!this.#clients.delete(socket)) return; // error and close both fire
		this.#options.log(`Beast output: ${socket.data.name} ${reason}`);
	}
}
