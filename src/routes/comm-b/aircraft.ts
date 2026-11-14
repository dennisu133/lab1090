/**
 * /comm-b's per-aircraft view: what the radars have read from each aircraft, and the latest
 * reading of the registers that make up Enhanced Surveillance (EHS: 4,0, 5,0, 6,0).
 *
 * Only replies with a verified address count ("known" on /frames): an unverified address
 * is most likely a corrupted reply, and would show up as a phantom aircraft.
 *
 * Immutable on purpose: every change makes a new object, so the page (which holds the list
 * in $state.raw) re-renders exactly the rows that changed.
 */
import type {
	GicbCapability,
	HeadingAndSpeed,
	Register,
	TrackAndTurn,
	VerticalIntention
} from '#lib/modes/registers.ts';

/** Aircraft whose last verified reply is older than this are dropped (same as the address filter). */
export const AIRCRAFT_TTL_MS = 60_000;

export interface Reading<T> {
	value: T;
	rx: number;
}

export interface CommBAircraft {
	icao: string;
	callsign: string | null;
	/** Interrogated replies (DF20/21), since the aircraft appeared on the list. */
	replies: number;
	lastRx: number;
	/** Per register (BDS): how often it was read and when last. */
	registers: Record<string, { count: number; lastRx: number }>;
	/** The latest 1,7: which registers the transponder says a radar can read. */
	gicb: Reading<GicbCapability> | null;
	intention: Reading<VerticalIntention> | null;
	trackAndTurn: Reading<TrackAndTurn> | null;
	headingAndSpeed: Reading<HeadingAndSpeed> | null;
}

export class CommBAircraftList {
	// Plain Map: bookkeeping, never rendered (list() hands out snapshots).
	#byIcao = new Map<string, CommBAircraft>();

	/** One verified DF20/21 reply; `register` is the inferred one, null if none was. */
	add(icao: string, rx: number, register: Register | null, callsign: string | null): void {
		const old = this.#byIcao.get(icao);
		const a: CommBAircraft = old
			? { ...old, callsign: callsign ?? old.callsign, replies: old.replies + 1, lastRx: rx }
			: {
					icao,
					callsign,
					replies: 1,
					lastRx: rx,
					registers: {},
					gicb: null,
					intention: null,
					trackAndTurn: null,
					headingAndSpeed: null
				};
		if (register) {
			const seen = a.registers[register.bds];
			a.registers = {
				...a.registers,
				[register.bds]: { count: (seen?.count ?? 0) + 1, lastRx: rx }
			};
			if (register.bds === '1,7') a.gicb = { value: register, rx };
			if (register.bds === '4,0') a.intention = { value: register, rx };
			if (register.bds === '5,0') a.trackAndTurn = { value: register, rx };
			if (register.bds === '6,0') a.headingAndSpeed = { value: register, rx };
		}
		this.#byIcao.set(icao, a);
	}

	/** Forget aircraft not heard within the TTL. */
	prune(now: number): void {
		for (const [icao, a] of this.#byIcao) {
			if (now - a.lastRx > AIRCRAFT_TTL_MS) this.#byIcao.delete(icao);
		}
	}

	/** Sorted by address, so rows don't jump around as replies come in. */
	list(): CommBAircraft[] {
		return [...this.#byIcao.values()].sort((a, b) => a.icao.localeCompare(b.icao));
	}

	clear(): void {
		this.#byIcao.clear();
	}
}

export type RegisterStatus = 'read' | 'not read' | 'not listed';

/**
 * Every register to show for an aircraft: the ones radars read, plus the ones its 1,7 lists
 * but nobody read. "not listed": read, but 1,7 says the transponder doesn't have it. Only
 * for registers 1,7 has a bit for (GICB_MAP); 1,0, 1,7 and 3,0 aren't in it.
 */
export function registerStatuses(
	a: CommBAircraft,
	listable: readonly string[]
): { bds: string; status: RegisterStatus }[] {
	const supported = a.gicb?.value.supported ?? null;
	const all = new Set([...Object.keys(a.registers), ...(supported ?? [])]);
	return [...all].sort().map((bds) => ({
		bds,
		status: !(bds in a.registers)
			? 'not read'
			: supported && listable.includes(bds) && !supported.includes(bds)
				? 'not listed'
				: 'read'
	}));
}
