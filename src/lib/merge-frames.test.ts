import { expect, test } from 'bun:test';
import { mergeFrames } from './merge-frames';
import type { WireFrame } from './receiver-types';

test('mergeFrames: arrival order, each frame once', () => {
	const f = (id: number): WireFrame => ({ id, rx: id, ts: 0, sig: 0, hex: '', addr: null });
	const merged = mergeFrames([f(1), f(4), f(6)], [f(2), f(4), f(5)]);
	expect(merged.map((x) => x.id)).toEqual([1, 2, 4, 5, 6]);
});
