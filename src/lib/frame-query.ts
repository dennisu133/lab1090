/**
 * The /raw feed filter: which frames to show, by downlink format, type code and parity
 * verdict. Shared by the page (filtering live frames, building the URL) and the server
 * (answering from its frame buffers), so both agree on what matches.
 */
import type { Verdict } from '#lib/modes/address-filter.ts';

export interface FrameQuery {
	df: number | null;
	/** A range of DF17 type codes; one code is { from: 11, to: 11 }. */
	tc: { from: number; to: number } | null;
	verdict: Verdict | null;
}

/** What a frame is, as far as the filter is concerned. */
export interface FrameTraits {
	df: number;
	/** null for frames without a type code. */
	tc: number | null;
	verdict: Verdict | null;
}

const VERDICTS: readonly Verdict[] = ['valid', 'known', 'unknown', 'invalid'];

export function isEmpty(q: FrameQuery): boolean {
	return q.df === null && q.tc === null && q.verdict === null;
}

/** Type codes count for DF17 only, like the TC table. */
export function matches(q: FrameQuery, f: FrameTraits): boolean {
	return (
		(q.df === null || f.df === q.df) &&
		(q.tc === null || (f.df === 17 && f.tc !== null && f.tc >= q.tc.from && f.tc <= q.tc.to)) &&
		(q.verdict === null || f.verdict === q.verdict)
	);
}

/** df=17&tc=9-18&verdict=known (only the parts that are set). */
export function toSearchParams(q: FrameQuery): URLSearchParams {
	const p = new URLSearchParams();
	if (q.df !== null) p.set('df', `${q.df}`);
	if (q.tc !== null)
		p.set('tc', q.tc.from === q.tc.to ? `${q.tc.from}` : `${q.tc.from}-${q.tc.to}`);
	if (q.verdict !== null) p.set('verdict', q.verdict);
	return p;
}

/** The reverse of toSearchParams; throws a RangeError on anything malformed. */
export function fromSearchParams(p: URLSearchParams): FrameQuery {
	const int = (s: string, max: number) => {
		if (!/^\d+$/.test(s) || +s > max) throw new RangeError(`expected 0–${max}, got "${s}"`);
		return +s;
	};
	const df = p.get('df');
	const tc = p.get('tc');
	const verdict = p.get('verdict');

	let range: FrameQuery['tc'] = null;
	if (tc !== null) {
		const [from, to = from] = tc.split('-');
		range = { from: int(from, 31), to: int(to, 31) };
		if (range.from > range.to) throw new RangeError(`empty type code range "${tc}"`);
	}
	if (verdict !== null && !VERDICTS.includes(verdict as Verdict))
		throw new RangeError(`unknown verdict "${verdict}"`);

	return {
		df: df === null ? null : int(df, 31),
		tc: range,
		verdict: verdict as Verdict | null
	};
}
