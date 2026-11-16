/**
 * Test helper: a recording through a Tracker and the coverage, as the stream does it (the
 * feed after every update, `everyMs` apart; Infinity: only at the end, like a new tab
 * getting the server's history).
 */
import { AddressFilter } from '#lib/modes/address-filter.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { Tracker } from '#lib/tracker/tracker.ts';
import { Coverage } from './coverage';
import { CoverageFeed } from './feed';

export function runCoverage(
	messages: readonly { t: number; data: Uint8Array }[],
	receiver: LatLon,
	everyMs = 250
): Coverage {
	const filter = new AddressFilter();
	const tracker = new Tracker(() => receiver);
	const coverage = new Coverage(receiver);
	const feed = new CoverageFeed();
	let last = messages[0]?.t ?? 0;
	for (const { t, data } of messages) {
		tracker.add(data, filter.check(data, t), t);
		if (t - last >= everyMs) {
			last = t;
			tracker.prune(t);
			feed.add(coverage, tracker.list());
		}
	}
	feed.add(coverage, tracker.list());
	return coverage;
}
