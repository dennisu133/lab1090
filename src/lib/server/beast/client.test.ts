import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { Socket, TCPSocketListener } from 'bun';
import { BeastClient, type BeastClientOptions, type BeastClientStatus } from './client';
import { BeastParser, type BeastFrame } from './parser';
import { encodeFrame } from './encode';

const capture = new Uint8Array(
	await Bun.file(join(import.meta.dir, '../../../../fixtures/capture.beast')).arrayBuffer()
);
const show = (f: BeastFrame) =>
	`${f.kind} ${f.timestamp} ${f.signal} ${Buffer.from(f.data).toString('hex')}`;
const reference = new BeastParser().push(capture).map(show);
const heartbeat = encodeFrame({ kind: 'modeac', timestamp: 0, signal: 0, data: new Uint8Array(2) });

/**
 * A stand-in for the Pi: a TCP server on a random local port. `onConnection` gets a `send`
 * function that handles backpressure (socket.write may accept only part of a large buffer).
 */
function fakeReceiver(
	onConnection: (send: (bytes: Uint8Array) => void, socket: Socket<Pending>, n: number) => void,
	port = 0
) {
	const server: TCPSocketListener<Pending> = Bun.listen<Pending>({
		hostname: '127.0.0.1',
		port,
		socket: {
			open(socket) {
				socket.data = { queue: [] };
				const send = (bytes: Uint8Array) => {
					socket.data.queue.push(bytes);
					flush(socket);
				};
				onConnection(send, socket, ++connections.count);
			},
			drain: flush
		}
	});
	const connections = { count: 0 };
	servers.push(server);
	return { port: server.port, connections, stop: () => server.stop(true) };
}
type Pending = { queue: Uint8Array[]; endAfter?: boolean };
function flush(socket: Socket<Pending>) {
	const q = socket.data.queue;
	while (q.length) {
		const written = socket.write(q[0]);
		if (written < q[0].length) {
			q[0] = q[0].subarray(written); // kernel buffer full: wait for `drain`
			return;
		}
		q.shift();
	}
	if (socket.data.endAfter) socket.end();
}
/** Send, then close the connection once everything has been written. */
function sendAndEnd(socket: Socket<Pending>, send: (b: Uint8Array) => void, bytes: Uint8Array) {
	socket.data.endAfter = true;
	send(bytes);
}

const servers: TCPSocketListener<Pending>[] = [];
const clients: BeastClient[] = [];
afterEach(() => {
	clients.splice(0).forEach((c) => c.close());
	servers.splice(0).forEach((s) => s.stop(true));
});

function client(opts: Partial<BeastClientOptions> & { port: number }) {
	const frames: BeastFrame[] = [];
	const statuses: BeastClientStatus[] = [];
	const c = new BeastClient({
		host: '127.0.0.1',
		onFrame: (f) => frames.push(f),
		onStatus: (s) => statuses.push(s),
		minBackoffMs: 20,
		...opts
	}).start();
	clients.push(c);
	return { client: c, frames, statuses };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
	const deadline = performance.now() + timeoutMs;
	while (!condition()) {
		if (performance.now() > deadline) throw new Error('waitFor: timed out');
		await Bun.sleep(5);
	}
}

describe('BeastClient', () => {
	test('receives every frame of the capture', async () => {
		const pi = fakeReceiver((send) => send(capture));
		const { client: c, frames } = client({ port: pi.port });

		await waitFor(() => frames.length === reference.length);
		expect(frames.map(show)).toEqual(reference);
		expect(c.stats.connections).toBe(1);
		expect(c.status).toEqual({ state: 'connected' });
	});

	test('reconnects after the connection drops mid-frame, with a fresh parser', async () => {
		// Cut between the two bytes of an escaped 0x1A that is the *last* byte of a frame:
		//   … 1A | 1A  1A 3x …
		// A parser reused from the old connection would take the new stream's leading 0x1A as the
		// missing half of that escape, "complete" the old frame, then see the new frame's type byte
		// where it expects 0x1A, lose sync, and drop the new connection's first frame.
		let cut = 300_000;
		while (
			!(capture[cut] === 0x1a && capture[cut + 1] === 0x1a && capture[cut + 2] === 0x1a) ||
			capture[cut + 3] < 0x31 ||
			capture[cut + 3] > 0x33
		)
			cut++;
		cut += 1;
		const pi = fakeReceiver((send, socket, n) => {
			if (n === 1) sendAndEnd(socket, send, capture.subarray(0, cut));
			// readsb starts a connection with keepalives, which happen to mask the bug. Leave them out.
			else send(capture.subarray(5 * heartbeat.length));
		});
		const { client: c, frames, statuses } = client({ port: pi.port });

		const firstPart = new BeastParser().push(capture.subarray(0, cut)).length;
		await waitFor(() => frames.length === firstPart + reference.length);
		// the second connection starts with a fresh parser and gets the full capture
		expect(frames.slice(firstPart).map(show)).toEqual(reference);
		expect(c.stats.connections).toBe(2);
		expect(statuses.map((s) => s.state)).toEqual([
			'connecting',
			'connected',
			'waiting',
			'connecting',
			'connected'
		]);
	});

	test('retries with exponential backoff while nothing is listening', async () => {
		const probe = fakeReceiver(() => {});
		const port = probe.port;
		probe.stop(); // now we know a port where nobody listens

		const { statuses } = client({ port, minBackoffMs: 20, maxBackoffMs: 80 });
		const waits = () => statuses.filter((s) => s.state === 'waiting');
		await waitFor(() => waits().length >= 5);
		expect(
			waits()
				.slice(0, 5)
				.map((s) => s.retryInMs)
		).toEqual([20, 40, 80, 80, 80]);
		expect(waits()[0].reason).toStartWith('connect failed');

		// the Pi comes back
		fakeReceiver((send) => send(heartbeat), port);
		await waitFor(() => statuses.at(-1)?.state === 'connected');
	});

	test('replaces a connection that goes silent (watchdog)', async () => {
		const pi = fakeReceiver(() => {}); // accepts, then never sends anything
		const { statuses } = client({ port: pi.port, idleTimeoutMs: 100 });

		await waitFor(() => pi.connections.count >= 2);
		expect(statuses).toContainEqual({
			state: 'waiting',
			retryInMs: 20,
			reason: 'no data for 0.1 s'
		});
	});

	test('keepalives keep a quiet connection alive', async () => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const pi = fakeReceiver((send) => {
			timer = setInterval(() => send(heartbeat), 30);
		});
		const { client: c, frames } = client({ port: pi.port, idleTimeoutMs: 100 });

		await Bun.sleep(400);
		clearInterval(timer);
		expect(pi.connections.count).toBe(1);
		expect(c.status).toEqual({ state: 'connected' });
		expect(frames).toEqual([]); // keepalives are not frames
	});

	test('close() stops for good', async () => {
		const pi = fakeReceiver((send) => send(heartbeat));
		const { client: c } = client({ port: pi.port });
		await waitFor(() => c.status.state === 'connected');

		c.close();
		await Bun.sleep(100); // several backoff periods
		expect(c.status).toEqual({ state: 'closed' });
		expect(pi.connections.count).toBe(1);
	});

	test('a throwing consumer does not drop the connection', async () => {
		const consoleError = spyOn(console, 'error').mockImplementation(() => {});
		const pi = fakeReceiver((send) => send(capture));
		const { client: c } = client({
			port: pi.port,
			onFrame: () => {
				throw new Error('bug in consumer');
			}
		});

		await waitFor(() => c.stats.frames === reference.length);
		expect(c.stats.connections).toBe(1);
		expect(consoleError).toHaveBeenCalledTimes(reference.length);
		consoleError.mockRestore();
	});
});
