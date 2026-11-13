import type { BeastFrame, BeastFrameKind } from './parser';

const TYPE_BYTE: Record<BeastFrameKind, number> = { modeac: 0x31, short: 0x32, long: 0x33 };

/**
 * Encode a frame in Beast wire format: the inverse of BeastParser.
 * Used by tests (round-trip against the capture, hand-made frames) and, later, a fake receiver.
 */
export function encodeFrame(f: BeastFrame): Uint8Array {
	const body = [...uint48(f.timestamp), f.signal, ...f.data];
	const out = [0x1a, TYPE_BYTE[f.kind]];
	for (const b of body) {
		out.push(b);
		if (b === 0x1a) out.push(0x1a); // escape
	}
	return Uint8Array.from(out);
}

function uint48(v: number): number[] {
	const bytes: number[] = [];
	for (let i = 0; i < 6; i++) {
		bytes.unshift(v % 256);
		v = Math.floor(v / 256);
	}
	return bytes;
}
