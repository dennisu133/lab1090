import { expect, test } from 'bun:test';
import type { FrameQuery, FrameTraits } from '#lib/frame-query.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import { FrameBuffers } from './frame-buffers';

const none: FrameQuery = { df: null, tc: null, verdict: null };

let nextId = 1;
function fill(buffers: FrameBuffers, traits: FrameTraits, n: number): WireFrame[] {
	return Array.from({ length: n }, () => {
		const frame: WireFrame = { id: nextId++, rx: 0, ts: 0, sig: 0, hex: '', addr: null };
		buffers.add(frame, traits);
		return frame;
	});
}

test('a rare kind survives a flood of common ones', () => {
	const b = new FrameBuffers(10);
	const [test23] = fill(b, { df: 17, tc: 23, verdict: 'valid' }, 1);
	fill(b, { df: 17, tc: 11, verdict: 'valid' }, 1000);
	expect(b.query({ ...none, tc: { from: 23, to: 23 } })).toEqual([test23]);
	// …while the common kind keeps only its latest frames, oldest first
	const latest = b.query({ ...none, tc: { from: 11, to: 11 } });
	expect(latest.map((f) => f.id)).toEqual(Array.from({ length: 10 }, (_, i) => nextId - 10 + i));
});

test('a type code range merges its buffers in arrival order', () => {
	const b = new FrameBuffers(10);
	const a = fill(b, { df: 17, tc: 11, verdict: 'valid' }, 2);
	const c = fill(b, { df: 17, tc: 12, verdict: 'valid' }, 2);
	const d = fill(b, { df: 17, tc: 11, verdict: 'valid' }, 1);
	fill(b, { df: 17, tc: 19, verdict: 'valid' }, 5);
	expect(b.query({ ...none, tc: { from: 9, to: 18 } })).toEqual([...a, ...c, ...d]);
	expect(b.query({ ...none, tc: { from: 9, to: 18 } }, 2)).toEqual([c[1], d[0]]);
});

test('combined filters look in the smallest buffer and check the rest', () => {
	const b = new FrameBuffers(100);
	fill(b, { df: 20, tc: null, verdict: 'known' }, 50);
	const unknown20 = fill(b, { df: 20, tc: null, verdict: 'unknown' }, 2);
	fill(b, { df: 4, tc: null, verdict: 'unknown' }, 3);
	expect(b.query({ df: 20, tc: null, verdict: 'unknown' })).toEqual(unknown20);
	expect(b.query({ df: 4, tc: null, verdict: 'known' })).toEqual([]);
});

test('type codes are only buffered for DF17; an empty query finds nothing', () => {
	const b = new FrameBuffers(10);
	fill(b, { df: 18, tc: 11, verdict: 'valid' }, 3);
	expect(b.query({ ...none, tc: { from: 11, to: 11 } })).toEqual([]);
	expect(b.query({ ...none, df: 18 })).toHaveLength(3);
	expect(b.query(none)).toEqual([]);
});
