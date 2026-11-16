/**
 * Finds the radars that interrogate the aircraft we hear, and keeps them: the map's radar
 * sites (lib/map/radars.ts) and the panel that explains each (routes/RadarPanel.svelte).
 *
 * The steps, for every interrogator code heard in DF11 replies:
 *   1. bursts.ts: replies → bursts (one per sweep of the beam), each with the aircraft's
 *      ADS-B position at that moment.
 *   2. period.ts: the gaps between each aircraft's bursts → the rotation period.
 *   3. resection.ts: the position, direction and phase that explain the bursts, and how
 *      much the position moves leaving out each aircraft (the uncertainty ellipse).
 *   4. Gates (below), so chance can't make a radar: shuffling the capture's burst times by
 *      up to 5 s, the best "radar" explains 23 bursts (34 %) and never 4 aircraft with 3+
 *      bursts each; the real ones explain 63–306 bursts, 94–100 %. And the position must be
 *      pinned down: an uncertainty ellipse longer than MAX_ELLIPSE_KM is a line of
 *      possible places, not a place.
 *   5. What it explains is taken away, and the rest fitted again: Mode S radars whose
 *      coverage overlaps may share a code if they form a "cluster" that coordinates lockout
 *      and hands aircraft over through a ground network (Commission Regulation (EC) No
 *      262/2009; Eurocontrol's European Mode S Station Functional Specification, 2005).
 *      Each turns with its own phase. In the capture SI 60 has two, 0.17–0.33 s apart in
 *      every 5 s turn (too few aircraft yet to place either).
 *
 * A radar first found is a candidate: it's confirmed once every fit of its code has found
 * it again for CONFIRM_MS (each fit starts from where it was, on a window that has moved
 * on). A candidate that one fit doesn't find again is dropped; a confirmed radar after
 * MAX_MISSES fits in a row that found other radars on its code but not it. Without that, a
 * longer run piled up radars that one lucky fit had placed (eight on SI 52, all 4.0 s,
 * hundreds of km apart): each new fit more than SAME_RADAR_KM from the last counted as
 * another radar, and none ever went. Only confirmed radars are shown. One whose code goes
 * quiet, or whose fits find nothing, stays with its last fit: radars don't move. Its beam
 * is only drawn while it's heard: a period good to 0.1 ms still drifts a degree in a few
 * minutes.
 *
 * Kept per tab, like everything else: bursts for the last WINDOW_MS.
 *
 * Checked on the capture against the sites on OpenStreetMap and the ANSPs' pages
 * (finder.test.ts): within 1–11 km for radars 200–470 km away.
 */
import { bearing, distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { BurstCollector, type Burst } from './bursts';
import { estimatePeriod, gaps } from './period';
import {
	fitAt,
	INLIER,
	inliers,
	refine,
	search,
	spread,
	type Fit,
	type Sighting,
	type Spread
} from './resection';

/** Bursts older than this are dropped, ms. The capture's 10 minutes is what's been checked. */
export const WINDOW_MS = 10 * 60_000;
/** The gates: explained bursts, aircraft with at least MIN_PER_AIRCRAFT of them, share. */
export const MIN_BURSTS = 30;
export const MIN_AIRCRAFT = 4;
export const MIN_PER_AIRCRAFT = 3;
/** Of the bursts left to explain: 40 %, so each of two radars sharing a code can pass. */
export const MIN_SHARE = 0.4;
/**
 * The longest the uncertainty ellipse's semi-major axis may be, km (2 standard errors). On
 * the capture the five real radars' ellipses run 5–13 km (SI 44, 185 km away), 13–56 (SI 17,
 * 400 km), 39–102 (SI 28, 470 km), 33 (SI 33) and 130–306 (SI 35, 10 s period, few
 * bursts): SI 35 lands 4–44 km from the mapped site, but only because the true site
 * happens to lie on its line. Most phantoms of that longer run had ellipses well over 100 km long.
 */
export const MAX_ELLIPSE_KM = 50;
/**
 * The smallest ellipse shown, km (both semi-axes; the gates use the fitted one). The
 * jackknife only says how much the position hangs on single aircraft, not what all the
 * bursts get wrong together (a beam ~2.4° wide, positions up to half a second old), so a
 * well-answered radar can get an ellipse of almost nothing. Against mapped sites (live,
 * 16 Nov 2026, and the hour's recording): SI 26 (ellipse 0–6 km) 4 km from a Bundeswehr radar
 * tower, SI 33 (7–11 km) 5–13 km from Feichtberg, SI 17 (10–16 km) 7–14 km from Sączów.
 */
export const MIN_ELLIPSE_KM = 15;
/** A candidate is confirmed after being found again by every fit for this long, ms. */
export const CONFIRM_MS = 120_000;
/** A confirmed radar is dropped after this many fits in a row that find others on its code, not it. */
export const MAX_MISSES = 3;
/** Fit a code again at most this often, ms; one that failed waits FAILED_WAIT_MS or more data. */
const REFIT_MS = 30_000;
const FAILED_WAIT_MS = 120_000;
/** At most this many radars per code, candidates included. */
const MAX_PER_CODE = 3;
/**
 * A new fit within this distance of a known radar of the same code is that radar, km; two
 * radars on one code (a cluster) stand further apart than this.
 */
const SAME_RADAR_KM = 60;
/** The beam is drawn while the radar's last burst is at most this old, ms. */
export const BEAM_FRESH_MS = 120_000;
/** Gaps kept for the panel's chart, s. */
const CHART_GAP_S = 32;

export interface RadarAircraft {
	icao: string;
	/** Its bursts the fit explains, and all of its bursts to this code. */
	explained: number;
	bursts: number;
}

/** A radar we found: everything the map and the panel show. */
export interface Radar {
	/** "SI 44", or "SI 60 b" for the second radar on a code. */
	id: string;
	code: string;
	position: LatLon;
	/** Clockwise seen from above (almost all are). */
	clockwise: boolean;
	/** ms */
	period: number;
	/** A moment the beam pointed north, receiver clock, ms. */
	t0: number;
	/** Server clock minus receiver clock, ms: for the beam on the map (server time). */
	offset: number;
	/** Found again by every fit for CONFIRM_MS (else a candidate, not shown). */
	confirmed: boolean;
	/** First found, last fitted, last explained burst: server clock, ms. */
	found: number;
	fitted: number;
	heard: number;

	/** Step 1: replies and bursts to this code in the window; aircraft that sent them. */
	codeReplies: number;
	codeBursts: number;
	codeAircraft: number;
	/** Bursts left to explain when this radar was fitted (fewer than codeBursts for a second radar). */
	considered: number;
	/** Step 2: the period from the gaps alone (ms), how well it fits them (0–1), the gaps (s). */
	firstPeriod: number;
	periodScore: number;
	gaps: number[];
	/** Step 3: each considered burst's miss, beam degrees. */
	residuals: number[];
	explained: number;
	/** Of the explained bursts' misses. */
	median: number;
	/** The other direction's score against this one's (mean capped squared miss). */
	cost: number;
	otherCost: number;
	/** Explained bursts if it turned the other way. */
	otherExplained: number;
	aircraft: RadarAircraft[];
	/** Step 4: the jackknife. */
	spread: Spread;
	/** The furthest explained aircraft, km: how far it reaches (as far as we can tell). */
	reach: number;
	/** Other radars sharing its code. */
	sharing: string[];
}

/** A code heard, located or not: the panel's list. */
export interface CodeSummary {
	code: string;
	bursts: number;
	aircraft: number;
	/** Radars found on it (confirmed), and candidates waiting for confirmation. */
	radars: string[];
	candidates: string[];
}

interface CodeState {
	bursts: Burst[];
	replies: number;
	/** When it was last fitted (server clock), and with how many bursts; whether it failed. */
	fittedAt: number;
	fittedWith: number;
	failed: boolean;
}

/** "SI 44" for a DF11 reply's interrogator; null for II 0 (squitters) and invalid codes. */
export function codeName(i: { type: 'II' | 'SI' | 'invalid'; code: number } | null): string | null {
	if (!i || i.type === 'invalid' || (i.type === 'II' && i.code === 0)) return null;
	return `${i.type} ${i.code}`;
}

/** Where the beam points at server time `rx`, degrees from north. */
export function beamAt(radar: Radar, rx: number): number {
	const turns = (rx - radar.offset - radar.t0) / radar.period;
	const deg = ((turns % 1) + 1) % 1;
	return ((radar.clockwise ? deg : 1 - deg) * 360) % 360;
}

export class RadarFinder {
	#collector = new BurstCollector();
	#codes = new Map<string, CodeState>();
	#radars = new Map<string, Radar>();
	/** Fits in a row that didn't find each radar, by id. */
	#misses = new Map<string, number>();
	/** Smallest server − receiver clock difference: in this bucket, and the previous one. */
	#offset = { now: Infinity, before: Infinity, since: 0 };
	#latestT = -Infinity;

	/** Every DF11 reply with a usable code, in arrival order. */
	reply(code: string, icao: string, t: number, rx: number): void {
		// The receiver restarted (its clock starts again at 0): nothing old fits anymore.
		if (t < this.#latestT - 60_000) this.#restart();
		this.#latestT = Math.max(this.#latestT, t);
		this.#collector.reply(code, icao, t, rx);
		const state = this.#codes.get(code) ?? newCode();
		this.#codes.set(code, state);
		state.replies++;
		// The least delayed frame shows the clocks' difference best; buckets of 2 minutes so
		// it follows a drift.
		if (rx - this.#offset.since > 120_000)
			this.#offset = { now: Infinity, before: this.#offset.now, since: rx };
		this.#offset.now = Math.min(this.#offset.now, rx - t);
	}

	/** Every position the tracker believed. */
	position(icao: string, rx: number, lat: number, lon: number): void {
		this.#collector.position(icao, rx, lat, lon);
	}

	/**
	 * After each batch of frames: file new bursts, drop old ones, and fit at most one code
	 * (~100 ms for a search from scratch, ~10 ms to follow a known radar). Returns whether
	 * the radars changed.
	 */
	update(rx: number): boolean {
		for (const b of this.#collector.take(rx)) this.#codes.get(b.code)!.bursts.push(b);
		for (const state of this.#codes.values()) {
			const old = state.bursts.findIndex((b) => rx - b.rx <= WINDOW_MS);
			if (old > 0) state.bursts.splice(0, old);
			else if (old === -1) state.bursts.length = 0;
		}
		const due = [...this.#codes]
			.filter(([, s]) => s.bursts.length >= MIN_BURSTS && isDue(s, rx))
			.sort(([, a], [, b]) => a.fittedAt - b.fittedAt)[0];
		if (!due) return false;
		return this.#fit(due[0], due[1], rx);
	}

	/** Every confirmed radar, by code: what's shown. */
	get radars(): Radar[] {
		return this.#sorted().filter((r) => r.confirmed);
	}

	/** The candidates: found, not (yet) confirmed. */
	get candidates(): Radar[] {
		return this.#sorted().filter((r) => !r.confirmed);
	}

	#sorted(): Radar[] {
		return [...this.#radars.values()].sort((a, b) =>
			a.id.localeCompare(b.id, 'en', { numeric: true })
		);
	}

	/** Every code heard in the window, most bursts first. */
	get codes(): CodeSummary[] {
		return [...this.#codes]
			.filter(([, s]) => s.bursts.length > 0)
			.map(([code, s]) => ({
				code,
				bursts: s.bursts.length,
				aircraft: new Set(s.bursts.map((b) => b.icao)).size,
				radars: this.radars.filter((r) => r.code === code).map((r) => r.id),
				candidates: this.candidates.filter((r) => r.code === code).map((r) => r.id)
			}))
			.sort((a, b) => b.bursts - a.bursts);
	}

	/**
	 * Fit one code: each radar known on it from where it was, then search what's left for
	 * new ones. Then the bookkeeping: confirm, count misses, drop.
	 */
	#fit(code: string, state: CodeState, rx: number): boolean {
		state.fittedAt = rx;
		state.fittedWith = state.bursts.length;
		const all: Sighting[] = state.bursts
			.map((b) => ({ icao: b.icao, t: b.t, lat: b.lat, lon: b.lon }))
			.sort((a, b) => a.icao.localeCompare(b.icao) || a.t - b.t);
		// Confirmed first, then the longest-held candidates: they get their bursts first.
		const known = [...this.#radars.values()]
			.filter((r) => r.code === code)
			.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.found - b.found);
		let rest = all;
		const kept: Accepted[] = [];
		const take = (a: Accepted) => {
			kept.push(a);
			const explained = new Set(a.explained);
			rest = rest.filter((s) => !explained.has(s));
		};

		// Following a known radar is cheap (~10 ms), and keeps it the same one.
		for (const r of known) {
			if (rest.length < MIN_BURSTS) break;
			const first = estimatePeriod(gaps(byAircraftTimes(rest)));
			const fit = refine(rest, fitAt(rest, r.position, r.clockwise ? 1 : -1, r.period), 8);
			const a =
				distanceKm(fit.position, r.position) < SAME_RADAR_KM
					? accept(rest, fit, first ?? { period: r.firstPeriod / 1000, score: r.periodScore }, r)
					: null;
			if (a) take(a);
		}
		// A search from scratch (~100 ms) for each new one.
		while (kept.length < MAX_PER_CODE && rest.length >= MIN_BURSTS) {
			const first = estimatePeriod(gaps(byAircraftTimes(rest)));
			if (!first) break;
			const fit = search(rest, first.period * 1000);
			// Radars sharing a code (a cluster) stand at different sites: one where another
			// already stands is that radar's leftovers, not a second radar.
			if (kept.some((k) => distanceKm(k.tight.position, fit.position) < SAME_RADAR_KM)) break;
			// A known radar the step above lost may turn up again here.
			const same = known.find(
				(r) =>
					!kept.some((k) => k.same === r) && distanceKm(r.position, fit.position) < SAME_RADAR_KM
			);
			const a = accept(rest, fit, first, same);
			if (!a) break;
			take(a);
		}
		state.failed = kept.length === 0;

		// A candidate goes as soon as a fit doesn't find it. A confirmed radar only misses when
		// the fit found others on its code instead: a fit that found nothing at all says
		// nothing (too few aircraft yet, after a restart or as traffic thins out).
		let changed = false;
		for (const r of known)
			if (!kept.some((k) => k.same === r)) {
				if (r.confirmed && kept.length === 0) continue;
				const misses = (this.#misses.get(r.id) ?? 0) + 1;
				this.#misses.set(r.id, misses);
				if (!r.confirmed || misses >= MAX_MISSES) {
					this.#radars.delete(r.id);
					this.#misses.delete(r.id);
					changed ||= r.confirmed;
				}
			}
		const ids: string[] = [];
		for (const a of kept) {
			const id =
				a.same?.id ??
				[code, ...'bcdefgh'.split('').map((x) => `${code} ${x}`)].find(
					(x) => !this.#radars.has(x) && !ids.includes(x)
				)!;
			ids.push(id);
			const radar = this.#describe(id, code, state, a, rx);
			this.#radars.set(id, radar);
			this.#misses.set(id, 0);
			changed ||= radar.confirmed;
		}
		// Who it shares its code with: the confirmed ones (only those are shown).
		for (const r of this.#radars.values())
			if (r.code === code)
				r.sharing = [...this.#radars.values()]
					.filter((x) => x.code === code && x.id !== r.id && x.confirmed)
					.map((x) => x.id);
		return changed;
	}

	#describe(id: string, code: string, state: CodeState, a: Accepted, rx: number): Radar {
		const { fit, tight, spread: jackknife, explained, considered, first, same } = a;
		const other = fitAt(considered, fit.position, fit.direction === 1 ? -1 : 1, fit.period);
		const misses = explained.map((_, i) => Math.abs(tight.residuals[i])).sort((a, b) => a - b);
		const latest = Math.max(...explained.map((s) => s.t));
		const counts = Map.groupBy(considered, (s) => s.icao);
		const ok = new Set(explained);
		const found = same?.found ?? rx;
		return {
			id,
			code,
			position: tight.position,
			clockwise: tight.direction === 1,
			period: tight.period,
			t0: tight.t0,
			offset: Math.min(this.#offset.now, this.#offset.before),
			confirmed: !!same?.confirmed || rx - found >= CONFIRM_MS,
			found,
			fitted: rx,
			heard: state.bursts.find((b) => b.t === latest)?.rx ?? rx,
			codeReplies: state.bursts.reduce((s, b) => s + b.replies, 0),
			codeBursts: state.bursts.length,
			codeAircraft: new Set(state.bursts.map((b) => b.icao)).size,
			considered: considered.length,
			firstPeriod: first.period * 1000,
			periodScore: first.score,
			gaps: gaps(byAircraftTimes(explained)).filter((g) => g <= CHART_GAP_S),
			residuals: fit.residuals,
			explained: explained.length,
			median: misses[misses.length >> 1],
			cost: fit.cost,
			otherCost: other.cost,
			otherExplained: other.residuals.filter((r) => Math.abs(r) <= INLIER).length,
			aircraft: [...counts]
				.map(([icao, list]) => ({
					icao,
					bursts: list.length,
					explained: list.filter((s) => ok.has(s)).length
				}))
				.sort((a, b) => b.explained - a.explained),
			spread: jackknife,
			reach: Math.max(...explained.map((s) => distanceKm(tight.position, s))),
			sharing: []
		};
	}

	#restart(): void {
		// The radars stay (they don't move), but the clocks start again.
		this.#collector = new BurstCollector();
		for (const state of this.#codes.values()) state.bursts.length = 0;
		this.#offset = { now: Infinity, before: Infinity, since: 0 };
		this.#latestT = -Infinity;
	}
}

function newCode(): CodeState {
	return { bursts: [], replies: 0, fittedAt: -Infinity, fittedWith: 0, failed: false };
}

function isDue(s: CodeState, rx: number): boolean {
	if (s.fittedAt === -Infinity) return true;
	if (s.failed) return rx - s.fittedAt >= FAILED_WAIT_MS || s.bursts.length >= s.fittedWith * 1.25;
	return rx - s.fittedAt >= REFIT_MS;
}

/** Each aircraft's burst times, s, in order (the sightings are sorted by aircraft and time). */
function byAircraftTimes(sightings: Sighting[]): number[][] {
	return [...Map.groupBy(sightings, (s) => s.icao).values()].map((list) =>
		list.map((s) => s.t / 1000)
	);
}

/** A fit that passed every gate, with what the gates computed on the way. */
interface Accepted {
	fit: Fit;
	/** Fitted again to the explained bursts alone. */
	tight: Fit;
	spread: Spread;
	explained: Sighting[];
	/** The bursts it was fitted to. */
	considered: Sighting[];
	/** The period from the gaps alone, s, and its score. */
	first: { period: number; score: number };
	/** The known radar it is; undefined: a new one. */
	same: Radar | undefined;
}

/**
 * All the gates (passes(), then the ellipse): the fit with its jackknife, or null. The
 * jackknife is the expensive part (a refit per aircraft), so it comes last.
 */
function accept(
	considered: Sighting[],
	fit: Fit,
	first: { period: number; score: number },
	same: Radar | undefined
): Accepted | null {
	if (!passes(considered, fit)) return null;
	const explained = inliers(considered, fit);
	const tight = fitAt(explained, fit.position, fit.direction, fit.period);
	const jackknife = spread(explained, tight);
	if (!jackknife || jackknife.major > MAX_ELLIPSE_KM) return null;
	return { fit, tight, spread: jackknife, explained, considered, first, same };
}

/** The gates: enough explained bursts, from enough aircraft, a fair share of the rest. */
export function passes(sightings: Sighting[], fit: Fit): boolean {
	const explained = inliers(sightings, fit);
	if (explained.length < MIN_BURSTS || explained.length < MIN_SHARE * sightings.length)
		return false;
	const per = Map.groupBy(explained, (s) => s.icao);
	return [...per.values()].filter((list) => list.length >= MIN_PER_AIRCRAFT).length >= MIN_AIRCRAFT;
}

/** The radar's distance and bearing from a point (the receiver), for the panel. */
/** The ellipse as shown: the jackknife's, but no smaller than MIN_ELLIPSE_KM either way. */
export function shownSpread(radar: Radar): { major: number; minor: number; bearing: number } {
	const { major, minor, bearing } = radar.spread;
	return {
		major: Math.max(major, MIN_ELLIPSE_KM),
		minor: Math.max(minor, MIN_ELLIPSE_KM),
		bearing
	};
}

export function seenFrom(radar: Radar, from: LatLon): { km: number; bearing: number } {
	return { km: distanceKm(from, radar.position), bearing: bearing(from, radar.position) };
}
