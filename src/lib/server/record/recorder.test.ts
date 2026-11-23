import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modulate } from '#lib/demod/modulate.ts';
import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import { SampleDecoder } from '../sdr/decoder';
import { BLOCK, HEADER_BYTES, META_BYTES, rawFrame } from './archive';
import { SampleRecorder } from './recorder';

const directory = mkdtempSync(join(tmpdir(), 'lab1090-record-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
/** 1.5 s of samples (more than one of the recorder's one-second pieces), three messages. */
const SAMPLES = modulate(
	[0, 1, 2].map((i) => ({
		data: hex('8D4840D6202CC371C32CE0576098'),
		at: 1000 + i * 1_000_000,
		amplitude: 0.3
	})),
	3_600_000,
	{ noise: 0.005 }
);

function record(base: string, plannedSamples: number) {
	const lines: string[] = [];
	const decoder = new SampleDecoder(() => {}, { gain: 40 });
	decoder.device.tuner = 'Rafael Micro R820T';
	const recorder = new SampleRecorder({
		base,
		directory,
		plannedSamples,
		label: 'balcony',
		recorder: 'lab1090 test',
		source: 'rtl_sdr',
		log: (line) => lines.push(line)
	});
	recorder.attach(decoder);
	return { recorder, decoder, lines };
}

/** Byte for byte the same. */
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

/** The archive, decompressed: one stream of frames. */
const unpack = (path: string) => Bun.zstdDecompressSync(readFileSync(path));

/** What a tar reader sees in the ustar header at `at` (name, size, a valid checksum). */
function entry(tar: Uint8Array, at: number) {
	const header = tar.subarray(at, at + BLOCK);
	const text = (from: number, length: number) =>
		new TextDecoder().decode(header.subarray(from, from + length)).replace(/\0.*$/s, '');
	const copy = Uint8Array.from(header);
	copy.fill(0x20, 148, 156);
	const sum = copy.reduce((a, b) => a + b, 0);
	return {
		name: [text(345, 155), text(0, 100)].filter(Boolean).join('/'),
		size: parseInt(text(124, 12), 8),
		type: text(156, 1),
		checksumOk: parseInt(text(148, 8), 8) === sum,
		magic: text(257, 6)
	};
}

test('a raw zstd frame holds its bytes as they are, in blocks of at most 128 KiB', () => {
	const content = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) % 251);
	expect(same(Bun.zstdDecompressSync(rawFrame(content)), content)).toBe(true);
	expect(Bun.zstdDecompressSync(rawFrame(new Uint8Array(0))).length).toBe(0);
	// Frames one after another are one stream.
	const two = new Uint8Array([...rawFrame(content.subarray(0, 10)), ...rawFrame(content)]);
	expect(Bun.zstdDecompressSync(two).length).toBe(300_010);
});

test('a recording: the samples as they came, in a SigMF archive, compressed', async () => {
	const { recorder, decoder, lines } = record('lab1090-test-balcony', 3_000_000);
	expect(recorder.report()).toMatchObject({ state: 'waiting', plannedMs: 1250 });
	decoder.restart();
	// In pieces, like rtl_sdr's output; the recorder stops taking at its 3 million samples.
	for (let at = 0; at < SAMPLES.length; at += 262_144)
		decoder.push(SAMPLES.subarray(at, at + 262_144));
	expect(recorder.report().state).toBe('finishing');
	await Bun.sleep(0);
	while (recorder.report().state === 'finishing') await Bun.sleep(5);
	const report = recorder.report();
	expect(report).toMatchObject({ state: 'saved', ms: 1250, stopped: null });
	expect(lines.at(-1)).toMatch(
		/^Recording: saved 0:01 of samples to lab1090-test-balcony.sigmf.zst/
	);

	const tar = unpack(recorder.path);
	expect(report.bytes).toBe(readFileSync(recorder.path).length);
	expect(report.bytes).toBeLessThan(6_000_000 / 2);
	const meta = entry(tar, 0);
	expect(meta).toMatchObject({
		name: 'lab1090-test-balcony/lab1090-test-balcony.sigmf-meta',
		size: META_BYTES,
		type: '0',
		checksumOk: true,
		magic: 'ustar'
	});
	const json = JSON.parse(new TextDecoder().decode(tar.subarray(BLOCK, BLOCK + META_BYTES)));
	const data = SAMPLES.subarray(0, 6_000_000);
	expect(json.global).toMatchObject({
		'core:datatype': 'cu8',
		'core:sample_rate': SAMPLE_RATE,
		'core:recorder': 'lab1090 test',
		'core:hw': 'Rafael Micro R820T',
		'core:sha512': new Bun.CryptoHasher('sha512').update(data).digest('hex'),
		'lab1090:label': 'balcony',
		'lab1090:source': 'rtl_sdr',
		'lab1090:gain_db': 40,
		'lab1090:samples': 3_000_000,
		'lab1090:messages': 3
	});
	expect(json.global['core:geolocation']).toBeUndefined();
	expect(json.captures).toEqual([
		expect.objectContaining({ 'core:sample_start': 0, 'core:frequency': 1_090_000_000 })
	]);
	const pax = entry(tar, BLOCK + META_BYTES);
	expect(pax).toMatchObject({ type: 'x', checksumOk: true });
	const records = new TextDecoder().decode(tar.subarray(BLOCK + META_BYTES + BLOCK, HEADER_BYTES));
	expect(records).toContain('size=6000000\n');
	expect(entry(tar, BLOCK + META_BYTES + 2 * BLOCK)).toMatchObject({
		name: 'lab1090-test-balcony/lab1090-test-balcony.sigmf-data',
		size: 6_000_000,
		checksumOk: true
	});
	expect(same(tar.subarray(HEADER_BYTES, HEADER_BYTES + 6_000_000), data)).toBe(true);
	// The data's padding and tar's two empty blocks end it.
	const end = HEADER_BYTES + Math.ceil(6_000_000 / BLOCK) * BLOCK + 2 * BLOCK;
	expect(tar.length).toBe(end);
	expect(tar.subarray(HEADER_BYTES + 6_000_000).every((b) => b === 0)).toBe(true);
});

test('stopped early: what is written, a capture segment per run, and no file without samples', async () => {
	const { recorder, decoder } = record('lab1090-test-early', 24_000_000);
	decoder.restart();
	decoder.push(SAMPLES.subarray(0, 4_800_000)); // a second: compressed and written
	decoder.restart(); // rtl_sdr started again
	decoder.push(SAMPLES.subarray(0, 4_800_000));
	decoder.push(SAMPLES.subarray(0, 1000)); // not a whole second: left out
	await Bun.sleep(50);
	recorder.finish('lab1090 was stopped');
	expect(recorder.report()).toMatchObject({ state: 'saved', stopped: 'lab1090 was stopped' });
	const tar = unpack(recorder.path);
	const json = JSON.parse(new TextDecoder().decode(tar.subarray(BLOCK, BLOCK + META_BYTES)));
	expect(json.global['lab1090:stopped']).toBe('lab1090 was stopped');
	expect(json.global['lab1090:samples']).toBe(4_800_000);
	expect(json.global['lab1090:planned_samples']).toBe(24_000_000);
	expect(json.captures.map((c: Record<string, number>) => c['core:sample_start'])).toEqual([
		0, 2_400_000
	]);
	expect(entry(tar, BLOCK + META_BYTES + 2 * BLOCK).size).toBe(9_600_000);

	const nothing = record('lab1090-test-nothing', 1000);
	nothing.recorder.finish('lab1090 was stopped');
	expect(nothing.recorder.report().state).toBe('failed');
	expect(existsSync(nothing.recorder.path)).toBe(false);
	expect(nothing.lines).toEqual([
		'Recording: nothing recorded (lab1090 was stopped), no file left'
	]);
});

test('never over an existing file', () => {
	writeFileSync(join(directory, 'lab1090-test-exists.sigmf.zst'), 'x');
	expect(() => record('lab1090-test-exists', 1000)).toThrow('EEXIST');
});
