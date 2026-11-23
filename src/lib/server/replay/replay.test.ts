import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modulate } from '#lib/demod/modulate.ts';
import { toHex } from '#lib/modes/frame.ts';
import type { SourceStatus } from '#lib/receiver-types.ts';
import { encodeFrame } from '../beast/encode';
import { capture, waitFor } from '../beast/testing';
import type { ModeSFrame } from '../frame-source';
import { headerFrame, trailerFrame } from '../record/archive';
import { SampleRecorder } from '../record/recorder';
import { SampleDecoder } from '../sdr/decoder';
import { BeastReplay } from './beast';
import { detectFormat, fileFormat } from './format';
import { SampleReplay } from './samples';
import { ByteReader, nextEntry } from './tar';

const directory = mkdtempSync(join(tmpdir(), 'lab1090-replay-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const sources: { close(): void }[] = [];
afterEach(() => sources.splice(0).forEach((s) => s.close()));

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const MESSAGES = ['8D4840D6202CC371C32CE0576098', '8D4840D6202CC371C32CE0576098'].map(hex);
/** 0.1 s of samples with two messages in it. */
const SAMPLES = modulate(
	MESSAGES.map((data, i) => ({ data, at: 1000 + i * 100_000, amplitude: 0.3 })),
	240_000,
	{ noise: 0.005 }
);
const file = (name: string, content: Uint8Array | string) => {
	const path = join(directory, name);
	writeFileSync(path, content);
	return path;
};
const bare = file('sky.u8', SAMPLES);

/** A recording as --record makes it, of SAMPLES (made once). */
let made: Promise<string> | null = null;
const recorded = () => (made ??= record());

async function record(): Promise<string> {
	const decoder = new SampleDecoder(() => {}, { gain: 40.2 });
	decoder.device.tuner = 'Rafael Micro R828D';
	const recorder = new SampleRecorder({
		base: 'lab1090-2026-11-23T21-40-12-balcony',
		directory,
		plannedSamples: SAMPLES.length / 2,
		label: 'balcony',
		recorder: 'lab1090 test',
		source: 'rtl_sdr'
	});
	recorder.attach(decoder);
	decoder.restart();
	decoder.push(SAMPLES);
	await waitFor(() => recorder.report().state === 'saved');
	return recorder.path;
}

function collect() {
	const frames: ModeSFrame[] = [];
	const statuses: SourceStatus[] = [];
	return {
		frames,
		statuses,
		onFrame: (f: ModeSFrame) => frames.push(f),
		onStatus: (s: SourceStatus) => statuses.push(s)
	};
}

test('the format from the first bytes, not the name', async () => {
	const zst = await recorded();
	expect(fileFormat(zst)).toBe('sigmf-zstd');
	expect(fileFormat(file('a.sigmf', Bun.zstdDecompressSync(readFileSync(zst))))).toBe('sigmf');
	expect(detectFormat(capture.subarray(0, 4096))).toBe('beast');
	expect(fileFormat(bare)).toBe('samples');
	// Samples starting with what looks like a Beast frame's first two bytes are still samples.
	expect(detectFormat(Uint8Array.from([0x1a, 0x33, ...SAMPLES.subarray(0, 4000)]))).toBe('samples');
});

test('tar: the pax size wins over the header (above 8 GiB)', async () => {
	const big = 9 * 2 ** 30;
	const header = Bun.zstdDecompressSync(headerFrame('x', '{}', big, 0));
	const reader = new ByteReader(new Blob([new Uint8Array(header)]).stream());
	expect(await nextEntry(reader)).toEqual({ path: 'x/x.sigmf-meta', size: 14336 });
	await reader.skip(14336);
	expect(await nextEntry(reader)).toEqual({ path: 'x/x.sigmf-data', size: big });
	const end = new ByteReader(
		new Blob([new Uint8Array(Bun.zstdDecompressSync(trailerFrame(0)))]).stream()
	);
	expect(await nextEntry(end)).toBeNull();
});

test('bare samples: at their own pace, then the end', async () => {
	const { frames, statuses, onFrame, onStatus } = collect();
	const start = performance.now();
	const replay = new SampleReplay({
		file: bare,
		format: 'samples',
		loop: false,
		onFrame,
		onStatus
	});
	sources.push(replay.start());
	await waitFor(() => statuses.at(-1)?.state === 'ended');
	// 0.1 s of samples take about that long.
	expect(performance.now() - start).toBeGreaterThan(90);
	expect(frames.map((f) => toHex(f.data))).toEqual(MESSAGES.map(toHex));
	expect(replay.replay).toMatchObject({ kind: 'samples', label: null, recordedAt: null });
	expect(replay.decoder.device.gain).toBeNull();
});

test('a recording from --record: the samples, and what its metadata says', async () => {
	const path = await recorded();
	const { frames, statuses, onFrame, onStatus } = collect();
	const replay = new SampleReplay({
		file: path,
		format: 'sigmf-zstd',
		loop: false,
		onFrame,
		onStatus
	});
	sources.push(replay.start());
	await waitFor(() => statuses.at(-1)?.state === 'ended');
	expect(frames.map((f) => toHex(f.data))).toEqual(MESSAGES.map(toHex));
	expect(replay.replay).toMatchObject({ label: 'balcony', recorder: 'lab1090 test' });
	expect(replay.replay.recordedAt).toBeGreaterThan(Date.now() - 10_000);
	expect(replay.decoder.device).toMatchObject({ tuner: 'Rafael Micro R828D', gain: 40.2 });

	// The same, unpacked: the archive (zstd -d), and its two files (tar x).
	const tar = Bun.zstdDecompressSync(readFileSync(path));
	const plain = collect();
	sources.push(
		new SampleReplay({
			file: file('plain.sigmf', tar),
			format: 'sigmf',
			loop: false,
			onFrame: plain.onFrame,
			onStatus: plain.onStatus
		}).start()
	);
	await waitFor(() => plain.statuses.at(-1)?.state === 'ended');
	expect(plain.frames.length).toBe(2);
	file('pair.sigmf-meta', tar.subarray(512, 512 + 14336));
	const pair = new SampleReplay({
		file: file('pair.sigmf-data', SAMPLES),
		format: 'samples',
		loop: false,
		onFrame: () => {},
		onStatus: () => {}
	});
	sources.push(pair.start());
	await waitFor(() => pair.replay.label === 'balcony');
});

test('in a loop: again and again, each time a new run', async () => {
	const { frames, onFrame, onStatus } = collect();
	const replay = new SampleReplay({ file: bare, format: 'samples', loop: true, onFrame, onStatus });
	sources.push(replay.start());
	await waitFor(() => frames.length >= 6);
	expect(replay.decoder.report().runs).toBeGreaterThanOrEqual(3);
	// Timestamps keep growing: each run starts the demodulator's clock at the server's.
	expect(frames[4].timestamp).toBeGreaterThan(frames[1].timestamp);
});

test('samples it can’t demodulate: it says why and ends', async () => {
	const meta = JSON.stringify({ global: { 'core:datatype': 'cu8', 'core:sample_rate': 2e6 } });
	file('wide.sigmf-meta', meta);
	const { statuses, onFrame, onStatus } = collect();
	sources.push(
		new SampleReplay({
			file: file('wide.sigmf-data', SAMPLES),
			format: 'samples',
			loop: false,
			onFrame,
			onStatus
		}).start()
	);
	await waitFor(() => statuses.at(-1)?.state === 'ended');
	expect(statuses.at(-1)).toEqual({
		state: 'ended',
		reason: 'recorded at 2000000 samples a second; lab1090 needs 2400000'
	});
});

test('Beast messages: by their timestamps, moved to the server’s clock, in a loop', async () => {
	const frame = (ms: number) =>
		encodeFrame({ kind: 'long', timestamp: 1e9 + ms * 12_000, signal: 100, data: MESSAGES[0] });
	const path = file('sky.beast', new Uint8Array([...frame(0), ...frame(100), ...frame(200)]));
	expect(fileFormat(path)).toBe('beast');
	const { frames, statuses, onFrame, onStatus } = collect();
	const start = performance.now();
	sources.push(new BeastReplay({ file: path, loop: true, onFrame, onStatus }).start());
	await waitFor(() => frames.length >= 4);
	expect(performance.now() - start).toBeGreaterThan(190);
	expect(statuses).toEqual([{ state: 'connected' }]);
	expect(frames[1].timestamp - frames[0].timestamp).toBe(100 * 12_000);
	expect(frames[3].timestamp).toBeGreaterThan(frames[2].timestamp);
	expect(frames[0].timestamp).toBeGreaterThan((start - 100) * 12_000);
});
