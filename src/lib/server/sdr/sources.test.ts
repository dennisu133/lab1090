import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modulate } from '#lib/demod/modulate.ts';
import { toHex } from '#lib/modes/frame.ts';
import type { SourceStatus } from '#lib/receiver-types.ts';
import { waitFor } from '../beast/testing';
import type { BeastFrame } from '../beast/parser';
import { Recording } from './recording';
import { explain, RtlSdr } from './rtl-sdr';
import { RtlTcp, setupCommands } from './rtl-tcp';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const MESSAGES = ['8D4840D6202CC371C32CE0576098', '8D4840D6202CC371C32CE0576098'].map(hex);
/** 0.1 s of samples with two messages in it. */
const SAMPLES = modulate(
	MESSAGES.map((data, i) => ({ data, at: 1000 + i * 100_000, amplitude: 0.3 })),
	240_000,
	{ noise: 0.005 }
);

const directory = mkdtempSync(join(tmpdir(), 'lab1090-sdr-'));
const samplesFile = join(directory, 'samples.u8');
writeFileSync(samplesFile, SAMPLES);

/** A stand-in for rtl_sdr: a shell script that prints `messages` and exits with `code`. */
function fakeRtlSdr(name: string, { samples = false, messages = '', code = 0 }): string {
	const path = join(directory, name);
	const lines = ['#!/bin/sh', `echo "$@" > ${path}.args`];
	if (samples) lines.push(`cat ${samplesFile}`);
	if (messages) lines.push(`printf '%s\\n' '${messages}' >&2`);
	lines.push(`exit ${code}`);
	writeFileSync(path, lines.join('\n'));
	chmodSync(path, 0o755);
	return path;
}

const sources: { close(): void }[] = [];
afterEach(() => sources.splice(0).forEach((s) => s.close()));

function collect() {
	const frames: BeastFrame[] = [];
	const statuses: SourceStatus[] = [];
	return {
		frames,
		statuses,
		onFrame: (f: BeastFrame) => frames.push(f),
		onStatus: (s: SourceStatus) => statuses.push(s)
	};
}

describe('RtlSdr', () => {
	test('runs rtl_sdr for 1090 MHz and demodulates what it writes', async () => {
		const command = fakeRtlSdr('ok', { samples: true });
		const { frames, statuses, onFrame, onStatus } = collect();
		const sdr = new RtlSdr({
			device: '0',
			gain: 40,
			onFrame,
			onStatus,
			command,
			minBackoffMs: 5000
		});
		sources.push(sdr.start());
		await waitFor(() => statuses.at(-1)?.state === 'waiting');
		expect(frames.map((f) => toHex(f.data))).toEqual(MESSAGES.map(toHex));
		expect(statuses.map((s) => s.state)).toEqual(['connecting', 'connected', 'waiting']);
		expect(await Bun.file(`${command}.args`).text()).toBe(
			'-d 0 -f 1090000000 -s 2400000 -g 40 -\n'
		);
	});

	test('says why it stopped, and tries again', async () => {
		const command = fakeRtlSdr('none', { messages: 'No supported devices found.', code: 1 });
		const { statuses, onFrame, onStatus } = collect();
		const sdr = new RtlSdr({ device: '0', gain: 40, onFrame, onStatus, command, minBackoffMs: 10 });
		sources.push(sdr.start());
		await waitFor(() => statuses.filter((s) => s.state === 'waiting').length >= 2);
		expect(statuses[1]).toEqual({
			state: 'waiting',
			retryInMs: 10,
			reason: 'no RTL-SDR found: is it plugged in?'
		});
		expect(statuses[3]).toMatchObject({ state: 'waiting', retryInMs: 20 });
	});

	test('a missing rtl_sdr', async () => {
		const { statuses, onFrame, onStatus } = collect();
		const command = join(directory, 'not-there');
		const sdr = new RtlSdr({ device: '0', gain: 40, onFrame, onStatus, command });
		sources.push(sdr.start());
		await waitFor(() => statuses.at(-1)?.state === 'waiting');
		expect(statuses.at(-1)).toMatchObject({
			reason: `${command} isn't installed (apt install rtl-sdr)`
		});
	});

	test('rtl_sdr’s messages in words', () => {
		const busy =
			'Found 1 device(s):\nusb_claim_interface error -6\nFailed to open rtlsdr device #0.';
		expect(explain(busy, 1, '0')).toContain('in use by another program');
		expect(explain('No matching devices found.', 1, 'abc')).toBe('no RTL-SDR "abc" found');
		expect(explain('', 1, '0')).toBe('rtl_sdr stopped (exit code 1)');
		expect(explain('something new\n', 1, '0')).toBe('rtl_sdr stopped: something new');
	});
});

describe('RtlTcp', () => {
	test('sets up the dongle, skips the header and demodulates the samples', async () => {
		let received = new Uint8Array(0);
		const server = Bun.listen({
			hostname: '127.0.0.1',
			port: 0,
			socket: {
				open(socket) {
					const header = new Uint8Array(12);
					header.set(new TextEncoder().encode('RTL0'));
					header[7] = 5; // R820T
					header[11] = 29; // gain steps
					// Header and samples in pieces, cut in odd places.
					const all = new Uint8Array([...header, ...SAMPLES]);
					for (let at = 0; at < all.length; at += 50_001)
						socket.write(all.subarray(at, at + 50_001));
				},
				data(_, data) {
					received = new Uint8Array([...received, ...data]);
				}
			}
		});
		const { frames, onFrame } = collect();
		const tcp = new RtlTcp({ host: '127.0.0.1', port: server.port, gain: 49.6, onFrame });
		sources.push(tcp.start(), { close: () => server.stop(true) });
		await waitFor(() => frames.length === 2);
		expect(frames.map((f) => toHex(f.data))).toEqual(MESSAGES.map(toHex));
		expect(Array.from(received)).toEqual(Array.from(setupCommands(49.6)));
		// 2.4 MS/s, 1090 MHz, manual gain, 49.6 dB, no RTL AGC.
		expect(Array.from(setupCommands(49.6))).toEqual([
			2, 0, 0x24, 0x9f, 0x00, 1, 0x40, 0xf8, 0x14, 0x80, 3, 0, 0, 0, 1, 4, 0, 0, 1, 0xf0, 8, 0, 0,
			0, 0
		]);
	});

	test('hangs up on a server that isn’t rtl_tcp', async () => {
		const server = Bun.listen({
			hostname: '127.0.0.1',
			port: 0,
			socket: { open: (socket) => void socket.write('\x1a2xxxxxxxxxxxxxxx'), data() {} }
		});
		const { statuses, onFrame, onStatus } = collect();
		const tcp = new RtlTcp({ host: '127.0.0.1', port: server.port, gain: 40, onFrame, onStatus });
		sources.push(tcp.start(), { close: () => server.stop(true) });
		await waitFor(() => statuses.at(-1)?.state === 'waiting');
		expect(statuses.at(-1)).toMatchObject({
			reason: 'not an rtl_tcp server (it doesn\'t start with "RTL0")'
		});
	});
});

describe('Recording', () => {
	test('plays samples at their own pace, then ends', async () => {
		const { frames, statuses, onFrame, onStatus } = collect();
		const start = performance.now();
		sources.push(new Recording({ file: samplesFile, onFrame, onStatus }).start());
		await waitFor(() => statuses.at(-1)?.state === 'ended');
		// 0.1 s of samples take about that long.
		expect(performance.now() - start).toBeGreaterThan(90);
		expect(frames.map((f) => toHex(f.data))).toEqual(MESSAGES.map(toHex));
	});
});
