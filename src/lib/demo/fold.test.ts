import { expect, test } from 'bun:test';
import { BeastParser, type BeastFrame } from '#lib/beast/parser.ts';
import { checkParity } from '#lib/modes/crc.ts';
import { capture } from '#lib/server/beast/testing.ts';
import { df17 } from '#lib/tracker/alert-scenario.ts';
import { EDGE_MS, foldRecording } from './fold';

const MINUTE = 60_000;
const TICKS = 12_000;

/** An aircraft heard every second from `from` to `to` minutes into the recording. */
function aircraft(icao: string, from: number, to: number): BeastFrame[] {
	const frames: BeastFrame[] = [];
	for (let t = from * MINUTE; t <= to * MINUTE; t += 1000) {
		// TC 19 velocity, nothing in it: only the address matters here.
		frames.push({ kind: 'long', timestamp: t * TICKS, signal: 100, data: df17(icao, me19) });
	}
	return frames;
}
const me19 = Uint8Array.of(19 << 3, 0, 0, 0, 0, 0, 0);

const icaoOf = (f: BeastFrame) => checkParity(f.data)!.icao;
const sorted = (frames: BeastFrame[]) => frames.sort((a, b) => a.timestamp - b.timestamp);

test('aircraft cut by the recording are left out, the others shown whole, round the seam', () => {
	// 40 minutes: A was there before it started, Z still is at its end.
	const recording = sorted([
		...aircraft('AAAAAA', 0, 10),
		...aircraft('BBBBBB', 5, 15),
		...aircraft('CCCCCC', 28, 38),
		...aircraft('DDDDDD', 12, 30),
		...aircraft('ZZZZZZ', 33, 40)
	]);
	const fold = foldRecording(recording, 30 * MINUTE);
	const loopTicks = fold.loopMs * TICKS;

	const shown = new Set(fold.frames.map(icaoOf));
	expect([...shown].sort()).toEqual(['BBBBBB', 'CCCCCC', 'DDDDDD']);
	expect(fold.left).toBe(2);
	for (const icao of shown) {
		const before = recording.filter((f) => icaoOf(f) === icao);
		const after = fold.frames.filter((f) => icaoOf(f) === icao);
		expect(after.length).toBe(before.length);
		// Every message at its time in the loop: a track that crosses the seam goes on.
		const start = before[0].timestamp - fold.startMs * TICKS;
		const times = after
			.map((f) => (f.timestamp - start + loopTicks) % loopTicks)
			.sort((a, b) => a - b);
		expect(times).toEqual(before.map((f) => f.timestamp - before[0].timestamp));
	}
	// In order, within the loop.
	for (let i = 1; i < fold.frames.length; i++) {
		expect(fold.frames[i].timestamp).toBeGreaterThanOrEqual(fold.frames[i - 1].timestamp);
	}
	expect(fold.frames.at(-1)!.timestamp).toBeLessThan(loopTicks);
});

test('the same aircraft twice at once in the loop: the later visit goes', () => {
	// E comes back after 20 minutes; in a loop of all 31 minutes its second stay would
	// wrap onto its first. (G: a message at either end, to make the recording that long.)
	const recording = sorted([
		...aircraft('EEEEEE', 2, 8),
		...aircraft('EEEEEE', 22, 29),
		...aircraft('FFFFFF', 3, 20),
		...aircraft('999999', 0, 0),
		...aircraft('999999', 31, 31)
	]);
	const fold = foldRecording(recording, 31 * MINUTE);
	expect(fold.loopMs).toBe(31 * MINUTE);
	const e = fold.frames.filter((f) => icaoOf(f) === 'EEEEEE');
	expect(e.length).toBe(6 * 60 + 1);
});

test('the capture: every aircraft whole and in step, nothing from its first or last minute', () => {
	const frames = new BeastParser().push(capture);
	const fold = foldRecording(frames, 6 * MINUTE);
	expect(fold.loopMs).toBeGreaterThanOrEqual(6 * MINUTE);
	expect(fold.shown).toBeGreaterThan(0);
	expect(fold.frames.length).toBeLessThan(frames.length);

	// Each shown aircraft's verified messages keep their spacing, wrapped or not.
	const t0 = frames[0].timestamp;
	const loopTicks = fold.loopMs * TICKS;
	const byIcao = (list: BeastFrame[]) => {
		const map = new Map<string, number[]>();
		for (const f of list) {
			const p = checkParity(f.data);
			if (p?.kind !== 'clear' || !p.valid) continue;
			map.set(p.icao, [...(map.get(p.icao) ?? []), f.timestamp]);
		}
		return map;
	};
	const before = byIcao(frames);
	const end = frames.at(-1)!.timestamp;
	for (const [icao, times] of byIcao(fold.frames)) {
		const original = before.get(icao)!;
		const shift = (original[0] - t0 - fold.startMs * TICKS + loopTicks) % loopTicks;
		const back = times.map((t) => (t - shift + loopTicks) % loopTicks).sort((a, b) => a - b);
		expect(back).toEqual(original.map((t) => t - original[0]));
		expect(original[0] - t0).toBeGreaterThanOrEqual(EDGE_MS * TICKS);
		expect(end - original.at(-1)!).toBeGreaterThanOrEqual(EDGE_MS * TICKS);
	}
});
