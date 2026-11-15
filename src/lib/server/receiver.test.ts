import { afterEach, expect, test } from 'bun:test';
import { Receiver } from './receiver';
import { capture, fakeReceiver, stopFakeReceivers, waitFor } from './beast/testing';
import type { StreamUpdate } from '#lib/receiver-types.ts';

const TOTAL = 33968; // Mode S frames in the capture

const receivers: Receiver[] = [];
afterEach(() => {
	receivers.splice(0).forEach((r) => r.stop());
	stopFakeReceivers();
});

/** A fake Pi that plays the capture in 40 pieces, 25 ms apart (~1 s), like a live feed. */
function trickle() {
	return fakeReceiver((send) => {
		const pieces = 40;
		const size = Math.ceil(capture.length / pieces);
		for (let i = 0; i < pieces; i++) {
			setTimeout(() => send(capture.subarray(i * size, (i + 1) * size)), i * 25);
		}
	});
}

function start(port: number) {
	const r = new Receiver('127.0.0.1', port).start();
	receivers.push(r);
	return r;
}

function collect(r: Receiver) {
	const updates: StreamUpdate[] = [];
	r.subscribe(
		(u) => updates.push(u),
		() => {}
	);
	return { updates, ids: () => updates.flatMap((u) => u.frames.map((f) => f.id)) };
}

test('counts every frame by DF and type code', async () => {
	const r = start(trickle().port);
	await waitFor(() => r.counts.total === TOTAL, 5000);
	expect(r.counts.byDf).toEqual({
		0: 2147,
		4: 6576,
		5: 1692,
		11: 6658,
		16: 139,
		17: 7545,
		20: 6327,
		21: 2884
	});
	expect(r.counts.byTc[19]).toBe(2747);

	// every frame lands in exactly one signal bucket, -48 … -3 dBFS
	const buckets = Object.entries(r.counts.bySignal);
	expect(buckets.reduce((sum, [, n]) => sum + n, 0)).toBe(TOTAL);
	for (const [k] of buckets) expect(+k % 3 === 0 && +k >= -48 && +k <= -3).toBe(true);

	// parity: the same as in address-filter.test.ts, here with the wall clock instead of the
	// receiver's (the capture plays in ~1 s, so nothing expires)
	expect(r.counts.byVerdict).toEqual({ valid: 6658 + 7545, known: 19752, unknown: 13 });
});

test('subscribers get every frame exactly once, also when joining mid-stream', async () => {
	const r = start(trickle().port);
	const early = collect(r);

	// join while frames are flowing, i.e. while some are pending for the next batch
	await waitFor(() => r.counts.total > TOTAL / 2, 5000);
	const late = collect(r);

	await waitFor(() => early.ids().length === TOTAL, 5000);
	await waitFor(() => late.ids().at(-1) === TOTAL, 5000);

	// early subscriber: ids 1..TOTAL, in order, no duplicates
	expect(early.ids()).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1));

	// late subscriber: up to 1000 frames of history, then everything after, without gaps or repeats
	const ids = late.ids();
	expect(late.updates[0].frames.length).toBeLessThanOrEqual(1000);
	expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => ids[0] + i));
});

test('keeps the latest 200 frames of every kind, however rare', async () => {
	const r = start(trickle().port);
	await waitFor(() => r.counts.total === TOTAL, 5000);
	const none = { df: null, tc: null, verdict: null };
	const kept = (n: number) => Math.min(200, n);

	for (const [df, n] of Object.entries(r.counts.byDf)) {
		const frames = r.buffers.query({ ...none, df: +df });
		expect(frames).toHaveLength(kept(n));
		expect(frames.every((f) => parseInt(f.hex.slice(0, 2), 16) >> 3 === +df)).toBe(true);
	}
	for (const [tc, n] of Object.entries(r.counts.byTc))
		expect(r.buffers.query({ ...none, tc: { from: +tc, to: +tc } })).toHaveLength(kept(n));

	// the 13 unknown addresses are spread over the whole capture, and all still there
	const unknown = r.buffers.query({ ...none, verdict: 'unknown' });
	expect(unknown).toHaveLength(13);
	expect(unknown.every((f) => f.addr?.verdict === 'unknown')).toBe(true);
	// the latest of each kind: DF 17's are the last 200 DF 17 frames, oldest first
	const df17 = r.buffers.query({ ...none, df: 17 }).map((f) => f.id);
	expect(df17).toEqual([...df17].sort((a, b) => a - b));
});

test('the first update holds the position history too, in its own field', async () => {
	const r = start(trickle().port);
	// until the last frame has gone out in a batch: pending frames aren't history yet
	const all = collect(r);
	await waitFor(() => all.ids().at(-1) === TOTAL, 5000);
	const late = collect(r);
	const first = late.updates[0];
	expect(first.frames.length).toBe(1000);
	// The capture plays in ~1 s of wall-clock time, so TrackHistory (a frame per aircraft
	// every 4 s) keeps a pair or so per aircraft: valid DF17 positions from most of the 19.
	const kept = first.tracks!;
	expect(kept.every((f) => f.hex.startsWith('8d') && f.addr?.verdict === 'valid')).toBe(true);
	expect(new Set(kept.map((f) => f.addr!.icao)).size).toBeGreaterThan(10);
	const ids = kept.map((f) => f.id);
	expect(ids).toEqual([...new Set(ids)].sort((a, b) => a - b)); // ascending, no repeats
	// none newer than the history: those are still pending and come with the next batch
	expect(Math.max(...ids)).toBeLessThanOrEqual(first.frames.at(-1)!.id);
	// only the first update
	await waitFor(() => late.updates.length > 1, 1000);
	expect(late.updates.slice(1).every((u) => u.tracks === undefined)).toBe(true);
});
