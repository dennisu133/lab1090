/**
 * Test helpers for the radar finder: the capture run through it as the tracker page does,
 * synthetic radars and aircraft, and the real radar sites to compare with.
 */
import { bearing, destination } from '#lib/geo.ts';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat } from '#lib/modes/frame.ts';
import { timedMessages } from '#lib/modes/testing.ts';
import { Tracker } from '#lib/tracker/tracker.ts';
import { BURST_GAP_MS } from './bursts';
import { codeName, RadarFinder } from './finder';

/**
 * The radars the capture's codes turned out to be, as mapped by others: OpenStreetMap (©
 * OpenStreetMap contributors, ODbL; queried 2026-11-15 via the Overpass API), with the
 * operators' or press pages that say what they are. Only for the tests: the app shows what
 * it finds itself.
 */
export const KNOWN_SITES: Record<string, { name: string; position: LatLon; source: string }> = {
	'SI 44': {
		name: 'Neubrandenburg-Trollenhagen airfield, radar tower',
		position: { lat: 53.6045, lon: 13.2994 },
		source: 'OSM node 10767395624'
	},
	'SI 33': {
		name: 'Austro Control radar station Feichtberg',
		position: { lat: 48.4708, lon: 13.6853 },
		source: 'OSM way 413104111 ("Zivile Radarstation, Aktives Mittelbereichsradar")'
	},
	'SI 17': {
		name: 'PANSA PSR/MSSR Katowice, 46 m tower at Sączów (in service since 19 March 2026)',
		position: { lat: 50.436, lon: 19.0532 },
		source:
			'OSM way 1268201930; slazag.pl, "Nowy radar dozorowania ruchu lotniczego niedaleko Katowice Airport już pracuje!"'
	},
	'SI 28': {
		name: 'LPS SR secondary surveillance radar, Veľký Javorník (Little Carpathians)',
		position: { lat: 48.2608, lon: 17.1634 },
		source: 'OSM node 13844411926; sk.wikipedia.org, "Veľký Javorník (Malé Karpaty)"; lps.sk'
	},
	'SI 35': {
		name: '170th long-range radar post Wronowice (military; nothing confirms the code)',
		position: { lat: 51.6164, lon: 19.14 },
		source: 'wikimapia.org/17230832'
	}
};

/** A fixed server clock offset for the capture (its timestamps count from readsb's start). */
export const CAPTURE_RX = 1.7e12;

/**
 * The capture through a Tracker and a RadarFinder, updated every 250 ms like the stream.
 * `jitterMs`: move every burst (all its replies together) by a random 0–jitterMs, keeping
 * the positions: timing that no beam can explain.
 */
export function runCapture({ jitterMs = 0, seed = 1 } = {}): {
	finder: RadarFinder;
	/** When each radar was first found (as a candidate) and confirmed, ms into the capture. */
	found: Map<string, number>;
	confirmed: Map<string, number>;
	start: number;
} {
	const rand = random(seed);
	const shift = new Map<string, { last: number; by: number }>();
	const filter = new AddressFilter();
	const tracker = new Tracker(() => ({ lat: 52, lon: 14 }));
	const finder = new RadarFinder();
	const start = timedMessages[0].t;
	const found = new Map<string, number>();
	const confirmed = new Map<string, number>();
	let last = start;
	for (const { t, data } of timedMessages) {
		const addr = filter.check(data, t);
		const rx = t + CAPTURE_RX;
		if (tracker.add(data, addr, rx)) {
			const a = tracker.get(addr!.icao)!;
			if (a.position?.t === rx) finder.position(a.icao, rx, a.position.lat, a.position.lon);
		}
		if (downlinkFormat(data) === 11 && addr?.verdict === 'valid') {
			const code = codeName(addr.interrogator);
			if (code) {
				const key = `${code} ${addr.icao}`;
				const prev = shift.get(key);
				const by = prev && t - prev.last <= BURST_GAP_MS ? prev.by : rand() * jitterMs;
				shift.set(key, { last: t, by });
				finder.reply(code, addr.icao, t + by, rx);
			}
		}
		if (t - last >= 250) {
			last = t;
			finder.update(rx);
			for (const r of finder.candidates) if (!found.has(r.id)) found.set(r.id, t - start);
			for (const r of finder.radars) if (!confirmed.has(r.id)) confirmed.set(r.id, t - start);
		}
	}
	return { finder, found, confirmed, start };
}

/** A small seeded random generator (mulberry32), so synthetic tests are repeatable. */
export function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface SyntheticRadar {
	code: string;
	position: LatLon;
	/** ms */
	period: number;
	clockwise: boolean;
	/** A moment it points north, receiver clock, ms. */
	t0: number;
}

export interface SyntheticAircraft {
	icao: string;
	start: LatLon;
	/** Degrees, and m/s. */
	track: number;
	speed: number;
}

/**
 * Feed a finder with what a receiver would hear: ADS-B positions twice a second, and each
 * time a radar's beam passes an aircraft, 3 replies 10 ms apart (each turn heard with
 * probability `heard`). Receiver and server clocks are the same here. `from`: start at this
 * time, ms, to go on feeding a finder fed before. Returns the finder.
 */
export function simulate(
	radars: SyntheticRadar[],
	aircraft: SyntheticAircraft[],
	durationMs: number,
	{ heard = 0.8, seed = 1, finder = new RadarFinder(), from = 0 } = {}
): RadarFinder {
	const end = from + durationMs;
	const rand = random(seed);
	const at = (a: SyntheticAircraft, t: number) =>
		destination(a.start, a.track, (a.speed * t) / 1e6);
	const events: { t: number; run: () => void }[] = [];
	for (const a of aircraft)
		for (let t = from; t <= end; t += 500) {
			const p = at(a, t);
			events.push({ t, run: () => finder.position(a.icao, t, p.lat, p.lon) });
		}
	for (const r of radars)
		for (const a of aircraft) {
			const turns = Math.floor((end - r.t0) / r.period);
			for (let n = 0; n <= turns; n++) {
				if (rand() > heard) continue;
				// When the beam points at the aircraft in turn n (its bearing barely changes
				// within a turn, so twice is exact enough).
				let t = r.t0 + n * r.period;
				for (let i = 0; i < 2; i++) {
					const az = bearing(r.position, at(a, t)) / 360;
					t = r.t0 + r.period * (n + (r.clockwise ? az : 1 - az));
				}
				if (t < from || t > end) continue;
				for (const dt of [-10, 0, 10])
					events.push({ t: t + dt, run: () => finder.reply(r.code, a.icao, t + dt, t + dt) });
			}
		}
	events.sort((a, b) => a.t - b.t);
	let last = from;
	for (const e of events) {
		e.run();
		if (e.t - last >= 250) {
			last = e.t;
			finder.update(e.t);
		}
	}
	// Whatever is still due (one code per update).
	for (let i = 1; i <= 10; i++) finder.update(end + i * 250);
	return finder;
}
