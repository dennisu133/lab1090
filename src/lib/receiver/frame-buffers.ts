import { matches, type FrameQuery, type FrameTraits } from '#lib/frame-query.ts';
import type { WireFrame } from '#lib/receiver-types.ts';

interface Entry {
	frame: WireFrame;
	traits: FrameTraits;
}

/**
 * The latest frames of every kind: one small buffer per downlink format, per DF17 type code
 * and per parity verdict. Each buffer only turns over as fast as its own kind arrives, so a
 * rare frame (a TC 23 test message, a DF 16) stays findable for hours, long after the
 * general history has moved on.
 *
 * A frame sits in up to three buffers (same object, no copies). With ~70 possible kinds of
 * at most `size` frames each, this stays well under 20,000 frames.
 */
export class FrameBuffers {
	#buffers = new Map<string, Entry[]>();

	constructor(readonly size: number) {}

	add(frame: WireFrame, traits: FrameTraits): void {
		const entry = { frame, traits };
		this.#push(`df ${traits.df}`, entry);
		if (traits.df === 17 && traits.tc !== null) this.#push(`tc ${traits.tc}`, entry);
		if (traits.verdict) this.#push(`verdict ${traits.verdict}`, entry);
	}

	/**
	 * The newest `limit` frames matching the query, oldest first. Looks in the smallest
	 * candidate set (e.g. the TC 23 buffer rather than all of DF 17) and filters it by the
	 * rest of the query. Combined filters can thus find fewer frames than exist: DF 20 frames
	 * among the latest `size` "unknown" ones. An empty query finds nothing (that's the
	 * general history's job).
	 */
	query(q: FrameQuery, limit = this.size): WireFrame[] {
		const candidates: Entry[][] = [];
		if (q.df !== null) candidates.push(this.#get(`df ${q.df}`));
		if (q.tc !== null) {
			const merged = [];
			for (let tc = q.tc.from; tc <= q.tc.to; tc++) merged.push(...this.#get(`tc ${tc}`));
			candidates.push(merged); // the type code buffers don't overlap: no duplicates
		}
		if (q.verdict !== null) candidates.push(this.#get(`verdict ${q.verdict}`));
		if (candidates.length === 0) return [];

		const smallest = candidates.reduce((a, b) => (b.length < a.length ? b : a));
		return smallest
			.filter((e) => matches(q, e.traits))
			.map((e) => e.frame)
			.sort((a, b) => a.id - b.id)
			.slice(-limit);
	}

	#get(key: string): Entry[] {
		return this.#buffers.get(key) ?? [];
	}

	#push(key: string, entry: Entry): void {
		let buffer = this.#buffers.get(key);
		if (!buffer) this.#buffers.set(key, (buffer = []));
		buffer.push(entry);
		if (buffer.length > this.size) buffer.shift();
	}
}
