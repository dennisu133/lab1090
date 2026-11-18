/**
 * Our demodulator against readsb's, on the same recording, message by message.
 *
 *   rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 720000000 x.u8                 (5 min, 1.4 GB)
 *   readsb --device-type ifile --ifile x.u8 --iformat UC8 > x.readsb    (readsb.ts)
 *   bun tools/demod-compare.ts x.u8 x.readsb [--list]
 *
 * Messages match by content and time. For each message only readsb found, it goes back to
 * that spot in the samples and says where ours lost it:
 *
 * - inside:   it starts inside a message we decoded (we go on after a message's end)
 * - floor:    its pulses aren't above the quick test's level floor (QUICK_ABOVE_LEVEL)
 * - unheard:  decoded on its own once the address is known: we hadn't heard it intact
 * - quick:    no sample at its start passes the quick test's ratio
 * - preamble: no start passes PREAMBLE_RATIO
 * - bits:     read wrong both ways (as a sequence and bit by bit)
 *
 * DF11 replies to a radar are counted apart: a wrong bit among their last 7 gives another
 * radar's code, so neither side can be checked (filter.ts). --list prints every message
 * only one side found.
 */
import {
	Demodulator,
	LEVEL_BLOCK,
	PREAMBLE_RATIO,
	QUICK_ABOVE_LEVEL,
	QUICK_RATIO,
	type DemodulatedFrame
} from '../src/lib/demod/demodulator.ts';
import { magnitudes, SAMPLE_RATE } from '../src/lib/demod/samples.ts';
import { syndrome } from '../src/lib/modes/crc.ts';
import { bytesOf, clockMap, hexOf, parseReadsb, type ReadsbMessage } from './readsb.ts';

const [samplesPath, readsbPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = process.argv.includes('--list');
if (!samplesPath || !readsbPath) {
	console.error('usage: bun tools/demod-compare.ts x.u8 x.readsb [--list]');
	process.exit(1);
}

const iq = Bun.mmap(samplesPath) as Uint8Array;
const theirs = parseReadsb(await Bun.file(readsbPath).text());
const seconds = iq.length / 2 / SAMPLE_RATE;

const demodulator = new Demodulator();
const ours: DemodulatedFrame[] = [];
const CHUNK = 1 << 22;
const started = performance.now();
for (let at = 0; at < iq.length; at += CHUNK)
	ours.push(...demodulator.push(iq.subarray(at, Math.min(iq.length, at + CHUNK))));
const took = (performance.now() - started) / 1000;

const toOurs = clockMap(theirs, ours);
const byHex = new Map<string, DemodulatedFrame[]>();
for (const f of ours) byHex.set(hexOf(f), [...(byHex.get(hexOf(f)) ?? []), f]);
const used = new Set<DemodulatedFrame>();
const both: ReadsbMessage[] = [];
const missed: ReadsbMessage[] = [];
for (const t of theirs) {
	const at = toOurs(t.tick);
	const f = byHex.get(t.hex)?.find((f) => !used.has(f) && Math.abs(f.timestamp - at) < 60);
	if (f) {
		used.add(f);
		both.push(t);
	} else missed.push(t);
}
const extra = ours.filter((f) => !used.has(f));

const dfOf = (hex: string) => Math.min(parseInt(hex.slice(0, 2), 16) >> 3, 24);
/** A DF11 reply to a radar: its code can't be checked. */
const withCode = (hex: string) => dfOf(hex) === 11 && syndrome(bytesOf(hex)) !== 0;
const tally = (keys: string[]) => {
	const m = new Map<string, number>();
	for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
	return [...m]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `${k} ${n}`)
		.join(', ');
};
const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)} %`;

const missedChecked = missed.filter((t) => !withCode(t.hex));
console.log(
	`${seconds.toFixed(0)} s of samples, demodulated in ${took.toFixed(1)} s (${pct(took, seconds)} of real time)`
);
console.log(`readsb  ${theirs.length} messages (${theirs.filter((t) => t.fixed).length} repaired)`);
console.log(
	`ours    ${ours.length} messages (${demodulator.stats.repaired} repaired): ${ours.length >= theirs.length ? '+' : ''}${pct(ours.length - theirs.length, theirs.length)}`
);
console.log(`both    ${both.length}`);
console.log(
	`readsb only ${missed.length}: ${missed.length - missedChecked.length} DF11 with a radar code, ${missedChecked.length} others (${pct(missedChecked.length, theirs.length)} of readsb's)`
);
console.log(`  by format: ${tally(missedChecked.map((t) => `DF${dfOf(t.hex)}`))}`);
console.log(`ours only ${extra.length}: ${tally(extra.map((f) => `DF${dfOf(hexOf(f))}`))}`);

// Where ours lost readsb's messages.
const levels: number[] = [];
{
	const mag = new Uint16Array(LEVEL_BLOCK);
	for (let block = 0; (block + 1) * LEVEL_BLOCK * 2 <= iq.length; block++) {
		magnitudes(iq, block * LEVEL_BLOCK * 2, LEVEL_BLOCK, mag, 0);
		let sum = 0;
		for (let k = 0; k < LEVEL_BLOCK; k++) sum += mag[k];
		levels.push(sum / LEVEL_BLOCK);
	}
}
const window = (from: number, count: number) => {
	const mag = new Uint16Array(count);
	magnitudes(iq, 2 * from, count, mag, 0);
	return mag;
};
const spans = ours.map((f) => [f.timestamp, f.timestamp + (f.kind === 'long' ? 120 : 64) * 12]);

function why(t: ReadsbMessage): string {
	const at = toOurs(t.tick);
	if (spans.some(([a, b]) => a < at && at < b)) return 'inside';
	const n0 = Math.floor(at / 5);
	// On its own (a new demodulator has no level floor yet), with the address known.
	const alone = new Demodulator();
	const data = bytesOf(t.hex);
	const df = dfOf(t.hex);
	const address =
		df === 11 || df === 17 || df === 18
			? (data[1] << 16) | (data[2] << 8) | data[3]
			: syndrome(data);
	const squitter = new Uint8Array([
		0x5d,
		address >> 16,
		(address >> 8) & 255,
		address & 255,
		0,
		0,
		0
	]);
	const crc = syndrome(squitter);
	squitter.set([crc >> 16, (crc >> 8) & 255, crc & 255], 4);
	alone.filter.check(squitter, 0);
	const found = alone
		.push(iq.subarray(2 * (n0 - 300), 2 * (n0 + 400)))
		.some((f) => hexOf(f) === t.hex);
	// The quick test at the samples a start in n0 − 1 … n0 + 1 would use.
	const mag = window(n0 - 1, 24);
	let floorOnly = false;
	let quick = false;
	for (let k = 0; k < 3; k++) {
		const high = Math.min(
			Math.max(mag[k], mag[k + 1]),
			mag[k + 3],
			mag[k + 9],
			Math.max(mag[k + 11], mag[k + 12])
		);
		const gap = [5, 6, 7, 13, 14, 15, 16, 17, 18].reduce((s, d) => s + mag[k + d], 0);
		const ratio = high * 9 > gap * QUICK_RATIO;
		const floor =
			high > (levels[Math.floor((n0 - 1 + k) / LEVEL_BLOCK) - 1] ?? 0) * QUICK_ABOVE_LEVEL;
		if (ratio && floor) quick = true;
		if (ratio && !floor) floorOnly = true;
	}
	if (found) return quick ? 'unheard' : 'floor';
	if (!quick) return floorOnly ? 'floor' : 'quick';
	// The preamble at the starts around it (box energies, as demodulator.ts step 2).
	const from = n0 - 3;
	const m = window(from, 32);
	const energy = (a: number, b: number) => {
		let e = 0;
		for (let tick = a; tick < b; tick++) e += m[Math.floor(tick / 5) - from];
		return e;
	};
	const gapWindows = [
		[6, 12],
		[18, 42],
		[48, 54],
		[60, 96]
	];
	for (let s = at - 7; s <= at + 7; s++) {
		const pulses = [0, 12, 42, 54].reduce((sum, p) => sum + energy(s + p, s + p + 6), 0) / 24;
		const gaps = gapWindows.reduce((sum, [a, b]) => sum + energy(s + a, s + b), 0) / 72;
		if (pulses > gaps * PREAMBLE_RATIO) return 'bits';
	}
	return 'preamble';
}
const reasons = missedChecked.map(why);
console.log(`  where ours lost them: ${tally(reasons)}`);

// readsb's level for the messages both found vs those only readsb found.
console.log('readsb dBFS    both  readsb only');
const bin = (t: ReadsbMessage) => Math.floor(t.rssi / 3) * 3;
const bins = [...new Set(theirs.map(bin))].sort((a, b) => a - b);
for (const b of bins) {
	const n = both.filter((t) => bin(t) === b).length;
	const m = missedChecked.filter((t) => bin(t) === b).length;
	console.log(
		`${String(b).padStart(4)}…${String(b + 3).padStart(3)}  ${String(n).padStart(6)}  ${String(m).padStart(6)}`
	);
}

if (list) {
	console.log('\nreadsb only:');
	for (const [i, t] of missedChecked.entries())
		console.log(`  ${t.hex}  ${t.rssi} dBFS${t.fixed ? ', repaired' : ''}: ${reasons[i]}`);
	console.log('\nours only:');
	for (const f of extra) {
		const same = theirs.find((t) => Math.abs(toOurs(t.tick) - f.timestamp) < 30);
		console.log(`  ${hexOf(f)}  signal ${f.signal}${same ? `, readsb read ${same.hex}` : ''}`);
	}
}
