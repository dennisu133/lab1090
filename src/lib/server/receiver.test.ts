import { afterEach, expect, test } from 'bun:test';
import { Receiver } from './receiver';
import { capture, fakeReceiver, stopFakeReceivers, waitFor } from './beast/testing';
import type { RawUpdate } from '#lib/receiver-types.ts';

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
	const updates: RawUpdate[] = [];
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
