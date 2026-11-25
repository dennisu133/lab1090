import { describe, expect, test } from 'bun:test';
import { capture } from '#lib/server/beast/testing.ts';
import { BeastParser } from '#lib/beast/parser.ts';
import { checkParity } from '#lib/modes/crc.ts';
import { toHex } from '#lib/modes/frame.ts';
import { Demodulator, type DemodulatedFrame } from './demodulator';
import { MessageFilter } from './filter';
import { modulate, type Transmission } from './modulate';
import { SAMPLE_RATE } from './samples';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const DF17 = hex('8D4840D6202CC371C32CE0576098');

function demodulate(iq: Uint8Array, chunk = iq.length): DemodulatedFrame[] {
	const demodulator = new Demodulator();
	const frames: DemodulatedFrame[] = [];
	for (let at = 0; at < iq.length; at += chunk)
		frames.push(...demodulator.push(iq.subarray(at, at + chunk)));
	return frames;
}

/** The first `seconds` of the capture, sent again at the times and levels readsb heard them. */
function fromCapture(seconds: number): Transmission[] {
	const frames = new BeastParser().push(capture).filter((f) => f.kind !== 'modeac');
	const t0 = frames[0].timestamp;
	return frames
		.filter((f) => f.timestamp - t0 < seconds * 12e6)
		.map((f) => ({ data: f.data, at: 100 + (f.timestamp - t0) / 5, amplitude: f.signal / 255 }));
}

describe('Demodulator', () => {
	test('reads a message wherever between two samples it starts', () => {
		for (let fraction = 0; fraction < 1; fraction += 0.05) {
			const at = 1000 + fraction;
			const iq = modulate([{ data: DF17, at, amplitude: 0.3 }], 2000, { noise: 0.005 });
			const [frame, ...rest] = demodulate(iq);
			expect(rest).toEqual([]);
			expect(frame.data).toEqual(DF17);
			expect(frame.kind).toBe('long');
			// 12 MHz ticks: 5 per sample. The pulses' box shape leaves a tick or two of doubt.
			expect(Math.abs(frame.timestamp - at * 5)).toBeLessThanOrEqual(2.5);
			expect(Math.abs(frame.signal - 0.3 * 255)).toBeLessThan(10);
		}
	});

	test('finds nothing in noise', () => {
		const iq = modulate([], SAMPLE_RATE, { noise: 0.01, seed: 7 });
		const demodulator = new Demodulator();
		expect(demodulator.push(iq)).toEqual([]);
		expect(demodulator.stats.candidates).toBeGreaterThan(0);
	});

	test('finds the same messages however the samples are cut into chunks', () => {
		const sent = fromCapture(1);
		const iq = modulate(sent, Math.ceil(1.1 * SAMPLE_RATE), { noise: 0.004 });
		const whole = demodulate(iq);
		expect(whole.length).toBeGreaterThan(10);
		// Odd chunk sizes split I from Q too.
		for (const chunk of [16_383, 4_097, 777]) expect(demodulate(iq, chunk)).toEqual(whole);
	});

	test('recovers the capture without noise, and nothing that wasn’t sent with noise', () => {
		const sent = fromCapture(5);
		const samples = Math.ceil(5.1 * SAMPLE_RATE);
		const planted = new Set(sent.map((t) => toHex(t.data)));
		const addresses = new Set(sent.map((t) => checkParity(t.data)?.icao));
		// Replies from an aircraft not yet heard in a squitter are dropped (filter.ts).
		const filter = new MessageFilter();
		const passing = sent.filter((t) => filter.check(t.data, t.at / SAMPLE_RATE));

		const clean = demodulate(modulate(sent, samples)).map((f) => toHex(f.data));
		expect(clean.length / passing.length).toBeGreaterThan(0.97);
		for (const h of clean) expect(planted.has(h)).toBe(true);

		// Noise as at the Pi: the weakest messages go (about -33 dBFS against -37 dBFS of
		// noise), but whatever is found comes from an aircraft that was there.
		const noisy = demodulate(modulate(sent, samples, { noise: 0.0095 }));
		expect(noisy.length).toBeGreaterThan(sent.length / 5);
		for (const f of noisy) expect(addresses.has(checkParity(f.data)?.icao)).toBe(true);
	});

	test('every candidate ends in one outcome, and loud messages count as clipped', () => {
		const sent = fromCapture(2);
		const loud = sent.map((t, i) => (i % 4 === 0 ? { ...t, amplitude: 1.2 } : t));
		const demodulator = new Demodulator();
		const iq = modulate(loud, Math.ceil(2.1 * SAMPLE_RATE), { noise: 0.008, seed: 3 });
		const frames = demodulator.push(iq);
		const s = demodulator.stats;
		expect(s.candidates).toBe(
			s.noPreamble + s.unknownFormat + s.parity + s.unheard + s.accepted + s.repaired
		);
		expect(s.accepted + s.repaired).toBe(frames.length);
		// Every outcome happens in two seconds of noise and traffic.
		for (const n of [s.noPreamble, s.unknownFormat, s.parity, s.unheard])
			expect(n).toBeGreaterThan(0);
		// The loud ones found (by time: the same message can be sent loud and quiet).
		const loudAt = loud.filter((t) => t.amplitude > 1).map((t) => t.at * 5);
		const found = frames.filter((f) => loudAt.some((at) => Math.abs(f.timestamp - at) < 5));
		expect(found.length).toBeGreaterThan(10);
		expect(s.clipped).toBe(found.length);
		// The level blocks add up to a mean (27 ms each).
		expect(s.blocks).toBe(Math.floor(iq.length / 2 / 65536));
		expect(s.levelSum / s.blocks).toBeCloseTo(s.level, 1);
	});
});
