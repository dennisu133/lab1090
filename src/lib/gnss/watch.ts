/**
 * Watches every aircraft's satellite navigation (navigation.ts judges each position message)
 * and keeps what the map's experimental GNSS layer draws (lib/map/gnss.ts) and its panel
 * (routes/GnssPanel.svelte) explains:
 *
 * - Changes: where an aircraft lost good navigation, and where it got it back. A jammer on
 *   the ground drowns the satellites' signal out to some distance (further for aircraft
 *   higher up, which see it over more of the Earth's curve), so the aircraft flying into
 *   that area lose GNSS around its edge, and the places they lost it outline the area.
 *   Getting it back comes later than leaving: a receiver needs a while to find the
 *   satellites again, half a minute or more after a cold start.
 * - The stretches flown with degraded positions (TC 18 and the like: the aircraft goes on
 *   from its inertial reference and still says where it is).
 * - A hexagon grid (hexes.ts): per cell, how many aircraft were heard there and how many of
 *   them without good navigation. Where most are, there's interference; where one in twenty
 *   is, that one aircraft has a problem of its own. That share is the idea of gpsjam.org's
 *   daily maps; one receiver hears far less traffic, so it's a few hours here, not a day.
 *
 * A state counts once HOLD messages in a row say it, so a single odd message changes
 * nothing. The first state an aircraft is heard in is its "arrival": an aircraft that arrives
 * degraded lost its GNSS before we heard it. Some airliners keep a GNSS receiver confused
 * by spoofing for the rest of the flight, and some navigate without GNSS on purpose (older
 * aircraft, military). Those come in from the edge of the coverage degraded and leave it
 * degraded: no change, so no change marker, but they do count in the grid's cells, which is
 * why a cell needs a share (MANY_SHARE) and not just one degraded aircraft.
 *
 * What it can't see: a spoofed receiver that believes the false signals goes on reporting
 * a good NIC for a wrong position (one receiver has nothing to check it against but the
 * speed and range checks in tracker/positions.ts); and where the jammer is (one receiver
 * sees only the aircraft it hears, so the edge of an area beyond them is unknown).
 *
 * Kept per tab for WINDOW_MS, like the other views. Shared by server and browser.
 */
import type { LatLon } from '#lib/modes/cpr.ts';
import { HexGrid } from './hexes';
import type { Judgement, Navigation } from './navigation';

/** A state counts once this many messages in a row say it. */
export const HOLD = 3;
/** Changes, stretches and the grid's counts are kept this long, ms. */
export const WINDOW_MS = 6 * 3_600_000;
/** An aircraft not heard for this long is forgotten: if it comes back, it arrives anew. */
export const FORGET_MS = 10 * 60_000;
/**
 * A change gets a place only from a position at most this far in time from it (the last good
 * one before, the first good one after), ms: else nobody heard where it happened.
 */
export const PLACE_MS = 30_000;
/** Degraded stretches keep a point this often, ms (at 450 kt, every 2.3 km). */
const STEP_MS = 10_000;
/** A gap this long without a degraded position starts a new stretch, ms. */
const STRETCH_GAP_MS = 60_000;
/** The grid's cells: centre to corner, km (about 26 km across). */
export const CELL_KM = 15;
/** A cell is shown once this many aircraft were heard in it. */
export const MIN_AIRCRAFT = 3;
/**
 * A cell where at least this share of its aircraft, and at least MANY_AIRCRAFT of them, had
 * no good navigation is marked as such: one aircraft with a problem of its own can't.
 */
export const MANY_SHARE = 0.25;
export const MANY_AIRCRAFT = 2;

/** One airborne position message, judged, with what the tracker made of it. */
export interface Observation {
	icao: string;
	/** ms */
	t: number;
	judgement: Judgement;
	/** Where it put the aircraft, if the tracker believed it; null for TC 0, or rejected. */
	position: LatLon | null;
	/** Barometric altitude, ft. */
	altitude: number | null;
	callsign: string | null;
}

export interface Change {
	id: number;
	icao: string;
	callsign: string | null;
	kind: 'lost' | 'regained';
	/** The state it went into (lost: degraded or none) or came from (regained). */
	other: 'degraded' | 'none';
	/** The first message in the new state, ms. */
	t: number;
	/**
	 * Lost: the last good position, it was still fine there. Regained: the first good one.
	 * null: none within PLACE_MS of the change.
	 */
	at: LatLon | null;
	/** When `at` was, ms. */
	atT: number | null;
	altitude: number | null;
	/** ms between the last message in the old state and the first in the new: unheard. */
	gap: number;
}

/** A stretch flown with degraded positions. */
export interface Stretch {
	id: number;
	icao: string;
	/** The aircraft arrived degraded: it lost GNSS before we heard it. */
	arrived: boolean;
	points: { t: number; lat: number; lon: number }[];
}

export type CellLevel = 'clear' | 'some' | 'many';

export interface Cell {
	key: string;
	center: LatLon;
	/** The outline, [lon, lat], closed. */
	ring: [number, number][];
	/** Aircraft heard in it within WINDOW_MS, and how many of them without good navigation. */
	aircraft: number;
	degraded: number;
	level: CellLevel;
}

export interface CellAircraft {
	icao: string;
	callsign: string | null;
	degraded: boolean;
	/** When it was last there, ms. */
	t: number;
}

/** An aircraft as the watch sees it now. */
export interface Watched {
	icao: string;
	callsign: string | null;
	/** null until HOLD messages agreed. */
	state: Navigation | null;
	/** Since when, ms. */
	since: number;
	/** The first state it was heard in. */
	arrived: Navigation | null;
	/** Its navigation was good at some point while we heard it. */
	wasGood: boolean;
	/** The latest message in its current state: what it says (a stray one in another doesn't count). */
	judgement: Judgement;
	lastSeen: number;
	altitude: number | null;
}

interface Tracked extends Watched {
	/**
	 * The current run of messages in one state: since `t`, the message before it at `before`,
	 * the first position in it.
	 */
	run: {
		state: Navigation;
		count: number;
		t: number;
		before: number;
		first: { t: number; at: LatLon } | null;
	};
	/** The last good position, while good. */
	lastGood: { t: number; at: LatLon; altitude: number | null } | null;
	/** A regaining that has no place yet: the next good position gives it one. */
	awaiting: Change | null;
	stretch: Stretch | null;
}

export class GnssWatch {
	readonly grid: HexGrid;
	#aircraft = new Map<string, Tracked>();
	#changes: Change[] = [];
	#stretches: Stretch[] = [];
	/** Per cell, per aircraft: last there, and whether ever without good navigation there. */
	#cells = new Map<string, Map<string, { t: number; degraded: boolean }>>();
	#ids = 0;
	/** The first message seen, ms; null: none yet. */
	first: number | null = null;

	constructor(receiver: LatLon) {
		this.grid = new HexGrid(receiver, CELL_KM);
	}

	/** Feed one judged message. In time order per aircraft. */
	add(o: Observation): void {
		this.first ??= o.t;
		let a = this.#aircraft.get(o.icao);
		if (a && o.t - a.lastSeen > FORGET_MS) a = undefined;
		if (!a) {
			a = {
				icao: o.icao,
				callsign: null,
				state: null,
				since: o.t,
				arrived: null,
				wasGood: false,
				judgement: o.judgement,
				lastSeen: o.t,
				altitude: null,
				run: { state: o.judgement.state, count: 0, t: o.t, before: o.t, first: null },
				lastGood: null,
				awaiting: null,
				stretch: null
			};
			this.#aircraft.set(o.icao, a);
		}
		const state = o.judgement.state;
		if (o.callsign) a.callsign = o.callsign;
		if (o.altitude !== null) a.altitude = o.altitude;
		if (a.run.state !== state) a.run = { state, count: 0, t: o.t, before: a.lastSeen, first: null };
		a.lastSeen = o.t;
		a.run.count++;
		if (o.position && !a.run.first) a.run.first = { t: o.t, at: o.position };

		if (a.run.count >= HOLD && a.state !== state) this.#switch(a, state);
		if (a.state === state || a.state === null) a.judgement = o.judgement;

		if (state === 'good' && a.state === 'good') {
			if (o.position) a.lastGood = { t: o.t, at: o.position, altitude: o.altitude };
			if (a.awaiting && o.position) {
				if (o.t - a.awaiting.t <= PLACE_MS) this.#place(a.awaiting, o.position, o.t);
				a.awaiting = null;
			}
		}

		if (o.position && a.state !== null) {
			if (a.state === 'degraded' && state === 'degraded') this.#extend(a, o.t, o.position);
			this.#count(o.position, a.icao, o.t, a.state !== 'good');
		}
	}

	/** A state held for HOLD messages: count it, and note a change. */
	#switch(a: Tracked, state: Navigation): void {
		const before = a.state;
		a.state = state;
		a.since = a.run.t;
		if (before === null) a.arrived = state;
		if (state === 'good') a.wasGood = true;
		a.awaiting = null;
		// A new stretch for every degraded spell, from the run's first position (HOLD
		// messages back).
		a.stretch = null;
		if (state === 'degraded' && a.run.first) this.#extend(a, a.run.first.t, a.run.first.at);

		if (before === 'good') {
			const last = a.lastGood;
			const placed = last && a.run.t - last.t <= PLACE_MS ? last : null;
			const change = this.#change(a, 'lost', state as 'degraded' | 'none');
			if (placed) {
				change.at = placed.at;
				change.atT = placed.t;
				change.altitude = placed.altitude;
				// Nothing after it to count: the cell where it was last placed counts it.
				if (state === 'none') this.#count(placed.at, a.icao, a.run.t, true);
			}
		} else if (state === 'good' && before !== null) {
			const change = this.#change(a, 'regained', before);
			const first = a.run.first;
			if (first && first.t - a.run.t <= PLACE_MS) this.#place(change, first.at, first.t);
			else a.awaiting = change;
			a.lastGood = first ? { t: first.t, at: first.at, altitude: a.altitude } : null;
		}
	}

	#change(a: Tracked, kind: Change['kind'], other: 'degraded' | 'none'): Change {
		const change: Change = {
			id: ++this.#ids,
			icao: a.icao,
			callsign: a.callsign,
			kind,
			other,
			t: a.run.t,
			at: null,
			atT: null,
			altitude: a.altitude,
			gap: a.run.t - a.run.before
		};
		this.#changes.push(change);
		return change;
	}

	#place(change: Change, at: LatLon, t: number): void {
		change.at = at;
		change.atT = t;
	}

	#extend(a: Tracked, t: number, at: LatLon): void {
		let s = a.stretch;
		const last = s?.points.at(-1);
		if (s && last && t - last.t > STRETCH_GAP_MS) s = null;
		if (!s) {
			s = { id: ++this.#ids, icao: a.icao, arrived: !a.wasGood, points: [] };
			a.stretch = s;
			this.#stretches.push(s);
		}
		const tail = s.points.at(-1);
		const point = { t, lat: at.lat, lon: at.lon };
		// A point every STEP_MS; the last one follows the aircraft, so the line reaches it.
		if (s.points.length >= 2 && tail && t - s.points.at(-2)!.t < STEP_MS)
			s.points[s.points.length - 1] = point;
		else s.points.push(point);
	}

	#count(at: LatLon, icao: string, t: number, degraded: boolean): void {
		const key = this.grid.key(at);
		let cell = this.#cells.get(key);
		if (!cell) this.#cells.set(key, (cell = new Map()));
		const was = cell.get(icao);
		cell.set(icao, { t, degraded: degraded || (was?.degraded ?? false) });
	}

	/** Forget what's older than WINDOW_MS, and aircraft gone for FORGET_MS. */
	prune(now: number): void {
		const since = now - WINDOW_MS;
		this.#changes = this.#changes.filter((c) => c.t >= since);
		this.#stretches = this.#stretches.filter((s) => s.points.at(-1)!.t >= since);
		for (const s of this.#stretches) {
			const old = s.points.findIndex((p) => p.t >= since);
			if (old > 0) s.points.splice(0, old);
		}
		for (const [key, cell] of this.#cells) {
			for (const [icao, e] of cell) if (e.t < since) cell.delete(icao);
			if (cell.size === 0) this.#cells.delete(key);
		}
		for (const [icao, a] of this.#aircraft)
			if (now - a.lastSeen > FORGET_MS) this.#aircraft.delete(icao);
	}

	/** The changes, oldest first (copies). */
	changes(): Change[] {
		return this.#changes.map((c) => ({ ...c }));
	}

	/** The degraded stretches with two points or more (copies). */
	stretches(): Stretch[] {
		return this.#stretches
			.filter((s) => s.points.length >= 2)
			.map((s) => ({ ...s, points: [...s.points] }));
	}

	/** Every cell with at least MIN_AIRCRAFT aircraft. */
	cells(): Cell[] {
		const out: Cell[] = [];
		for (const [key, cell] of this.#cells) {
			if (cell.size < MIN_AIRCRAFT) continue;
			let degraded = 0;
			for (const e of cell.values()) if (e.degraded) degraded++;
			const share = degraded / cell.size;
			out.push({
				key,
				center: this.grid.center(key),
				ring: this.grid.ring(key),
				aircraft: cell.size,
				degraded,
				level:
					degraded === 0
						? 'clear'
						: share >= MANY_SHARE && degraded >= MANY_AIRCRAFT
							? 'many'
							: 'some'
			});
		}
		return out;
	}

	/** The aircraft heard in a cell, the degraded ones first. */
	cellAircraft(key: string): CellAircraft[] {
		const cell = this.#cells.get(key);
		if (!cell) return [];
		return [...cell]
			.map(([icao, e]) => ({ icao, callsign: this.#aircraft.get(icao)?.callsign ?? null, ...e }))
			.sort((a, b) => Number(b.degraded) - Number(a.degraded) || b.t - a.t);
	}

	/** Every aircraft heard within FORGET_MS (copies, without the bookkeeping). */
	aircraft(): Watched[] {
		return [...this.#aircraft.values()].map((a) => ({
			icao: a.icao,
			callsign: a.callsign,
			state: a.state,
			since: a.since,
			arrived: a.arrived,
			wasGood: a.wasGood,
			judgement: a.judgement,
			lastSeen: a.lastSeen,
			altitude: a.altitude
		}));
	}

	/** Aircraft counted in the grid within WINDOW_MS, and how many of them were ever degraded. */
	totals(): { aircraft: number; degraded: number } {
		const all = new Map<string, boolean>();
		for (const cell of this.#cells.values())
			for (const [icao, e] of cell) all.set(icao, (all.get(icao) ?? false) || e.degraded);
		let degraded = 0;
		for (const d of all.values()) if (d) degraded++;
		return { aircraft: all.size, degraded };
	}
}
