import { ambiguousFields, comparisonFields, registerFields } from '#lib/describe/comm-b.ts';
import type { Field } from '#lib/describe/field.ts';
import { squitterFields } from '#lib/describe/squitter.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import { perSecond, RateWindow } from '#lib/rate-window.ts';
import type { Verdict } from '#lib/modes/address-filter.ts';
import { AdsbMemory } from '#lib/modes/adsb-memory.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import { inferRegister, type Inference } from '#lib/modes/comm-b.ts';
import { downlinkFormat, fromHex, payload } from '#lib/modes/frame.ts';
import { adsbRegister } from '#lib/modes/registers.ts';
import { squitter } from '#lib/modes/squitter.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import { CommBAircraftList, type CommBAircraft } from './aircraft';

/** Broadcast: ADS-B, sent on the aircraft's own. Interrogated: Comm-B, a radar asked for it. */
export type Source = 'broadcast' | 'interrogated';

export interface RegisterRow {
	id: number;
	rx: number;
	hex: string;
	/** The 56 register bits as hex: MB (DF20/21) or ME (DF17). */
	mb: string;
	df: number;
	icao: string;
	verdict: Verdict;
	/** Latest known callsign of the aircraft (ADS-B or register 2,0). */
	callsign: string | null;
	source: Source;
	/** The register (BDS code); for Comm-B replies without one: empty, ambiguous or unknown. */
	key: string;
	/** Comm-B only: how the register was inferred. */
	inference: Inference | null;
	fields: Field[];
	/** Comm-B only: the reading next to ADS-B. */
	comparisons: Field[];
}

export type Counts = Record<string, Record<Source, number>>;

const MAX_ROWS = 2000;
/** Rows the page shows at most; also what each register's buffer keeps. */
export const FEED_ROWS = 200;
/**
 * A callsign is forgotten once its aircraft has sent nothing trustworthy for this long, ms
 * (like AdsbMemory's). Kept as long as anything comes, not just callsigns: a radar may ask
 * for 2,0 only now and then.
 */
const CALLSIGN_TTL_MS = 5 * 60_000;

/**
 * /comm-b's view of the live stream: every register reading, broadcast or interrogated.
 * Valid ADS-B goes into an AdsbMemory first, so Comm-B replies can be compared with it.
 */
export class CommBStream extends LiveFeed<RegisterRow> {
	/** Readings per register and source, since the app was opened (routes/streams.ts). */
	counts = $state.raw<Counts>({});
	/** Per second, over the last 10 s. */
	rates = $state.raw<Counts>({});
	/** Aircraft with verified Comm-B replies in the last minute, by address. */
	aircraft = $state.raw<CommBAircraft[]>([]);
	/** The latest frame's time (server clock): "now" for ages like "3 s ago". */
	now = $state(0);

	#memory = new AdsbMemory();
	#aircraft = new CommBAircraftList();
	/**
	 * Each aircraft's latest callsign (ADS-B or 2,0), and when anything trustworthy last came
	 * from it. Plain Map on purpose: bookkeeping, never rendered (rows copy the callsign out).
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#callsigns = new Map<string, { callsign: string | null; seen: number }>();
	/** On the server's clock, like the frames. */
	#window = new RateWindow<Counts>();
	/**
	 * The latest FEED_ROWS readings of each register and source ("4,0 interrogated"), oldest
	 * first, like the server's FrameBuffers for /frames. Each turns over only as fast as its own
	 * register arrives, so a rare one (an "unknown", a 0,9 a radar asked for) can still be
	 * found long after the 2000 general rows have moved on. Fed also while the list is paused.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#latest = new Map<string, RegisterRow[]>();

	constructor() {
		super(MAX_ROWS);
	}

	override reset(): void {
		super.reset();
		this.#memory = new AdsbMemory();
		this.#callsigns.clear();
		this.#window.clear();
		this.#aircraft.clear();
		this.#latest.clear();
		this.counts = {};
		this.rates = {};
		this.aircraft = [];
		this.now = 0;
	}

	protected process(frames: WireFrame[]): RegisterRow[] {
		if (frames.length === 0) return [];
		const rows = frames.flatMap((f) => this.#row(f) ?? []);
		const now = frames.at(-1)!.rx; // the server's clock, like the frames'
		this.#memory.prune(now);
		this.#aircraft.prune(now);
		for (const [icao, c] of this.#callsigns)
			if (now - c.seen > CALLSIGN_TTL_MS) this.#callsigns.delete(icao);
		this.#count(rows, now);
		for (const r of rows) {
			const key = `${r.key} ${r.source}`;
			const kept = this.#latest.get(key) ?? [];
			kept.push(r);
			if (kept.length > FEED_ROWS) kept.shift();
			this.#latest.set(key, kept);
		}
		this.aircraft = this.#aircraft.list();
		this.now = now;
		return rows;
	}

	/**
	 * The latest readings of one register (from one source, or both), newest first and no
	 * newer than `upTo` (a row id: while the list is paused, the rows held back stay hidden
	 * here too). Not reactive: read it where `items` is read, which changes with every update.
	 */
	latest(key: string, source: Source | null, upTo: number): RegisterRow[] {
		const sources: Source[] = source ? [source] : ['broadcast', 'interrogated'];
		return sources
			.flatMap((s) => this.#latest.get(`${key} ${s}`) ?? [])
			.filter((r) => r.id <= upTo)
			.sort((a, b) => b.id - a.id);
	}

	#row(f: WireFrame): RegisterRow | null {
		const data = fromHex(f.hex);
		const df = downlinkFormat(data);
		const addr = f.addr;
		const mb = payload(data);
		if (!addr || !mb) return null;
		const base = {
			id: f.id,
			rx: f.rx,
			hex: f.hex,
			mb: f.hex.slice(8, 22), // after the 32 bits of DF and control fields
			df,
			icao: addr.icao,
			verdict: addr.verdict
		};

		if (df === 17 && addr.verdict === 'valid') {
			this.#memory.add(addr.icao, mb, f.rx);
			const s = squitter(mb);
			const key = adsbRegister(s);
			const callsign = this.#heard(
				addr.icao,
				f.rx,
				s.kind === 'identification' ? s.callsign : null
			);
			if (!key) return null;
			return {
				...base,
				callsign,
				source: 'broadcast',
				key,
				inference: null,
				fields: squitterFields(s),
				comparisons: []
			};
		}

		if (df === 20 || df === 21) {
			// Only compare with ADS-B if the address is trustworthy (see the parity check on /frames).
			const adsb = addr.verdict === 'known' ? this.#memory.get(addr.icao) : null;
			const inference = inferRegister(mb, {
				now: f.rx,
				replyAltitude: df === 20 ? replyAltitude(data).feet : null,
				adsb,
				address: addr.verdict === 'known' ? addr.icao : null
			});
			const best = inference.best;
			// Only a known address is trusted: a corrupted reply's garbled address could
			// otherwise give an aircraft heard later someone else's callsign.
			let callsign: string | null = null;
			if (addr.verdict === 'known') {
				const read = best?.register.bds === '2,0' ? best.register.callsign : null;
				callsign = this.#heard(addr.icao, f.rx, read);
				this.#aircraft.add(addr.icao, f.rx, best?.register ?? null, callsign);
			}
			return {
				...base,
				callsign,
				source: 'interrogated',
				key: best?.bds ?? inference.how,
				inference,
				fields: best
					? registerFields(best.register)
					: inference.how === 'ambiguous'
						? ambiguousFields(inference.candidates)
						: [],
				comparisons: best ? comparisonFields(best.comparisons) : []
			};
		}
		return null;
	}

	/** A trustworthy message from an aircraft, with a callsign or without: its latest callsign. */
	#heard(icao: string, t: number, callsign: string | null): string | null {
		const c = this.#callsigns.get(icao);
		const latest = callsign ?? c?.callsign ?? null;
		this.#callsigns.set(icao, { callsign: latest, seen: t });
		return latest;
	}

	#count(rows: RegisterRow[], now: number): void {
		const counts = { ...this.counts };
		for (const r of rows) {
			const c = (counts[r.key] = { ...(counts[r.key] ?? { broadcast: 0, interrogated: 0 }) });
			c[r.source]++;
		}
		this.counts = counts;

		const window = this.#window.add(now, counts);
		if (!window) return;
		const { then, seconds } = window;
		this.rates = Object.fromEntries(
			Object.entries(counts).map(([key, c]) => [key, perSecond(c, then[key] ?? {}, seconds)])
		);
	}
}
