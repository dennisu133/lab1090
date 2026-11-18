/**
 * Coverage: where this antenna hears aircraft, collected from the positions the tracker
 * believes.
 *
 * Two views of the same positions:
 * - per direction (SECTOR_DEG wide), the LOWEST elevation angle an aircraft was heard at:
 *   the antenna's skyline. Whatever blocks the view (a building, a hill) hides everything
 *   below it, at every distance. Over open, flat land the skyline is the horizon, 0°.
 * - per direction and altitude band, the FARTHEST position: the outline on the map, to
 *   compare with the radio horizon (geometry.ts).
 *
 * The skyline separates two things the distance mixes up. An aircraft at FL380 first heard
 * 30 km away looks like short range, but it stood 20° above the horizon: something
 * blocked it, not the distance. (The capture: towards the north-east nothing below 14–20°,
 * towards the west down to 2–3°.)
 *
 * Only airborne positions with a known altitude count, and only confirmed ones (a trail
 * segment's first point once the second agreed: tracker/positions.ts). Kept per tab, like
 * everything else: antennas move, so an earlier session's coverage may not apply.
 */
import { bearing, distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { aircraftElevation } from './geometry';

/** Directions are binned this wide, degrees: 72 sectors. */
export const SECTOR_DEG = 5;
const SECTORS = 360 / SECTOR_DEG;

/** Altitude bands for the outline: the farthest position in each, per sector. */
export const BANDS = [
	{ name: 'Below FL100', below: 10_000 },
	{ name: 'FL100–200', below: 20_000 },
	{ name: 'FL200–300', below: 30_000 },
	{ name: 'FL300 and up', below: Infinity }
] as const;

/** One point per aircraft per this many ms for the sky plot (extremes are always kept). */
export const THIN_MS = 10_000;
/** The most points kept for the plot; beyond, the oldest go (~5 h of busy traffic). */
export const MAX_POINTS = 60_000;

export interface CoveragePoint extends LatLon {
	icao: string;
	/** When, ms (server clock). */
	t: number;
	/** Barometric altitude, ft. */
	altitude: number;
	/** From the receiver, km along the ground, and degrees from true north. */
	distance: number;
	bearing: number;
	/** Degrees above the antenna's horizontal (geometry.ts), at the antenna height of the time. */
	elevation: number;
}

export interface Sector {
	/** Its first bearing, degrees: the sector covers [from, from + SECTOR_DEG). */
	from: number;
	/** Positions counted (every one, not just the kept points). */
	positions: number;
	/** Different aircraft heard in it. */
	aircraft: number;
	/** The position seen lowest above the horizon; null: none yet. */
	lowest: CoveragePoint | null;
	/** The farthest position per altitude band (BANDS order); null: none in that band. */
	farthest: (CoveragePoint | null)[];
}

interface SectorState {
	positions: number;
	aircraft: Set<string>;
	lowest: CoveragePoint | null;
	farthest: (CoveragePoint | null)[];
}

export function sectorOf(bearingDeg: number): number {
	return Math.floor((((bearingDeg % 360) + 360) % 360) / SECTOR_DEG) % SECTORS;
}

export function bandOf(altitudeFt: number): number {
	return BANDS.findIndex((b) => altitudeFt < b.below);
}

export class Coverage {
	readonly receiver: LatLon;
	/** The antenna's height above sea level, km (terrain.ts sets it once the tile is in). */
	#antennaKm: number;
	#sectors: SectorState[];
	/** Thinned positions for the sky plot, oldest first. */
	#points: CoveragePoint[] = [];
	/** When each aircraft's last point was kept. */
	#kept = new Map<string, number>();
	/** Positions counted in all. */
	positions = 0;
	/** The first and the latest position's time; null: none yet. */
	first: number | null = null;
	last: number | null = null;

	constructor(receiver: LatLon, antennaKm = 0) {
		this.receiver = receiver;
		this.#antennaKm = antennaKm;
		this.#sectors = Array.from({ length: SECTORS }, () => ({
			positions: 0,
			aircraft: new Set<string>(),
			lowest: null,
			farthest: BANDS.map(() => null)
		}));
	}

	get antennaKm(): number {
		return this.#antennaKm;
	}

	/**
	 * A new antenna height: every elevation is worked out again, and each sector's lowest
	 * picked again from its kept points and its old lowest. (A position thinned away could
	 * now be a hair lower: hundredths of a degree for the metres the height changes by.)
	 */
	setAntenna(km: number): void {
		if (km === this.#antennaKm) return;
		this.#antennaKm = km;
		const again = (p: CoveragePoint): CoveragePoint => ({
			...p,
			elevation: aircraftElevation(p.distance, p.altitude, km)
		});
		this.#points = this.#points.map(again);
		for (const s of this.#sectors) s.lowest = s.lowest && again(s.lowest);
		for (const p of this.#points) {
			const s = this.#sectors[sectorOf(p.bearing)];
			if (!s.lowest || p.elevation < s.lowest.elevation) s.lowest = p;
		}
		for (const s of this.#sectors) s.farthest = s.farthest.map((p) => p && again(p));
	}

	/** One confirmed airborne position. Returns whether it changed a sector's extremes. */
	add(icao: string, t: number, position: LatLon, altitude: number): boolean {
		const distance = distanceKm(this.receiver, position);
		const b = bearing(this.receiver, position);
		const p: CoveragePoint = {
			icao,
			t,
			lat: position.lat,
			lon: position.lon,
			altitude,
			distance,
			bearing: b,
			elevation: aircraftElevation(distance, altitude, this.#antennaKm)
		};
		this.positions++;
		this.first ??= t;
		this.last = t;

		const s = this.#sectors[sectorOf(b)];
		s.positions++;
		s.aircraft.add(icao);
		let extreme = false;
		if (!s.lowest || p.elevation < s.lowest.elevation) {
			s.lowest = p;
			extreme = true;
		}
		const band = bandOf(altitude);
		if (band >= 0 && (!s.farthest[band] || distance > s.farthest[band].distance)) {
			s.farthest[band] = p;
			extreme = true;
		}

		if (extreme || t - (this.#kept.get(icao) ?? -Infinity) >= THIN_MS) {
			this.#kept.set(icao, t);
			this.#points.push(p);
			if (this.#points.length > MAX_POINTS)
				this.#points.splice(0, this.#points.length - MAX_POINTS);
		}
		return extreme;
	}

	/** Every sector, from north clockwise: a snapshot. */
	sectors(): Sector[] {
		return this.#sectors.map((s, i) => ({
			from: i * SECTOR_DEG,
			positions: s.positions,
			aircraft: s.aircraft.size,
			lowest: s.lowest,
			farthest: [...s.farthest]
		}));
	}

	/** The thinned positions, oldest first (a copy). */
	points(): CoveragePoint[] {
		return [...this.#points];
	}
}

/**
 * A sector is "open" when aircraft were heard this close to the horizon there, degrees.
 * Even fully open directions don't reach 0°: the signal gives out first, at ~200 km here,
 * where FL350 stands 2–3° up. The hour's recording (fixtures/capture-1h.beast): open
 * directions bottom out at 1.3–4.1°, a few with little low traffic at 5.1°; blocked ones
 * (the building behind the antenna) at 12–18°, the partly blocked north at 6–8°.
 */
export const OPEN_DEG = 6;

export interface Arc {
	/** First bearing, and how wide, degrees (clockwise). */
	from: number;
	width: number;
}

export interface Summary {
	/** The farthest position of all, and that distance as a share of its radio horizon. */
	farthest: { point: CoveragePoint; ofHorizon: number } | null;
	/** Sectors with at least one position. */
	heard: number;
	/** Runs of neighbouring open sectors (OPEN_DEG), widest first. */
	open: Arc[];
}

/** What the panel says about the sectors. `horizon`: km for an altitude, ft (geometry.ts). */
export function summarize(sectors: Sector[], horizon: (feet: number) => number): Summary {
	let farthest: CoveragePoint | null = null;
	for (const s of sectors)
		for (const p of s.farthest)
			if (p && (!farthest || p.distance > farthest.distance)) farthest = p;
	const isOpen = sectors.map((s) => s.lowest !== null && s.lowest.elevation <= OPEN_DEG);
	const open: Arc[] = [];
	if (isOpen.every(Boolean)) open.push({ from: 0, width: 360 });
	else {
		// Start just after a closed sector, so a run across north stays in one piece.
		const start = isOpen.findIndex((o) => !o) + 1;
		let run: Arc | null = null;
		for (let k = 0; k < sectors.length; k++) {
			const i = (start + k) % sectors.length;
			if (isOpen[i]) {
				if (run) run.width += SECTOR_DEG;
				else open.push((run = { from: sectors[i].from, width: SECTOR_DEG }));
			} else run = null;
		}
	}
	return {
		farthest: farthest && {
			point: farthest,
			ofHorizon: farthest.distance / horizon(farthest.altitude)
		},
		heard: sectors.filter((s) => s.positions > 0).length,
		open: open.sort((a, b) => b.width - a.width)
	};
}
