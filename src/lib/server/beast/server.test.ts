import { afterEach, expect, test } from 'bun:test';
import { BeastClient } from './client';
import { BeastParser, type BeastFrame } from '#lib/beast/parser.ts';
import { BeastServer } from './server';
import { capture, waitFor } from './testing';

const show = (f: BeastFrame) =>
	`${f.kind} ${f.timestamp} ${f.signal} ${Buffer.from(f.data).toString('hex')}`;
/** The capture's Mode S frames, as a Receiver would hand them on. */
const frames = new BeastParser().push(capture).filter((f) => f.kind !== 'modeac');

/** What to close after each test. */
const running: (() => void)[] = [];
afterEach(() => running.splice(0).forEach((close) => close()));

function server(options: { heartbeatMs?: number } = {}) {
	const s = new BeastServer({ port: 0, hostname: '127.0.0.1', log: () => {}, ...options }).start();
	running.push(() => s.stop());
	return s;
}

function listen(port: number) {
	const received: BeastFrame[] = [];
	const client = new BeastClient({
		host: '127.0.0.1',
		port,
		onFrame: (f) => received.push(f),
		minBackoffMs: 20
	}).start();
	running.push(() => client.close());
	return { received, client };
}

test('a client gets every frame as it was, in order, also in one big burst', async () => {
	const s = server();
	const { received } = listen(s.port);
	await waitFor(() => s.clients === 1);
	for (const f of frames) s.add(f); // one microtask: the whole capture in one write
	await waitFor(() => received.length === frames.length, 10_000);
	expect(received.map(show)).toEqual(frames.map(show));
});

test('every client gets the frames; nothing is kept for clients still to come', async () => {
	const s = server();
	s.add(frames[0]);
	const a = listen(s.port);
	const b = listen(s.port);
	await waitFor(() => s.clients === 2);
	for (const f of frames.slice(1, 101)) s.add(f);
	await waitFor(() => a.received.length === 100 && b.received.length === 100);
	expect(a.received.map(show)).toEqual(frames.slice(1, 101).map(show));
	expect(b.received.map(show)).toEqual(a.received.map(show));
});

test('a quiet sky sends keepalives, which the client counts as life but not as frames', async () => {
	const s = server({ heartbeatMs: 40 });
	const bytes: number[] = [];
	const socket = await Bun.connect({
		hostname: '127.0.0.1',
		port: s.port,
		socket: {
			data: (_, data) => {
				bytes.push(...data);
			}
		}
	});
	running.push(() => socket.end());
	await waitFor(() => bytes.length >= 2 * 11);
	// 1A '1', timestamp 0, signal 0, Mode A/C 0000: readsb's keepalive.
	expect(Buffer.from(bytes.slice(0, 11)).toString('hex')).toBe('1a310000000000000000' + '00');
	expect(new BeastParser().push(Uint8Array.from(bytes))).toEqual([]);
});

test('a client that leaves is forgotten', async () => {
	const s = server();
	const { client } = listen(s.port);
	await waitFor(() => s.clients === 1);
	client.close();
	await waitFor(() => s.clients === 0);
	s.add(frames[0]); // no one to send to: nothing breaks
});
