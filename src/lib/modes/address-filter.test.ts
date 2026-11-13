import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BeastParser } from '#lib/server/beast/parser.ts';
import { AddressFilter } from './address-filter';
import { fromHex } from './frame';

const squitter = fromHex('5d471efa7e630b'); // DF11 from 471EFA, II 0
const altitudeReply = fromHex('200017180d1091'); // DF4, address 471EFA hidden in the parity

test('AP addresses are known only after a valid clear message, and only for a while', () => {
	const filter = new AddressFilter(60_000);
	expect(filter.check(altitudeReply, 0)?.verdict).toBe('unknown');

	expect(filter.check(squitter, 1_000)).toMatchObject({
		icao: '471EFA',
		source: 'clear',
		verdict: 'valid'
	});
	expect(filter.check(altitudeReply, 2_000)).toMatchObject({
		icao: '471EFA',
		source: 'parity',
		verdict: 'known'
	});
	expect(filter.check(altitudeReply, 61_000)?.verdict).toBe('known'); // exactly 60 s
	expect(filter.check(altitudeReply, 61_001)?.verdict).toBe('unknown');
});

test('known AP messages do not extend the TTL; invalid clear ones do not register', () => {
	const filter = new AddressFilter(60_000);
	filter.check(squitter, 0);
	filter.check(altitudeReply, 50_000); // known, but proves nothing about itself
	expect(filter.check(altitudeReply, 70_000)?.verdict).toBe('unknown');

	const broken = squitter.slice();
	broken[5] ^= 0x40; // payload/parity bit: CRC fails, address bytes untouched
	expect(filter.check(broken, 80_000)?.verdict).toBe('invalid');
	expect(filter.check(altitudeReply, 80_000)?.verdict).toBe('unknown');
});

test('prune forgets aircraft after the TTL', () => {
	const filter = new AddressFilter(60_000);
	filter.check(squitter, 0);
	filter.prune(60_000);
	expect(filter.size).toBe(1);
	filter.prune(60_001);
	expect(filter.size).toBe(0);
});

test('the capture, in order, with the receiver clock', async () => {
	const capture = new Uint8Array(
		await Bun.file(join(import.meta.dir, '../../../fixtures/capture.beast')).arrayBuffer()
	);
	const filter = new AddressFilter();
	const verdicts: Record<string, number> = {};
	for (const f of new BeastParser().push(capture)) {
		if (f.kind === 'modeac') continue;
		const v = filter.check(f.data, f.timestamp / 12_000)!; // 12 MHz ticks -> ms
		verdicts[v.verdict] = (verdicts[v.verdict] ?? 0) + 1;
	}
	// readsb already dropped corrupted messages and unknown AP addresses before sending.
	// What's left as "unknown": aircraft that readsb knew from before the recording started,
	// whose first AP messages here arrive before their first DF11/17 does.
	expect(verdicts).toEqual({ valid: 6658 + 7545, known: 19752, unknown: 13 });
});
