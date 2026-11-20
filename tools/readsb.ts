/**
 * readsb's messages from a recording, with their times: the reference for tuning our
 * demodulator (demod-compare.ts, pulse-shape.ts).
 *
 *   readsb --device-type ifile --ifile x.u8 --iformat UC8 > x.readsb
 *
 * Without --raw, readsb prints every message with its fields, among them `receiverTime`: µs
 * since the first sample, by the sample count. So it lines up with our timestamps (12 MHz
 * ticks from the first sample) up to a constant, which we find from messages both decoded.
 */
import type { DemodulatedFrame } from '../src/lib/demod/demodulator.ts';
import { toHex } from '../src/lib/modes/frame.ts';

export interface ReadsbMessage {
	hex: string;
	/** receiverTime in 12 MHz ticks (readsb's clock, not yet ours). */
	tick: number;
	/** readsb's signal level, dBFS (mean power: about 4.5 dB below our pulse amplitude). */
	rssi: number;
	/** Bits readsb repaired. */
	fixed: number;
}

export function parseReadsb(text: string): ReadsbMessage[] {
	const out: ReadsbMessage[] = [];
	let current: Partial<ReadsbMessage> | null = null;
	const flush = () => {
		if (current?.hex && current.tick !== undefined) out.push(current as ReadsbMessage);
		current = null;
	};
	for (const line of text.split('\n')) {
		const message = /^\*([0-9a-f]+);/.exec(line);
		if (message) {
			flush();
			current = { hex: message[1], fixed: 0, rssi: NaN };
			continue;
		}
		if (!current) continue;
		let m;
		if ((m = /receiverTime:\s+([\d.]+)us/.exec(line))) current.tick = Math.round(Number(m[1]) * 12);
		else if ((m = /RSSI:\s+(-?[\d.]+) dBFS/.exec(line))) current.rssi = Number(m[1]);
		else if ((m = /fixed bits: (\d+)/.exec(line))) current.fixed = Number(m[1]);
	}
	flush();
	return out;
}

export const hexOf = (f: DemodulatedFrame) => toHex(f.data).toLowerCase();
export const bytesOf = (hex: string) =>
	Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));

/**
 * readsb's clock → ours: a constant (about 200 µs, where readsb starts counting), the most
 * common difference between messages that both found exactly once.
 */
export function clockMap(
	theirs: ReadsbMessage[],
	ours: DemodulatedFrame[]
): (tick: number) => number {
	const count = new Map<string, number>();
	for (const t of theirs) count.set(t.hex, (count.get(t.hex) ?? 0) + 1);
	const once = new Map<string, DemodulatedFrame | null>();
	for (const f of ours) {
		const h = hexOf(f);
		once.set(h, once.has(h) ? null : f);
	}
	const differences = new Map<number, number>();
	for (const t of theirs) {
		const f = once.get(t.hex);
		if (!f || count.get(t.hex) !== 1) continue;
		const d = f.timestamp - t.tick;
		differences.set(d, (differences.get(d) ?? 0) + 1);
	}
	let offset = 0;
	let most = 0;
	for (const [d, n] of differences) if (n > most) [offset, most] = [d, n];
	return (tick) => tick + offset;
}
