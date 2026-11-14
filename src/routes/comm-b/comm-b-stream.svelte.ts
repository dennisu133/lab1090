import { broadcastRegister, comparisonFields, registerFields } from '#lib/describe/comm-b.ts';
import { squitterFields, type Field } from '#lib/describe/frame.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import type { Verdict } from '#lib/modes/address-filter.ts';
import { AdsbMemory } from '#lib/modes/adsb-memory.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import { inferRegister, type Inference } from '#lib/modes/comm-b.ts';
import { downlinkFormat, fromHex, payload } from '#lib/modes/frame.ts';
import { squitter } from '#lib/modes/squitter.ts';
import type { WireFrame } from '#lib/receiver-types.ts';

/** Broadcast: ADS-B, sent on the aircraft's own. Interrogated: Comm-B, a radar asked for it. */
export type Source = 'broadcast' | 'interrogated';

export interface RegisterRow {
	id: number;
	rx: number;
	hex: string;
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
const RATE_WINDOW_MS = 10_000;

/**
 * /comm-b's view of the live stream: every register reading, broadcast or interrogated.
 * Valid ADS-B goes into an AdsbMemory first, so Comm-B replies can be compared with it.
 */
export class CommBStream extends LiveFeed<RegisterRow> {
	/** Readings per register and source, since the page was opened. */
	counts = $state.raw<Counts>({});
	/** Per second, over the last 10 s. */
	rates = $state.raw<Counts>({});

	#memory = new AdsbMemory();
	// Plain Map on purpose: bookkeeping, never rendered (rows copy the callsign out).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#callsigns = new Map<string, string>();
	#recent: { rx: number; key: string; source: Source }[] = [];

	constructor() {
		super(MAX_ROWS);
	}

	protected reset(): void {
		this.#memory = new AdsbMemory();
		this.#callsigns.clear();
		this.#recent = [];
		this.counts = {};
		this.rates = {};
	}

	protected process(frames: WireFrame[]): RegisterRow[] {
		if (frames.length === 0) return [];
		const rows = frames.flatMap((f) => this.#row(f) ?? []);
		const now = frames.at(-1)!.rx; // the server's clock, like the frames'
		this.#memory.prune(now);
		this.#count(rows, now);
		return rows;
	}

	#row(f: WireFrame): RegisterRow | null {
		const data = fromHex(f.hex);
		const df = downlinkFormat(data);
		const addr = f.addr;
		const mb = payload(data);
		if (!addr || !mb) return null;
		const base = { id: f.id, rx: f.rx, hex: f.hex, df, icao: addr.icao, verdict: addr.verdict };

		if (df === 17 && addr.verdict === 'valid') {
			this.#memory.add(addr.icao, mb, f.rx);
			const key = broadcastRegister(mb[0] >> 3);
			const s = squitter(mb);
			if (s?.kind === 'identification') this.#callsigns.set(addr.icao, s.callsign);
			if (!key) return null;
			return {
				...base,
				callsign: this.#callsigns.get(addr.icao) ?? null,
				source: 'broadcast',
				key,
				inference: null,
				fields: s ? squitterFields(s) : [],
				comparisons: []
			};
		}

		if (df === 20 || df === 21) {
			// Only compare with ADS-B if the address is trustworthy (see the parity check on /frames).
			const adsb = addr.verdict === 'known' ? this.#memory.get(addr.icao) : null;
			const inference = inferRegister(mb, {
				now: f.rx,
				replyAltitude: df === 20 ? replyAltitude(data).feet : null,
				adsb
			});
			const best = inference.best;
			if (best?.register.bds === '2,0') this.#callsigns.set(addr.icao, best.register.callsign);
			return {
				...base,
				callsign: this.#callsigns.get(addr.icao) ?? null,
				source: 'interrogated',
				key: best?.bds ?? inference.how,
				inference,
				fields: best ? registerFields(best.register) : [],
				comparisons: best ? comparisonFields(best.comparisons) : []
			};
		}
		return null;
	}

	#count(rows: RegisterRow[], now: number): void {
		const counts = { ...this.counts };
		for (const r of rows) {
			const c = (counts[r.key] = { ...(counts[r.key] ?? { broadcast: 0, interrogated: 0 }) });
			c[r.source]++;
			this.#recent.push({ rx: r.rx, key: r.key, source: r.source });
		}
		this.counts = counts;

		this.#recent = this.#recent.filter((e) => now - e.rx <= RATE_WINDOW_MS);
		const rates: Counts = {};
		for (const e of this.#recent) {
			const r = (rates[e.key] ??= { broadcast: 0, interrogated: 0 });
			r[e.source] += 1000 / RATE_WINDOW_MS;
		}
		this.rates = rates;
	}
}
