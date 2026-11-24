/** Test helpers: the recorded capture and a fake Pi. Only imported by tests. */
import { join } from 'node:path';
import type { Socket, TCPSocketListener } from 'bun';
import { encodeFrame } from './encode';

export const capture = new Uint8Array(
	await Bun.file(join(import.meta.dir, '../../../../oracle/capture.beast')).arrayBuffer()
);

export const heartbeat = encodeFrame({
	kind: 'modeac',
	timestamp: 0,
	signal: 0,
	data: new Uint8Array(2)
});

type Pending = { queue: Uint8Array[]; endAfter?: boolean };
export type FakeSocket = Socket<Pending>;
type Send = (bytes: Uint8Array) => void;

const servers: TCPSocketListener<Pending>[] = [];

/**
 * A stand-in for the Pi: a TCP server on a random local port. `onConnection` gets a `send`
 * function that handles backpressure (socket.write may accept only part of a large buffer).
 */
export function fakeReceiver(
	onConnection: (send: Send, socket: FakeSocket, n: number) => void,
	port = 0
) {
	const connections = { count: 0 };
	const server = Bun.listen<Pending>({
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
	servers.push(server);
	return { port: server.port, connections, stop: () => server.stop(true) };
}

/** Call from afterEach. */
export function stopFakeReceivers() {
	servers.splice(0).forEach((s) => s.stop(true));
}

function flush(socket: FakeSocket) {
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
export function sendAndEnd(socket: FakeSocket, send: Send, bytes: Uint8Array) {
	socket.data.endAfter = true;
	send(bytes);
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000) {
	const deadline = performance.now() + timeoutMs;
	while (!condition()) {
		if (performance.now() > deadline) throw new Error('waitFor: timed out');
		await Bun.sleep(5);
	}
}
