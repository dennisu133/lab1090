import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BeastParser, type BeastFrame } from './parser';
import { encodeFrame } from './encode';

const capture = new Uint8Array(
	await Bun.file(join(import.meta.dir, '../../../../fixtures/capture.beast')).arrayBuffer()
);

/** Compact, comparable representation of a frame. */
const show = (f: BeastFrame) =>
	`${f.kind} ${f.timestamp} ${f.signal} ${Buffer.from(f.data).toString('hex')}`;

function parseInChunks(bytes: Uint8Array, nextSize: () => number) {
	const parser = new BeastParser();
	const frames: BeastFrame[] = [];
	for (let i = 0; i < bytes.length;) {
		const end = Math.min(bytes.length, i + nextSize());
		frames.push(...parser.push(bytes.subarray(i, end)));
		i = end;
	}
	return { frames, stats: parser.stats };
}

/** Small seeded PRNG (mulberry32), so "random" chunking is reproducible. */
function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const heartbeat: BeastFrame = { kind: 'modeac', timestamp: 0, signal: 0, data: new Uint8Array(2) };

// Reference: the whole capture in a single chunk.
const reference = parseInChunks(capture, () => capture.length);
const referenceShown = reference.frames.map(show);

describe('the 10-minute capture', () => {
	test('yields every frame, matching fixtures/README.md', () => {
		expect(reference.stats).toEqual({ frames: 33968, heartbeats: 5, resyncs: 0, skippedBytes: 0 });

		const dfCounts: Record<number, number> = {};
		for (const f of reference.frames) {
			const df = f.data[0] >> 3;
			dfCounts[df] = (dfCounts[df] ?? 0) + 1;
		}
		expect(dfCounts).toEqual({
			0: 2147,
			4: 6576,
			5: 1692,
			11: 6658,
			16: 139,
			17: 7545,
			20: 6327,
			21: 2884
		});
	});

	test('message length matches the frame kind (DF >= 16 are long)', () => {
		for (const f of reference.frames) {
			expect(f.kind).toBe(f.data[0] >> 3 >= 16 ? 'long' : 'short');
			expect(f.data.length).toBe(f.kind === 'long' ? 14 : 7);
		}
	});

	test('timestamps never go backwards', () => {
		const ts = reference.frames.map((f) => f.timestamp);
		expect(ts.every((t, i) => i === 0 || t >= ts[i - 1])).toBe(true);
	});

	test('re-encoding every frame reproduces the file byte for byte', () => {
		const parts = [...Array(5).fill(heartbeat), ...reference.frames].map(encodeFrame);
		expect(Buffer.concat(parts).equals(capture)).toBe(true);
	});
});

describe('chunk boundaries do not matter', () => {
	test('one byte at a time', () => {
		expect(parseInChunks(capture, () => 1).frames.map(show)).toEqual(referenceShown);
	});

	test('random chunk sizes 1–64 bytes, 5 seeds', () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const r = rng(seed);
			const { frames } = parseInChunks(capture, () => 1 + Math.floor(r() * 64));
			expect(frames.map(show)).toEqual(referenceShown);
		}
	});
});

describe('joining mid-stream', () => {
	// Byte range of every frame in the capture, derived from the round-trip encoding.
	const starts: number[] = [];
	const ends: number[] = [];
	let offset = 5 * encodeFrame(heartbeat).length;
	for (const f of reference.frames) {
		starts.push(offset);
		offset += encodeFrame(f).length;
		ends.push(offset);
	}
	const WINDOW = 4000;

	/** Parse capture[from, from + WINDOW) and check we get exactly the frames that lie fully inside. */
	function checkJoinAt(from: number) {
		const to = from + WINDOW;
		const expected = reference.frames
			.filter((_, i) => starts[i] >= from && ends[i] <= to)
			.map(show);
		const { frames } = parseInChunks(capture.subarray(from, to), () => 50);
		expect(frames.map(show)).toEqual(expected);
	}

	test('at every byte offset in the first 3000 bytes', () => {
		for (let from = 0; from < 3000; from++) checkJoinAt(from);
	});

	test('right between the two bytes of an escaped 0x1A (looks like a frame start)', () => {
		const inside: number[] = [];
		for (let i = 0; i < capture.length - 1 && inside.length < 300; i++) {
			if (capture[i] === 0x1a && capture[i + 1] === 0x1a) inside.push(i + 1);
		}
		expect(inside.length).toBe(300);
		for (const from of inside) checkJoinAt(from);
	});
});

describe('hand-made frames', () => {
	const long = (timestamp: number, hex: string): BeastFrame => ({
		kind: 'long',
		timestamp,
		signal: 0x1a,
		data: Uint8Array.from(Buffer.from(hex, 'hex'))
	});
	// timestamp 0x1A1A1A1A1A1A: every timestamp byte needs escaping, and so does the signal
	const a = long(0x1a1a1a1a1a1a, '8d48e95b9915828df0089c433e2e');
	const b = long(1000, '8d4d22bc58c382d690c8ac2863a7');
	const c = long(2000, '8d3c6541ea42e858015c08e5a1c4');

	test('escaped bytes are decoded', () => {
		const p = new BeastParser();
		const out = p.push(Buffer.concat([encodeFrame(a), encodeFrame(b)]));
		// b's leading 0x1A confirms a, so we're synced and b is returned right away
		expect(out.map(show)).toEqual([show(a), show(b)]);
		expect(out[0].timestamp).toBe(0x1a1a1a1a1a1a);
		expect(out[0].signal).toBe(0x1a);
	});

	test('the first frame is held back until the framing is confirmed', () => {
		const p = new BeastParser();
		expect(p.push(encodeFrame(a))).toEqual([]);
		expect(p.push(Uint8Array.of(0x1a)).map(show)).toEqual([show(a)]); // start of the next frame
	});

	test('once synced, frames are returned immediately', () => {
		const p = new BeastParser();
		expect(p.push(encodeFrame(a))).toEqual([]);
		expect(p.push(encodeFrame(b)).map(show)).toEqual([show(a), show(b)]);
		expect(p.push(encodeFrame(c)).map(show)).toEqual([show(c)]);
	});

	test('an escape pair split across two chunks', () => {
		const bytes = Buffer.concat([encodeFrame(a), encodeFrame(b)]);
		const split = 3; // 1A 33 1A | 1A ...  (between the bytes of the first escaped timestamp byte)
		const p = new BeastParser();
		const out = [...p.push(bytes.subarray(0, split)), ...p.push(bytes.subarray(split))];
		expect(out.map(show)).toEqual([show(a), show(b)]);
	});

	test('a truncated frame is dropped and the next one is parsed', () => {
		const truncated = encodeFrame(b).subarray(0, 10);
		const p = new BeastParser();
		const out = p.push(
			Buffer.concat([
				encodeFrame(a),
				truncated,
				encodeFrame(c),
				encodeFrame(b),
				Uint8Array.of(0x1a)
			])
		);
		expect(out.map(show)).toEqual([show(a), show(c), show(b)]);
		expect(p.stats.resyncs).toBe(1);
	});

	test('unknown frame types are skipped', () => {
		const status = Uint8Array.of(0x1a, 0x34, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14);
		const p = new BeastParser();
		const out = p.push(
			Buffer.concat([status, encodeFrame(a), encodeFrame(b), Uint8Array.of(0x1a)])
		);
		expect(out.map(show)).toEqual([show(a), show(b)]);
	});

	test('keepalives are dropped and counted', () => {
		const p = new BeastParser();
		const out = p.push(
			Buffer.concat([
				encodeFrame(heartbeat),
				encodeFrame(a),
				encodeFrame(heartbeat),
				Uint8Array.of(0x1a)
			])
		);
		expect(out.map(show)).toEqual([show(a)]);
		expect(p.stats.heartbeats).toBe(2);
	});
});
